"""SSE 断线续流：生成与连接解耦（R10.1）

生产者把 SSE 事件写进 Redis list（detached，客户端断开也继续生成）；
消费者（原始请求或重连请求）只是追随者，从 list 里按偏移读出。
key 设计：
  gen:{id}      hash  {conversation_id, user_id, text(已产出), status: running|done|error}  TTL 30min
  gen:{id}:ev   list  SSE 帧原文（"data: {...}\n\n"）                                       TTL 30min
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncGenerator

from ..cache import get_redis

log = logging.getLogger("crina.resume")
GEN_TTL = 1800  # 30 分钟


async def start_gen(conversation_id: str, user_id: str) -> str:
    gen_id = uuid.uuid4().hex[:16]
    r = get_redis()
    await r.hset(f"gen:{gen_id}", mapping={
        "conversation_id": conversation_id, "user_id": user_id, "text": "", "status": "running"})
    await r.expire(f"gen:{gen_id}", GEN_TTL)
    return gen_id


async def push_event(gen_id: str, frame: str, delta_text: str = ""):
    r = get_redis()
    pipe = r.pipeline()
    pipe.rpush(f"gen:{gen_id}:ev", frame)
    if delta_text:
        pipe.hset(f"gen:{gen_id}", "text", delta_text)
    pipe.expire(f"gen:{gen_id}:ev", GEN_TTL)
    await pipe.execute()


async def finish_gen(gen_id: str, status: str = "done"):
    await get_redis().hset(f"gen:{gen_id}", "status", status)


async def pending_for(conversation_id: str, user_id: str) -> dict | None:
    """该会话进行中的生成：{gen_id, text}；没有则 None"""
    r = get_redis()
    async for key in r.scan_iter("gen:*"):
        if key.endswith(":ev"):
            continue
        meta = await r.hgetall(key)
        if (meta.get("conversation_id") == conversation_id and meta.get("user_id") == user_id
                and meta.get("status") == "running"):
            return {"gen_id": key[4:], "text": meta.get("text", "")}
    return None


async def follow(gen_id: str, user_id: str, from_idx: int = 0) -> AsyncGenerator[str, None]:
    """追随者：从 from_idx 起读事件流；已产出的先补发，然后挂住等新事件"""
    r = get_redis()
    meta = await r.hgetall(f"gen:{gen_id}")
    if not meta or meta.get("user_id") != user_id:
        yield 'data: {"type": "error", "message": "这段生成找不到了"}\n\n'
        return
    yield f'data: {{"type": "gen", "gen_id": "{gen_id}"}}\n\n'  # 首包带 gen_id，前端存 sessionStorage
    idx = from_idx
    idle = 0
    while True:
        frames = await r.lrange(f"gen:{gen_id}:ev", idx, -1)
        if frames:
            idx += len(frames)
            idle = 0
            for f in frames:
                yield f
                # done/error 帧是终点
                try:
                    ev = json.loads(f.removeprefix("data:").strip())
                    if ev.get("type") in ("done", "error"):
                        return
                except Exception:
                    pass
        else:
            status = await r.hget(f"gen:{gen_id}", "status")
            if status and status != "running":
                return
            idle += 1
            if idle > 1200:  # 3 分钟无新事件兜底断开
                return
            await asyncio.sleep(0.15)
