"""安全：JWT 会话 + Fernet 凭据加密 + 当前用户依赖"""
from __future__ import annotations

import base64
import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import get_db
from .models import User

settings = get_settings()
ALGO = "HS256"
COOKIE_NAME = "crina_session"


# ---------- JWT ----------
def create_session_token(user_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(days=settings.jwt_expire_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGO)


def decode_session_token(token: str) -> uuid.UUID | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGO])
        return uuid.UUID(payload["sub"])
    except Exception:
        return None


# ---------- Fernet 加密（BYOK / OAuth token 落库）----------
def _fernet() -> Fernet:
    key = settings.fernet_key
    if not key:
        # 开发兜底：由 jwt_secret 派生（生产必须配置独立 FERNET_KEY）
        key = base64.urlsafe_b64encode(hashlib.sha256(settings.jwt_secret.encode()).digest())
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_payload(data: dict) -> str:
    return _fernet().encrypt(json.dumps(data).encode()).decode()


def decrypt_payload(enc: str) -> dict:
    return json.loads(_fernet().decrypt(enc.encode()).decode())


def parse_uuid(value: str) -> uuid.UUID:
    """路径参数里的 UUID：畸形输入统一 404（而不是 500 炸 HTML/SSE）"""
    from fastapi import HTTPException
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(404, "不存在") from None


# ---------- 当前用户 ----------
async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        # 也支持 Authorization: Bearer（方便 API 调试）
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(401, "未登录")
    user_id = decode_session_token(token)
    if not user_id:
        raise HTTPException(401, "会话已过期")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(401, "用户不存在")
    # 节流更新活跃时间（问候信用）
    from .cache import get_redis
    r = get_redis()
    seen_key = f"seen:{user.id}"
    if not await r.get(seen_key):
        await r.setex(seen_key, 600, "1")
        user.last_seen_at = datetime.now(UTC)
        await db.commit()
    return user


async def get_current_user_optional(request: Request, db: AsyncSession = Depends(get_db)) -> User | None:
    try:
        return await get_current_user(request, db)
    except HTTPException:
        return None
