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
