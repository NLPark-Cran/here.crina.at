"""档案馆 · 记忆管理 + 探讨沉淀 wiki"""
from __future__ import annotations

import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..engine import tokendance
from ..models import Conversation, Memory, Message, User, WikiPage
from ..security import get_current_user, get_current_user_optional

router = APIRouter(tags=["archive"])

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
