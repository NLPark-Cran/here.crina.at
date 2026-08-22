"""客厅：碎碎念时间线 + 居民互动"""
from __future__ import annotations

import asyncio
import random

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..bg import fire_and_forget
from ..cache import rate_limit
from ..db import SessionLocal, get_db
from ..engine import tokendance
from ..engine.affinity import bump_affinity
from ..models import POST_EMOJIS, Character, Post, PostFavorite, PostReaction, PostReply, User
from ..security import get_current_user, get_current_user_optional
from ..soul.characters import WORLD

router = APIRouter(prefix="/posts", tags=["posts"])


class CreatePost(BaseModel):
    content: str = Field(min_length=1, max_length=1000)
    image_url: str | None = Field(default=None, max_length=500)

    @field_validator("image_url")
    @classmethod
    def _only_local_assets(cls, v: str | None) -> str | None:
        """只允许本站 /assets/ 图片（防第三方图床收集访客 IP/钓鱼图）"""
        if v is not None and not v.startswith("/assets/"):
            raise ValueError("图片只能用本站素材库里的哦")
        return v


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


def _post_out(p: Post, authors: dict, replies: list[PostReply] | None = None,
              reactions: dict[str, int] | None = None, my_reactions: list[str] | None = None,
              favorited: bool = False) -> dict:
    a = authors.get(p.author_id, {"name": "神秘人", "type": p.author_type})
    return {
        "id": str(p.id), "author": a, "author_id": p.author_id, "kind": p.kind,
        "content": p.content, "image_url": p.image_url,
        "created_at": p.created_at.isoformat(),
        "reactions": reactions or {}, "my_reactions": my_reactions or [], "favorited": favorited,
        "replies": [
            {"id": str(r.id), "author": authors.get(r.author_id, {"name": "神秘人"}),
             "author_id": r.author_id, "content": r.content, "created_at": r.created_at.isoformat()}
            for r in (replies if replies is not None else p.replies)
        ],
    }


async def _reaction_maps(db: AsyncSession, post_ids: list, user: User | None):
    """聚合一批帖子的反应：每帖 {emoji: count} + 当前用户点过的 emoji + 收藏集合"""
    counts: dict = {pid: {} for pid in post_ids}
    mine: dict = {pid: [] for pid in post_ids}
    favs: set = set()
    if not post_ids:
        return counts, mine, favs
    rows = (await db.execute(
        select(PostReaction).where(PostReaction.post_id.in_(post_ids))
    )).scalars().all()
    for r in rows:
        counts[r.post_id][r.emoji] = counts[r.post_id].get(r.emoji, 0) + 1
        if user and r.author_type == "user" and r.author_id == str(user.id):
            mine[r.post_id].append(r.emoji)
    if user:
        fav_rows = (await db.execute(
            select(PostFavorite.post_id).where(PostFavorite.user_id == user.id,
                                               PostFavorite.post_id.in_(post_ids))
        )).scalars().all()
        favs = set(fav_rows)
    return counts, mine, favs


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
    counts, mine, favs = await _reaction_maps(db, [p.id for p in posts], user)
    return {"posts": [_post_out(p, authors, reactions=counts[p.id], my_reactions=mine[p.id],
                                favorited=p.id in favs) for p in posts]}


# 居民自主回帖的概率与人选
REPLY_CANDIDATES = ["crina", "anfeng", "tuanxiaoman", "qiulening", "xianmoying", "baixu", "jingxin"]


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
    if not user.is_owner and not await rate_limit("post", str(user.id), 30):
        raise HTTPException(429, "今天碎碎念够多啦，喝口水明天再聊")
    post = Post(author_type="user", author_id=str(user.id), content=body.content, image_url=body.image_url)
    db.add(post)
    await db.commit()
    await bump_affinity(db, user.id, "post")
    if random.random() < 0.7:
        fire_and_forget(_character_reply_bg(str(post.id), body.content))
    if random.random() < 0.2:
        fire_and_forget(_guagua_react_bg(str(post.id)))
    return {"id": str(post.id)}


class ReactBody(BaseModel):
    emoji: str = Field(min_length=1, max_length=8)


def _parse_post_id(post_id: str):
    import uuid
    try:
        return uuid.UUID(post_id)
    except ValueError:
        raise HTTPException(404, "帖子不存在") from None


@router.post("/{post_id}/reactions")
async def toggle_reaction(post_id: str, body: ReactBody, user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    """emoji 反应 toggle：点过的再点一次就收回"""
    if body.emoji not in POST_EMOJIS:
        raise HTTPException(400, "这个表情不在架子上哦")
    pid = _parse_post_id(post_id)
    if not await db.get(Post, pid):
        raise HTTPException(404, "帖子不存在")
    if not user.is_owner and not await rate_limit("reaction", str(user.id), 120):
        raise HTTPException(429, "今天反应够热烈啦，明天再来")
    existing = (await db.execute(
        select(PostReaction).where(PostReaction.post_id == pid,
                                   PostReaction.author_type == "user",
                                   PostReaction.author_id == str(user.id),
                                   PostReaction.emoji == body.emoji)
    )).scalar_one_or_none()
    if existing:
        await db.delete(existing)
        on = False
    else:
        db.add(PostReaction(post_id=pid, author_type="user", author_id=str(user.id), emoji=body.emoji))
        on = True
    await db.commit()
    count = len((await db.execute(
        select(PostReaction).where(PostReaction.post_id == pid, PostReaction.emoji == body.emoji)
    )).scalars().all())
    return {"emoji": body.emoji, "on": on, "count": count}


@router.post("/{post_id}/favorite")
async def toggle_favorite(post_id: str, user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    pid = _parse_post_id(post_id)
    if not await db.get(Post, pid):
        raise HTTPException(404, "帖子不存在")
    existing = (await db.execute(
        select(PostFavorite).where(PostFavorite.post_id == pid, PostFavorite.user_id == user.id)
    )).scalar_one_or_none()
    if existing:
        await db.delete(existing)
        on = False
    else:
        db.add(PostFavorite(post_id=pid, user_id=user.id))
        on = True
    await db.commit()
    return {"favorited": on}


@router.get("/favorites")
async def my_favorites(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    favs = (await db.execute(
        select(PostFavorite).where(PostFavorite.user_id == user.id)
        .order_by(desc(PostFavorite.created_at)).limit(50)
    )).scalars().all()
    post_ids = [f.post_id for f in favs]
    if not post_ids:
        return {"posts": []}
    posts = (await db.execute(
        select(Post).options(selectinload(Post.replies)).where(Post.id.in_(post_ids))
    )).scalars().all()
    order = {pid: i for i, pid in enumerate(post_ids)}
    posts.sort(key=lambda p: order[p.id])
    all_items: list = list(posts)
    for p in posts:
        all_items.extend(p.replies)
    authors = await _resolve_authors(db, all_items)
    counts, mine, _ = await _reaction_maps(db, post_ids, user)
    return {"posts": [_post_out(p, authors, reactions=counts[p.id], my_reactions=mine[p.id],
                                favorited=True) for p in posts]}


async def _guagua_react_bg(post_id: str):
    """瓜瓜路过随机丢一个 🍉（后台任务，唯一约束兜底防重）"""
    await asyncio.sleep(random.uniform(30, 120))
    async with SessionLocal() as db:
        try:
            db.add(PostReaction(post_id=_parse_post_id(post_id), author_type="character",
                                author_id="guagua", emoji="🍉"))
            await db.commit()
        except Exception:
            pass


@router.post("/{post_id}/replies")
async def create_reply(post_id: str, body: CreateReply, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    import uuid
    try:
        pid = uuid.UUID(post_id)
    except ValueError:
        raise HTTPException(404, "帖子不存在") from None
    post = await db.get(Post, pid)
    if not post:
        raise HTTPException(404, "帖子不存在")
    if not user.is_owner and not await rate_limit("reply", str(user.id), 60):
        raise HTTPException(429, "今天聊得够多啦，明天再继续")
    reply = PostReply(post_id=post.id, author_type="user", author_id=str(user.id), content=body.content)
    db.add(reply)
    await db.commit()
    if random.random() < 0.5:
        fire_and_forget(_character_reply_bg(post_id, body.content))
    return {"id": str(reply.id)}
