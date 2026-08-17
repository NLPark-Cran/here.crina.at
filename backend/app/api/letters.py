"""信箱：来信 / 写信给居民 / 回信"""
from __future__ import annotations

import asyncio
import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..bg import fire_and_forget
from ..db import SessionLocal, get_db
from ..engine import tokendance
from ..models import Character, Letter, User
from ..security import get_current_user
from ..soul.characters import WORLD

router = APIRouter(tags=["mailbox", "calendar", "memory", "wiki"])


# ---------- 信箱 ----------
@router.get("/letters")
async def list_letters(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Letter).where(Letter.user_id == user.id).order_by(desc(Letter.created_at)).limit(50)
    )).scalars().all()
    rows_c = (await db.execute(select(Character.id, Character.name, Character.color))).all()
    chars = {cid: {"name": name, "color": color} for cid, name, color in rows_c}
    return {"letters": [
        {"id": str(letter.id), "character": {"id": letter.character_id, "name": chars[letter.character_id]["name"] if letter.character_id in chars else letter.character_id,
                                        "color": chars[letter.character_id]["color"] if letter.character_id in chars else "#999"},
         "kind": letter.kind, "title": letter.title, "content": letter.content, "read": letter.read,
         "created_at": letter.created_at.isoformat()}
        for letter in rows
    ], "unread": sum(1 for letter in rows if not letter.read)}


@router.post("/letters/{letter_id}/read")
async def read_letter(letter_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    letter = await db.get(Letter, _uuid.UUID(letter_id))
    if not letter or letter.user_id != user.id:
        raise HTTPException(404, "信件不存在")
    letter.read = True
    await db.commit()
    return {"ok": True}


class SendLetter(BaseModel):
    character_id: str
    content: str = Field(min_length=1, max_length=2000)


async def _reply_letter_bg(user_id: _uuid.UUID, nickname: str, character_id: str, content: str):
    """居民回信（后台）"""
    await asyncio.sleep(5)
    async with SessionLocal() as db:
        char = (await db.execute(select(Character).where(Character.id == character_id))).scalar_one_or_none()
        if not char:
            return
        prompt = f"""{WORLD}

{char.soul_public}

# 情境
{nickname} 给你写了一封信，你要回信。像真的手写信一样：有称呼、有温度、有落款。150 字以内。

来信内容：{content[:800]}"""
        try:
            reply = await tokendance.chat_once([{"role": "user", "content": prompt}], temperature=0.85, max_tokens=400)
            db.add(Letter(user_id=user_id, character_id=character_id, kind="reply",
                          title=f"来自{char.name}的回信", content=reply.strip()))
            await db.commit()
        except Exception:
            pass


@router.post("/letters")
async def send_letter(body: SendLetter, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    char = (await db.execute(select(Character).where(Character.id == body.character_id))).scalar_one_or_none()
    if not char:
        raise HTTPException(404, "居民不存在")
    fire_and_forget(_reply_letter_bg(user.id, user.nickname, body.character_id, body.content))
    return {"ok": True, "message": f"信已经放进{char.name}的信箱啦，回信稍后就到"}


