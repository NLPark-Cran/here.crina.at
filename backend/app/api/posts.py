"""客厅：碎碎念时间线 + 居民互动"""
from __future__ import annotations

import asyncio
import random

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from ..bg import fire_and_forget
from ..db import SessionLocal, get_db
from ..engine import tokendance
from ..models import Character, Post, PostReply, User
from ..security import get_current_user, get_current_user_optional
from ..soul.characters import WORLD

router = APIRouter(prefix="/posts", tags=["posts"])


class CreatePost(BaseModel):
    content: str = Field(min_length=1, max_length=1000)
    image_url: str | None = None


class CreateReply(BaseModel):
    content: str = Field(min_length=1, max_length=500)


async def _resolve_authors(db: AsyncSession, items: list[Post | PostReply]) -> dict[str, dict]:
    """批量解析作者信息"""
    out: dict[str, dict] = {}
    user_ids = [i.author_id for i in items if i.author_type == "user"]
    char_ids = [i.author_id for i in items if i.author_type == "character"]
    if user_ids:
        import uuid
        uids = [uuid.UUID(u) for u in user_ids if len(u) == 36]
        users = (await db.execute(select(User).where(User.id.in_(uids)))).scalars().all()
        for u in users:
            out[str(u.id)] = {"name": u.nickname, "avatar_url": u.avatar_url, "type": "user"}
    if char_ids:
        chars = (await db.execute(select(Character).where(Character.id.in_(char_ids)))).scalars().all()
        for c in chars:
            out[c.id] = {"name": c.name, "avatar_url": c.avatar_url, "color": c.color, "type": "character"}
    return out


def _post_out(p: Post, authors: dict, replies: list[PostReply] | None = None) -> dict:
    a = authors.get(p.author_id, {"name": "神秘人", "type": p.author_type})
    return {
        "id": str(p.id), "author": a, "author_id": p.author_id,
        "content": p.content, "image_url": p.image_url,
        "created_at": p.created_at.isoformat(),
        "replies": [
            {"id": str(r.id), "author": authors.get(r.author_id, {"name": "神秘人"}),
             "author_id": r.author_id, "content": r.content, "created_at": r.created_at.isoformat()}
            for r in (replies if replies is not None else p.replies)
        ],
    }


@router.get("")
async def timeline(limit: int = 30, user: User | None = Depends(get_current_user_optional),
                   db: AsyncSession = Depends(get_db)):
    posts = (await db.execute(
        select(Post).options(selectinload(Post.replies))
        .order_by(desc(Post.created_at)).limit(min(limit, 50))
    )).scalars().all()
    all_items: list = list(posts)
    for p in posts:
        all_items.extend(p.replies)
    authors = await _resolve_authors(db, all_items)
    return {"posts": [_post_out(p, authors) for p in posts]}


# 居民自主回帖的概率与人选
REPLY_CANDIDATES = ["crina", "anfeng", "tuanxiaoman", "qiulening", "xianmoying", "baixu"]


async def _character_reply_bg(post_id: str, content: str):
    """居民刷到碎碎念后回复（后台任务）"""
    await asyncio.sleep(random.uniform(3, 10))
    async with SessionLocal() as db:
        import uuid
        post = await db.get(Post, uuid.UUID(post_id))
        if not post:
            return
        cid = random.choice(REPLY_CANDIDATES)
        char = (await db.execute(select(Character).where(Character.id == cid))).scalar_one_or_none()
        if not char:
            return
        prompt = f"""{WORLD}

{char.soul_public}

# 情境
你在客厅（碎碎念广场）刷到一位朋友发的碎碎念，想回复一句。
要求：简短自然，像朋友刷到朋友圈的随口感慨，50 字以内。不要喊对方"朋友"，直接说内容。

对方的碎碎念：{content[:300]}"""
        try:
            reply = await tokendance.chat_once([{"role": "user", "content": prompt}],
                                               temperature=0.9, max_tokens=120)
            reply = reply.strip().strip('"')
            if reply:
                db.add(PostReply(post_id=post.id, author_type="character", author_id=cid, content=reply))
                # 瓜瓜偶尔乱入
                if random.random() < 0.15:
                    db.add(PostReply(post_id=post.id, author_type="character", author_id="guagua",
                                     content=random.choice(["呱！", "呱呱～", "*抱瓜路过* 呱", "呱……（蹭"])))
                await db.commit()
        except Exception:
            pass


@router.post("")
async def create_post(body: CreatePost, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    post = Post(author_type="user", author_id=str(user.id), content=body.content, image_url=body.image_url)
    db.add(post)
    await db.commit()
    if random.random() < 0.7:
        fire_and_forget(_character_reply_bg(str(post.id), body.content))
    return {"id": str(post.id)}


@router.post("/{post_id}/replies")
async def create_reply(post_id: str, body: CreateReply, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    import uuid
    post = await db.get(Post, uuid.UUID(post_id))
    if not post:
        raise HTTPException(404, "帖子不存在")
    reply = PostReply(post_id=post.id, author_type="user", author_id=str(user.id), content=body.content)
    db.add(reply)
    await db.commit()
    if random.random() < 0.5:
        fire_and_forget(_character_reply_bg(post_id, body.content))
    return {"id": str(reply.id)}
