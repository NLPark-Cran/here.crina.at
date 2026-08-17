"""委托板 API：钉委托 / 看进度 / 实时施工流"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agentpool import pool
from ..bg import fire_and_forget
from ..db import get_db
from ..engine import chat as chat_engine
from ..models import AgentTask, User
from ..security import get_current_user, parse_uuid

router = APIRouter(prefix="/agent", tags=["agent"])


class CreateTask(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    prompt: str = Field(min_length=1, max_length=8000)
    target: str = "sandbox"  # sandbox / renovate（空间装修，仅主人）


def task_out(t: AgentTask) -> dict:
    return {"id": str(t.id), "title": t.title, "prompt": t.prompt, "status": t.status, "target": t.target,
            "result_summary": t.result_summary, "created_at": t.created_at.isoformat(),
            "finished_at": t.finished_at.isoformat() if t.finished_at else None}


@router.post("/tasks")
async def create_task(body: CreateTask, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    # 先验资格再扣配额（顺序不能反）
    if body.target == "renovate" and not user.is_owner:
        raise HTTPException(403, "空间装修是小屋主人的专属权柄哦")
    if body.target not in ("sandbox", "renovate"):
        raise HTTPException(400, "未知委托类型")
    _, is_byok = await chat_engine.get_user_api_key(db, user, "agent")
    try:
        await chat_engine.check_and_count_quota(db, user, "agent", is_byok)
    except chat_engine.QuotaExceeded:
        raise HTTPException(429, "今日委托次数用完啦，接入词元蓄电池可不限量（设置 → 词元蓄电池）") from None
    task = AgentTask(user_id=user.id, title=body.title, prompt=body.prompt, target=body.target)
    db.add(task)
    await db.commit()
    fire_and_forget(pool.execute_task(str(task.id)))
    return task_out(task)


@router.get("/tasks")
async def list_tasks(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(AgentTask).where(AgentTask.user_id == user.id)
        .order_by(desc(AgentTask.created_at)).limit(30)
    )).scalars().all()
    return {"tasks": [task_out(t) for t in rows]}


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, user: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)):
    task = await db.get(AgentTask, parse_uuid(task_id))
    if not task or task.user_id != user.id:
        raise HTTPException(404, "委托不存在")
    return task_out(task)


@router.post("/tasks/{task_id}/cancel")
async def cancel(task_id: str, user: User = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)):
    task = await db.get(AgentTask, parse_uuid(task_id))
    if not task or task.user_id != user.id:
        raise HTTPException(404, "委托不存在")
    ok = await pool.cancel_task(task_id)
    return {"ok": ok}


@router.get("/tasks/{task_id}/stream")
async def stream(task_id: str, user: User = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)):
    task = await db.get(AgentTask, parse_uuid(task_id))
    if not task or task.user_id != user.id:
        raise HTTPException(404, "委托不存在")

    async def gen():
        # 先订阅再回放：覆盖回放与订阅之间的事件窗口（重复事件前端按序去重）
        live = not pool.is_done(task_id) and task.status == "running"
        q = pool.subscribe(task_id) if live else None
        try:
            # 1. 回放落盘日志（记下已回放的最大事件序号）
            last_n = 0
            log_file = pool.task_log_path(task.user_id, task_id)
            if log_file.exists():
                for line in log_file.read_text(encoding="utf-8").splitlines():
                    if line.strip():
                        try:
                            last_n = max(last_n, json.loads(line).get("n", 0))
                        except Exception:
                            pass
                        yield f"data: {line}\n\n"
            # 2. 实时事件（跳过已在回放里出现的）
            if q is not None:
                while True:
                    try:
                        event = await asyncio.wait_for(q.get(), timeout=30)
                    except TimeoutError:
                        yield 'data: {"type":"ping"}\n\n'
                        continue
                    if event.get("n", 0) and event["n"] <= last_n:
                        continue
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                    if event.get("type") == "closed":
                        break
        finally:
            if q is not None:
                pool.unsubscribe(task_id, q)
        yield 'data: {"type":"eof"}\n\n'

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
