"""房间页：/@handle 公开小窝（免登录）"""
from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Article, User
from .articles import _brief_out
from .posts import _resolve_authors

router = APIRouter(prefix="/rooms", tags=["rooms"])


@router.get("/{handle}")
async def room(handle: str, db: AsyncSession = Depends(get_db)):
    """公开房间：昵称/头像/关系/相识天数 + TA 公开的文章"""
    user = (await db.execute(
        select(User).where(User.handle == handle.strip().lower())
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "这个房间还没有人住进来")
    articles = (await db.execute(
        select(Article).where(Article.author_type == "user", Article.author_id == str(user.id),
                              Article.public == True)  # noqa: E712
        .order_by(desc(Article.created_at)).limit(20)
    )).scalars().all()
    authors = await _resolve_authors(db, list(articles))
    days = max(1, (datetime.now(UTC) - user.created_at).days + 1)
    return {
        "room": {
            "nickname": user.nickname,
            "handle": user.handle,
            "avatar_url": user.avatar_url,
            "relation_tier": user.relation_tier,
            "days": days,
        },
        "articles": [_brief_out(a, authors) for a in articles],
    }
