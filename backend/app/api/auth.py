"""观猹 OAuth2 登录（Authorization Code + S256 PKCE，机密客户端）"""
from __future__ import annotations

import base64
import hashlib
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..cache import get_redis
from ..config import get_settings
from ..db import get_db
from ..models import OAuthAccount, User
from ..security import COOKIE_NAME, create_session_token, encrypt_payload, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

CALLBACK_PATH = "/api/auth/watcha/callback"


def _s256(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


@router.get("/watcha/login")
async def watcha_login(next: str = "/"):
    verifier = secrets.token_urlsafe(48)
    state = secrets.token_urlsafe(24)
    r = get_redis()
    await r.setex(f"oauth:watcha:{state}", 600, f"{verifier}|{next}")
    params = {
        "response_type": "code",
        "client_id": settings.watcha_client_id,
        "redirect_uri": settings.site_url + CALLBACK_PATH,
        "scope": settings.watcha_scope,
        "state": state,
        "code_challenge": _s256(verifier),
        "code_challenge_method": "S256",
    }
    return RedirectResponse(f"{settings.watcha_authorize_url}?{urlencode(params)}")


@router.get("/watcha/callback")
async def watcha_callback(code: str | None = None, state: str | None = None,
                          error: str | None = None, error_description: str | None = None,
                          db: AsyncSession = Depends(get_db)):
    if error:
        return RedirectResponse(f"/login?error={error_description or error}")
    if not code or not state:
        raise HTTPException(400, "缺少 code/state")
    r = get_redis()
    cached = await r.getdel(f"oauth:watcha:{state}")
    if not cached:
        raise HTTPException(400, "state 无效或已过期")
    verifier, next_url = cached.split("|", 1)

    async with httpx.AsyncClient(timeout=20) as client:
        token_resp = await client.post(
            settings.watcha_token_url,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.site_url + CALLBACK_PATH,
                "client_id": settings.watcha_client_id,
                "client_secret": settings.watcha_client_secret,
                "code_verifier": verifier,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        token_data = token_resp.json()
        if "access_token" not in token_data:
            raise HTTPException(400, f"Token 交换失败: {token_data.get('error_description', token_data)}")
        info_resp = await client.get(
            settings.watcha_userinfo_url,
            params={"access_token": token_data["access_token"]},
        )
        info = info_resp.json()
        if info.get("statusCode") != 200:
            raise HTTPException(400, "获取用户信息失败")
        profile = info["data"]

    watcha_id = int(profile["user_id"])
    user = (await db.execute(select(User).where(User.watcha_user_id == watcha_id))).scalar_one_or_none()
    if user is None:
        user = User(
            watcha_user_id=watcha_id,
            nickname=profile.get("nickname") or f"猹友{watcha_id}",
            avatar_url=profile.get("avatar_url"),
            email=profile.get("email"),
            is_owner=(settings.owner_watcha_id and watcha_id == settings.owner_watcha_id),
        )
        db.add(user)
        await db.flush()
    else:
        user.nickname = profile.get("nickname") or user.nickname
        user.avatar_url = profile.get("avatar_url") or user.avatar_url
        if profile.get("email"):
            user.email = profile["email"]

    # 保存观猹 token（加密）
    acct = (await db.execute(
        select(OAuthAccount).where(OAuthAccount.user_id == user.id, OAuthAccount.provider == "watcha")
    )).scalar_one_or_none()
    payload = encrypt_payload({
        "access_token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token"),
        "expires_in": token_data.get("expires_in"),
    })
    if acct:
        acct.payload_enc = payload
        acct.scopes = token_data.get("scope", "")
    else:
        db.add(OAuthAccount(user_id=user.id, provider="watcha", payload_enc=payload,
                            scopes=token_data.get("scope", "")))
    await db.commit()

    resp = RedirectResponse(next_url if next_url.startswith("/") else "/")
    resp.set_cookie(COOKIE_NAME, create_session_token(user.id),
                    max_age=settings.jwt_expire_days * 86400,
                    httponly=True, secure=True, samesite="lax", path="/")
    return resp


@router.post("/logout")
async def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE_NAME, path="/")
    return resp


@router.get("/dev-login")
async def dev_login(nickname: str = "镜听", owner: bool = True, db: AsyncSession = Depends(get_db)):
    """仅 DEBUG 模式可用的测试登录"""
    if not settings.debug:
        raise HTTPException(404, "not found")
    import hashlib as _hl
    fake_id = int(_hl.md5(nickname.encode()).hexdigest()[:8], 16) % 10**8
    user = (await db.execute(select(User).where(User.watcha_user_id == fake_id))).scalar_one_or_none()
    if user is None:
        user = User(watcha_user_id=fake_id, nickname=nickname, is_owner=owner,
                    relation_tier="老友" if owner else "熟人")
        db.add(user)
        await db.commit()
    resp = RedirectResponse("/")
    resp.set_cookie(COOKIE_NAME, create_session_token(user.id),
                    max_age=settings.jwt_expire_days * 86400,
                    httponly=True, secure=False, samesite="lax", path="/")
    return resp


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {
        "id": str(user.id),
        "nickname": user.nickname,
        "avatar_url": user.avatar_url,
        "email": user.email,
        "is_owner": user.is_owner,
        "relation_tier": user.relation_tier,
        "notify_email": user.notify_email,
    }


@router.get("/me/optional")
async def me_optional(request: Request, db: AsyncSession = Depends(get_db)):
    from ..security import get_current_user_optional
    user = await get_current_user_optional(request, db)
    if not user:
        return {"user": None}
    return {"user": {"id": str(user.id), "nickname": user.nickname, "avatar_url": user.avatar_url,
                     "is_owner": user.is_owner, "relation_tier": user.relation_tier}}
