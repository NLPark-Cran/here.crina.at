"""Redis 辅助（OAuth state、限流、TTS 缓存）"""
from __future__ import annotations

import redis.asyncio as aioredis

from .config import get_settings

settings = get_settings()

_pool: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _pool
    if _pool is None:
        _pool = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _pool


async def rate_limit(kind: str, ident: str, limit: int, window_s: int = 86400) -> bool:
    """固定窗口限流：窗口内第 limit+1 次起返回 False"""
    r = get_redis()
    key = f"rl:{kind}:{ident}"
    count = await r.incr(key)
    if count == 1:
        await r.expire(key, window_s)
    return count <= limit
