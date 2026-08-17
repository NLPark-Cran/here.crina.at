"""委托池：并发上限 + 事件广播 + 落盘回放"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select

from ..config import get_settings
from ..db import SessionLocal
from ..models import AgentTask, OAuthAccount, User
from ..security import decrypt_payload
from .worker import run_task

settings = get_settings()
log = logging.getLogger("crina.agentpool")

_semaphore: asyncio.Semaphore | None = None
_live: dict[str, dict] = {}  # task_id -> {queues: set[asyncio.Queue], done: bool}


def _sem() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(settings.agent_max_workers)
    return _semaphore


def task_log_path(user_id: uuid.UUID, task_id: str) -> Path:
    p = Path(settings.agent_work_root) / str(user_id) / "tasks" / f"{task_id}.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


async def get_task_api_key(db, user: User) -> str | None:
    """BYOK 用户用自己的 Key 干活"""
    acct = (await db.execute(select(OAuthAccount).where(
        OAuthAccount.user_id == user.id, OAuthAccount.provider == "tokendance"))).scalar_one_or_none()
    if acct:
        try:
            payload = decrypt_payload(acct.payload_enc)
            if payload.get("api_key"):
                return payload["api_key"]
        except Exception:
            pass
    return settings.tokendance_api_key or None


def subscribe(task_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    state = _live.setdefault(task_id, {"queues": set(), "done": False})
    if state["done"]:
        # 已完成：立即补发 closed，避免订阅者空等
        q.put_nowait({"type": "closed"})
    else:
        state["queues"].add(q)
    return q


def unsubscribe(task_id: str, q: asyncio.Queue):
    state = _live.get(task_id)
    if state:
        state["queues"].discard(q)


def is_done(task_id: str) -> bool:
    state = _live.get(task_id)
    return bool(state and state["done"])


async def _broadcast(task_id: str, event: dict):
    state = _live.get(task_id)
    if not state:
        return
    for q in list(state["queues"]):
        q.put_nowait(event)


async def execute_task(task_id: str):
    """池化执行（由 fire_and_forget 调度）"""
    async with _sem():
        async with SessionLocal() as db:
            task = await db.get(AgentTask, uuid.UUID(task_id))
            if not task or task.status != "queued":
                return
            task.status = "running"
            await db.commit()
            user = await db.get(User, task.user_id)
            api_key = await get_task_api_key(db, user) if user else None
            if not api_key:
                task.status = "failed"
                task.result_summary = "词元未配置"
                await db.commit()
                return
            user_id = task.user_id
            prompt = task.prompt
            target = task.target or "sandbox"

        log_file = task_log_path(user_id, task_id)
        transcript: list[str] = []
        status = "done"
        _live[task_id] = {"queues": _live.get(task_id, {}).get("queues", set()), "done": False}
        try:
            import aiofiles
            n = 0  # 每任务事件序号：回放与实时流衔接处按此去重
            async with aiofiles.open(log_file, "a", encoding="utf-8") as fp:
                async for event in run_task(task_id, user_id, prompt, api_key, target):
                    n += 1
                    event["n"] = n
                    await fp.write(json.dumps(event, ensure_ascii=False) + "\n")
                    if event["type"] == "text":
                        transcript.append(event["text"])
                    if event["type"] == "error":
                        status = "failed"
                    if event["type"] == "finished":
                        status = "done" if event.get("status") == "finished" else "failed"
                    await _broadcast(task_id, event)
        except Exception as e:
            log.exception("委托执行异常 task=%s", task_id)
            status = "failed"
            await _broadcast(task_id, {"type": "error", "message": str(e)[:200]})
        finally:
            _live[task_id]["done"] = True
            await _broadcast(task_id, {"type": "closed"})
            # 延时清理登记表，防内存缓涨
            async def _gc():
                await asyncio.sleep(300)
                state = _live.get(task_id)
                if state and not state["queues"]:
                    _live.pop(task_id, None)
            from ..bg import fire_and_forget
            fire_and_forget(_gc())

        # 装修任务完成后自动构建上线
        if target == "renovate" and status == "done":
            try:
                from .worker import FRONTEND_DIR
                proc = await asyncio.create_subprocess_exec(
                    "npm", "run", "build", cwd=str(FRONTEND_DIR),
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
                _, err = await asyncio.wait_for(proc.communicate(), timeout=300)
                if proc.returncode == 0:
                    transcript.append("\n\n（装修已施工完毕，刷新页面就能看到啦～）")
                else:
                    transcript.append(f"\n\n（构建翻车了：{err.decode()[-200:]}）")
                    status = "failed"
            except Exception as e:
                transcript.append(f"\n\n（构建没跑起来：{e}）")

        summary = "".join(transcript)[-800:]
        async with SessionLocal() as db:
            task = await db.get(AgentTask, uuid.UUID(task_id))
            if task:
                task.status = status
                task.result_summary = summary
                task.finished_at = datetime.now(UTC)
                await db.commit()
        log.info("委托完成 task=%s status=%s", task_id, status)


async def cancel_task(task_id: str) -> bool:
    """目前通过标记实现；worker 进程随读循环结束退出。
    （强行 kill 需要进程登记表，留待 cran-code 分支改造时做）"""
    async with SessionLocal() as db:
        task = await db.get(AgentTask, uuid.UUID(task_id))
        if task and task.status in ("queued",):
            task.status = "cancelled"
            task.finished_at = datetime.now(UTC)
            await db.commit()
            return True
    return False
