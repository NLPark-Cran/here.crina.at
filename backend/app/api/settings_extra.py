"""设置扩展：自建邮箱绑定（观猹未绑邮箱也能收信）"""
from __future__ import annotations

import re
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..cache import get_redis
from ..db import get_db
from ..models import User
from ..proactive import email as mailer
from ..security import get_current_user

router = APIRouter(prefix="/settings", tags=["settings"])

EMAIL_RE = re.compile(r"^[\w.+-]+@[\w-]+\.[\w.]+$")


class SendCode(BaseModel):
    email: str


class VerifyCode(BaseModel):
    email: str
    code: str


@router.post("/email/send-code")
async def send_code(body: SendCode, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email) or len(email) > 100:
        raise HTTPException(400, "邮箱地址看起来不太对")
    if not mailer.configured():
        raise HTTPException(503, "信箱线路还没搭好，请稍后再试")
    r = get_redis()
    if await r.get(f"email:rl:{user.id}"):
        raise HTTPException(429, "验证码刚发过一封，去邮箱看看吧（一分钟内只能发一次）")
    code = f"{secrets.randbelow(1000000):06d}"
    await r.setex(f"email:code:{user.id}", 600, f"{email}|{code}")
    await r.setex(f"email:rl:{user.id}", 60, "1")
    ok = await mailer.send_mail(
        email,
        "[镜听空间] 邮箱绑定验证码",
        f"你好呀，{user.nickname}：\n\n你的验证码是 {code}，十分钟后失效。\n\n"
        "绑定之后，crina 的早安晚安和日程提醒就会寄到这里啦。\n\n—— 镜听空间",
    )
    if not ok:
        raise HTTPException(503, "邮件飞丢了，稍后再试试")
    return {"ok": True, "message": "验证码已经飞过去啦，十分钟内有效"}


@router.post("/email/verify")
async def verify_code(body: VerifyCode, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = get_redis()
    cached = await r.get(f"email:code:{user.id}")
    if not cached:
        raise HTTPException(400, "验证码过期了，重新发一封吧")
    # 防爆破：错 5 次作废
    fails = await r.incr(f"email:fails:{user.id}")
    await r.expire(f"email:fails:{user.id}", 600)
    if fails > 5:
        await r.delete(f"email:code:{user.id}")
        raise HTTPException(400, "错太多次啦，这张验证码作废，重新发一封吧")
    email, code = cached.split("|", 1)
    if not secrets.compare_digest(body.code.strip(), code) or body.email.strip().lower() != email:
        raise HTTPException(400, "验证码对不上，再看看？")
    user.email = email
    await db.commit()
    await r.delete(f"email:code:{user.id}")
    return {"ok": True, "email": email, "message": "绑定好啦，以后的信都寄到这里"}


class NotifyPref(BaseModel):
    notify_email: bool


@router.post("/notify")
async def set_notify(body: NotifyPref, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    user.notify_email = body.notify_email
    await db.commit()
    return {"ok": True, "notify_email": user.notify_email}
