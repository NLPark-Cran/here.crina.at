"""聊天 API：会话 CRUD + SSE 流式 + TTS"""
from __future__ import annotations

import hashlib

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..cache import get_redis
from ..db import get_db
from ..engine import chat as engine
from ..engine import tokendance
from ..models import Character, Conversation, Message, User
from ..security import get_current_user

router = APIRouter(prefix="/chat", tags=["chat"])


class CreateConversation(BaseModel):
    character_id: str = "crina"
    mode: str = "auto"


class SendMessage(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    doc_ids: list[str] = Field(default_factory=list, max_length=3)  # 引用已上传文档


class SetMode(BaseModel):
    mode: str


def conv_out(c: Conversation) -> dict:
    return {"id": str(c.id), "character_id": c.character_id, "mode": c.mode,
            "title": c.title, "folder": c.folder, "updated_at": c.updated_at.isoformat()}


@router.post("/conversations")
async def create_conversation(body: CreateConversation, user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)):
    char = (await db.execute(select(Character).where(Character.id == body.character_id))).scalar_one_or_none()
    if not char:
        raise HTTPException(404, "居民不存在")
    conv = Conversation(user_id=user.id, character_id=body.character_id, mode=body.mode)
    db.add(conv)
    await db.commit()
    return conv_out(conv)


@router.get("/conversations")
async def list_conversations(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Conversation).where(Conversation.user_id == user.id)
        .order_by(desc(Conversation.updated_at)).limit(50)
    )).scalars().all()
    # 单查询取每个会话的最后一条消息（窗口限定在当前用户的会话内，不全表扫）
    if rows:
        from sqlalchemy import func, over
        conv_ids = [c.id for c in rows]
        rn = over(func.row_number(), partition_by=Message.conversation_id,
                  order_by=desc(Message.seq)).label("rn")
        sub = select(Message.conversation_id, Message.content, rn).where(
            Message.conversation_id.in_(conv_ids)).subquery()
        lasts = (await db.execute(
            select(sub.c.conversation_id, sub.c.content).where(sub.c.rn == 1)
        )).all()
        last_map = {str(cid): content[:40] for cid, content in lasts}
    else:
        last_map = {}
    return {"conversations": [{**conv_out(c), "last_message": last_map.get(str(c.id))} for c in rows]}


@router.get("/conversations/{conv_id}")
async def get_conversation(conv_id: str, user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    conv = (await db.execute(select(Conversation).where(
        Conversation.id == conv_id, Conversation.user_id == user.id))).scalar_one_or_none()
    if not conv:
        raise HTTPException(404, "对话不存在")
    # 取最新 200 条再反转（长会话不能丢尾部）
    msgs = list((await db.execute(
        select(Message).where(Message.conversation_id == conv.id)
        .order_by(desc(Message.seq)).limit(200)
    )).scalars().all())
    msgs.reverse()
    return {**conv_out(conv), "messages": [
        {"id": str(m.id), "role": m.role, "character_id": m.character_id,
         "kind": m.kind, "content": m.content, "created_at": m.created_at.isoformat()}
        for m in msgs
    ]}


@router.patch("/conversations/{conv_id}")
async def set_mode(conv_id: str, body: SetMode, user: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)):
    conv = (await db.execute(select(Conversation).where(
        Conversation.id == conv_id, Conversation.user_id == user.id))).scalar_one_or_none()
    if not conv:
        raise HTTPException(404, "对话不存在")
    if body.mode not in ("auto", "brainstorm", "guide", "probe", "extract", "off"):
        raise HTTPException(400, "未知探讨模式")
    conv.mode = body.mode
    await db.commit()
    return conv_out(conv)


@router.delete("/conversations/{conv_id}")
async def delete_conversation(conv_id: str, user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)):
    conv = (await db.execute(select(Conversation).where(
        Conversation.id == conv_id, Conversation.user_id == user.id))).scalar_one_or_none()
    if not conv:
        raise HTTPException(404, "对话不存在")
    await db.delete(conv)
    await db.commit()
    return {"ok": True}


@router.post("/conversations/{conv_id}/messages")
async def send_message(conv_id: str, body: SendMessage, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    from .docs import load_doc_context
    doc_ctx = await load_doc_context(db, user, body.doc_ids)
    return StreamingResponse(
        engine.stream_reply(conv_id, user, body.content, db, doc_ctx),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    character_id: str = "crina"


@router.post("/tts")
async def tts(body: TTSRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    char = (await db.execute(select(Character).where(Character.id == body.character_id))).scalar_one_or_none()
    voice = char.voice_id if char and char.voice_id else ""
    cache_key = f"tts:{hashlib.sha256((voice + body.text).encode()).hexdigest()[:32]}"
    r = get_redis()
    cached = await r.get(cache_key)
    import base64
    if cached:
        return Response(content=base64.b64decode(cached), media_type="audio/mpeg")

    api_key, is_byok = await engine.get_user_api_key(db, user, "tts")
    if not api_key:
        raise HTTPException(503, "语音服务未配置")
    try:
        audio = await tokendance.tts(body.text, voice_id=voice, api_key=api_key)
    except Exception:
        raise HTTPException(502, "语音生成失败了，稍后再试") from None
    # 成功才计配额（失败不扣）
    try:
        await engine.check_and_count_quota(db, user, "tts", is_byok)
    except engine.QuotaExceeded:
        raise HTTPException(429, "今日语音额度用完啦") from None
    await r.setex(cache_key, 86400 * 7, base64.b64encode(audio).decode())
    return Response(content=audio, media_type="audio/mpeg")
