"""词元蓄电池：TokenDance OAuth 式 API Key 授权（Authorization Code + S256 PKCE）"""
from __future__ import annotations

import base64
import hashlib
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..cache import get_redis
from ..config import get_settings
from ..db import get_db
from ..models import OAuthAccount, User
from ..security import encrypt_payload, get_current_user

router = APIRouter(prefix="/byok", tags=["byok"])
settings = get_settings()

CALLBACK_PATH = "/api/byok/callback"


def _s256(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


@router.get("/status")
async def status(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    acct = (await db.execute(select(OAuthAccount).where(
        OAuthAccount.user_id == user.id, OAuthAccount.provider == "tokendance"))).scalar_one_or_none()
    return {"connected": bool(acct)}


@router.get("/connect")
async def connect(user: User = Depends(get_current_user)):
    verifier = secrets.token_urlsafe(48)
    state = secrets.token_urlsafe(24)
    r = get_redis()
    await r.setex(f"oauth:byok:{state}", 600, f"{verifier}|{user.id}")
    params = {
        "callback_url": settings.site_url + CALLBACK_PATH + f"?state={state}",
        "code_challenge": _s256(verifier),
        "code_challenge_method": "S256",
        "app_url": settings.site_url,
        "key_name": "镜听空间词元蓄电池",
    }
    return RedirectResponse(f"{settings.tokendance_auth_url}?{urlencode(params)}")


@router.get("/callback")
async def callback(code: str | None = None, state: str | None = None, db: AsyncSession = Depends(get_db)):
    if not code or not state:
        raise HTTPException(400, "缺少 code/state")
    r = get_redis()
    cached = await r.getdel(f"oauth:byok:{state}")
    if not cached:
        raise HTTPException(400, "state 无效或已过期")
    verifier, user_id = cached.split("|", 1)

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            settings.tokendance_exchange_url,
            json={"code": code, "code_verifier": verifier, "code_challenge_method": "S256"},
        )
        if resp.status_code != 200:
            raise HTTPException(400, f"Key 交换失败：{resp.text[:200]}")
        api_key = resp.json().get("key")
        if not api_key:
            raise HTTPException(400, "未返回 Key")

    import uuid
    acct = (await db.execute(select(OAuthAccount).where(
        OAuthAccount.user_id == uuid.UUID(user_id),
        OAuthAccount.provider == "tokendance"))).scalar_one_or_none()
    payload = encrypt_payload({"api_key": api_key})
    if acct:
        acct.payload_enc = payload
    else:
        db.add(OAuthAccount(user_id=uuid.UUID(user_id), provider="tokendance", payload_enc=payload))
    await db.commit()
    return RedirectResponse("/settings?byok=ok")


@router.delete("")
async def disconnect(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    acct = (await db.execute(select(OAuthAccount).where(
        OAuthAccount.user_id == user.id, OAuthAccount.provider == "tokendance"))).scalar_one_or_none()
    if acct:
        await db.delete(acct)
        await db.commit()
    return {"ok": True}


# ---------- Google 连接（可选，需配置 GOOGLE_CLIENT_ID/SECRET） ----------
@router.get("/google/status")
async def google_status(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    acct = (await db.execute(select(OAuthAccount).where(
        OAuthAccount.user_id == user.id, OAuthAccount.provider == "google"))).scalar_one_or_none()
    return {"connected": bool(acct), "available": bool(settings.google_client_id)}


@router.get("/google/connect")
async def google_connect(user: User = Depends(get_current_user)):
    if not settings.google_client_id:
        raise HTTPException(503, "Google 连接尚未开通（需要站主配置 Google OAuth 客户端）")
    state = secrets.token_urlsafe(24)
    r = get_redis()
    await r.setex(f"oauth:google:{state}", 600, str(user.id))
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.site_url + "/api/byok/google/callback",
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar openid email",
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}")


@router.get("/google/callback")
async def google_callback(code: str | None = None, state: str | None = None, db: AsyncSession = Depends(get_db)):
    if not code or not state:
        raise HTTPException(400, "缺少 code/state")
    r = get_redis()
    user_id = await r.getdel(f"oauth:google:{state}")
    if not user_id:
        raise HTTPException(400, "state 无效或已过期")
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post("https://oauth2.googleapis.com/token", data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": settings.site_url + "/api/byok/google/callback",
            "grant_type": "authorization_code",
        })
        data = resp.json()
        if "access_token" not in data:
            raise HTTPException(400, f"Google 授权失败：{data.get('error_description', '')[:150]}")
    import uuid
    acct = (await db.execute(select(OAuthAccount).where(
        OAuthAccount.user_id == uuid.UUID(user_id), OAuthAccount.provider == "google"))).scalar_one_or_none()
    payload = encrypt_payload({
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token"),
        "expires_in": data.get("expires_in"),
    })
    if acct:
        acct.payload_enc = payload
    else:
        db.add(OAuthAccount(user_id=uuid.UUID(user_id), provider="google",
                            payload_enc=payload, scopes=data.get("scope", "")))
    await db.commit()
    return RedirectResponse("/settings?google=ok")
