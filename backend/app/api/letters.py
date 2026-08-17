"""信箱：来信 / 写信给居民 / 日历事件 / ICS 导出 / 记忆管理 / 探讨沉淀"""
from __future__ import annotations

import asyncio
import uuid as _uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..bg import fire_and_forget
from ..db import SessionLocal, get_db
from ..engine import tokendance
from ..models import Character, Conversation, Event, Letter, Memory, Message, User, WikiPage
from ..security import decode_session_token, get_current_user
from ..soul.characters import WORLD

router = APIRouter(tags=["mailbox", "calendar", "memory", "wiki"])


# ---------- 信箱 ----------
@router.get("/letters")
async def list_letters(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Letter).where(Letter.user_id == user.id).order_by(desc(Letter.created_at)).limit(50)
    )).scalars().all()
    chars = {c.id: c for c in (await db.execute(
        select(Character).with_entities(Character.id, Character.name, Character.color)
    ))}
    return {"letters": [
        {"id": str(l.id), "character": {"id": l.character_id, "name": chars[l.character_id].name if l.character_id in chars else l.character_id,
                                        "color": chars[l.character_id].color if l.character_id in chars else "#999"},
         "kind": l.kind, "title": l.title, "content": l.content, "read": l.read,
         "created_at": l.created_at.isoformat()}
        for l in rows
    ], "unread": sum(1 for l in rows if not l.read)}


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


# ---------- 日历 ----------
CST = timezone(timedelta(hours=8))


class CreateEvent(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    description: str = ""
    start_at: datetime
    end_at: datetime | None = None
    remind_minutes: int = 60

    @classmethod
    def _naive_as_cst(cls, dt: datetime | None) -> datetime | None:
        """naive 时间一律按 CST（+8）解释"""
        if dt is not None and dt.tzinfo is None:
            return dt.replace(tzinfo=CST)
        return dt

    def model_post_init(self, __context):
        self.start_at = self._naive_as_cst(self.start_at)
        self.end_at = self._naive_as_cst(self.end_at)


@router.get("/events")
async def list_events(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Event).where(Event.user_id == user.id).order_by(Event.start_at).limit(200)
    )).scalars().all()
    return {"events": [
        {"id": str(e.id), "title": e.title, "description": e.description,
         "start_at": e.start_at.isoformat(), "end_at": e.end_at.isoformat() if e.end_at else None,
         "remind_minutes": e.remind_minutes, "source": e.source}
        for e in rows
    ]}


@router.post("/events")
async def create_event(body: CreateEvent, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ev = Event(user_id=user.id, title=body.title, description=body.description,
               start_at=body.start_at, end_at=body.end_at, remind_minutes=body.remind_minutes)
    db.add(ev)
    await db.commit()
    return {"id": str(ev.id)}


@router.delete("/events/{event_id}")
async def delete_event(event_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ev = await db.get(Event, _uuid.UUID(event_id))
    if not ev or ev.user_id != user.id:
        raise HTTPException(404, "事件不存在")
    await db.delete(ev)
    await db.commit()
    return {"ok": True}


@router.get("/events/ics-url")
async def ics_url(user: User = Depends(get_current_user)):
    """返回当前用户的日历订阅链接"""
    from ..config import get_settings
    from ..security import create_session_token
    token = create_session_token(user.id)
    return {"url": f"{get_settings().site_url}/api/events.ics?token={token}"}


@router.get("/events.ics")
async def export_ics(token: str, db: AsyncSession = Depends(get_db)):
    """日历订阅导出（挂进手机日历）：?token=<JWT>"""
    from fastapi.responses import Response
    from icalendar import Calendar, Event as ICalEvent
    uid = decode_session_token(token)
    if not uid:
        raise HTTPException(401, "token 无效")
    rows = (await db.execute(select(Event).where(Event.user_id == uid))).scalars().all()
    cal = Calendar()
    cal.add("prodid", "-//Crina Space//here.crina.at//CN")
    cal.add("version", "2.0")
    cal.add("x-wr-calname", "镜听空间")
    for e in rows:
        ie = ICalEvent()
        ie.add("uid", f"{e.id}@here.crina.at")
        ie.add("summary", e.title)
        ie.add("description", e.description)
        ie.add("dtstart", e.start_at)
        if e.end_at:
            ie.add("dtend", e.end_at)
        ie.add("dtstamp", datetime.now(timezone.utc))
        cal.add_component(ie)
    return Response(content=cal.to_ical(), media_type="text/calendar",
                    headers={"Content-Disposition": "attachment; filename=crina.ics"})


# ---------- 记忆 ----------
@router.get("/memories")
async def list_memories(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Memory).where(Memory.user_id == user.id).order_by(desc(Memory.salience)).limit(100)
    )).scalars().all()
    return {"memories": [
        {"id": str(m.id), "kind": m.kind, "content": m.content, "salience": m.salience,
         "character_id": m.character_id, "created_at": m.created_at.isoformat()}
        for m in rows
    ]}


@router.delete("/memories/{memory_id}")
async def delete_memory(memory_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    mem = await db.get(Memory, _uuid.UUID(memory_id))
    if not mem or mem.user_id != user.id:
        raise HTTPException(404, "记忆不存在")
    await db.delete(mem)
    await db.commit()
    return {"ok": True}


# ---------- 档案馆 · 探讨沉淀 ----------
@router.get("/wiki")
async def list_wiki(request: Request, db: AsyncSession = Depends(get_db)):
    """未登录只看公开页；登录后可看自己的私密沉淀"""
    from ..security import get_current_user_optional
    user = await get_current_user_optional(request, db)
    if user:
        from sqlalchemy import or_
        cond = or_(WikiPage.public == True, WikiPage.user_id == user.id)  # noqa: E712
    else:
        cond = WikiPage.public == True  # noqa: E712
    rows = (await db.execute(
        select(WikiPage).where(cond).order_by(desc(WikiPage.created_at)).limit(50)
    )).scalars().all()
    return {"pages": [
        {"id": str(w.id), "title": w.title, "content": w.content, "mode": w.mode,
         "public": w.public, "mine": bool(user and w.user_id == user.id),
         "created_at": w.created_at.isoformat()}
        for w in rows
    ]}


class ExtractWiki(BaseModel):
    conversation_id: str
    title: str = Field(default="", max_length=128)
    public: bool = False


@router.post("/wiki/extract")
async def extract_wiki(body: ExtractWiki, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    conv = (await db.execute(select(Conversation).where(
        Conversation.id == _uuid.UUID(body.conversation_id), Conversation.user_id == user.id))).scalar_one_or_none()
    if not conv:
        raise HTTPException(404, "对话不存在")
    msgs = (await db.execute(
        select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at).limit(60)
    )).scalars().all()
    dialogue = "\n".join(f"{'用户' if m.role == 'user' else (m.character_id or '角色')}: {m.content[:300]}" for m in msgs)
    prompt = f"""把下面这场探讨萃取成一页可以收藏的「核心信念/观点沉淀」。
格式：Markdown。先一句凝练的核心观点作为标题（# 开头），再分 2-4 小节展开，每小节两三句话。
要像档案馆藏品一样准确优美，不要写成会议纪要。

探讨记录：
{dialogue[:4000]}"""
    try:
        content = await tokendance.chat_once([{"role": "user", "content": prompt}], temperature=0.6, max_tokens=1200)
    except Exception:
        import logging
        logging.getLogger("crina.wiki").exception("萃取失败")
        raise HTTPException(503, "萃取没能完成，让 crina 歇口气再试一次吧")
    title = body.title or (content.split("\n")[0].lstrip("# ").strip()[:60] if content else "未命名沉淀")
    page = WikiPage(user_id=user.id, title=title, content=content, mode=conv.mode,
                    source_conversation_id=conv.id, public=body.public)
    db.add(page)
    await db.commit()
    return {"id": str(page.id), "title": title}
