"""长文：博客 / 观鸟笔记 / crina 代笔日报 + 帮我把这些整理成文"""
from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..cache import rate_limit
from ..db import get_db
from ..engine import tokendance
from ..models import Article, Character, Conversation, Message, User
from ..security import get_current_user, get_current_user_optional
from ..soul.characters import WORLD
from .posts import _resolve_authors

router = APIRouter(prefix="/articles", tags=["articles"])

USER_KINDS = ("article", "birdnote")  # daily 只有 crina 日报 job 能写


def _brief_out(a: Article, authors: dict) -> dict:
    author = authors.get(a.author_id, {"name": "神秘人", "type": a.author_type})
    return {
        "id": str(a.id), "title": a.title, "summary": a.summary, "kind": a.kind,
        "public": a.public, "views": a.views, "author": author,
        "created_at": a.created_at.isoformat(), "updated_at": a.updated_at.isoformat(),
    }


def _full_out(a: Article, authors: dict) -> dict:
    return {**_brief_out(a, authors), "content": a.content, "author_id": a.author_id,
            "author_type": a.author_type}


@router.get("/public")
async def public_feed(limit: int = 20, before: datetime | None = None, kind: str | None = None,
                      db: AsyncSession = Depends(get_db)):
    """公开文章流（免登录，created_at 游标分页，可按 kind 过滤如 daily）"""
    q = select(Article).where(Article.public == True)  # noqa: E712
    if before:
        q = q.where(Article.created_at < before)
    if kind in ("article", "daily", "birdnote"):
        q = q.where(Article.kind == kind)
    articles = (await db.execute(
        q.order_by(desc(Article.created_at)).limit(min(limit, 50))
    )).scalars().all()
    authors = await _resolve_authors(db, list(articles))
    return {"articles": [_brief_out(a, authors) for a in articles]}


@router.get("/mine")
async def my_articles(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    articles = (await db.execute(
        select(Article).where(Article.author_type == "user", Article.author_id == str(user.id))
        .order_by(desc(Article.created_at)).limit(100)
    )).scalars().all()
    authors = await _resolve_authors(db, list(articles))
    return {"articles": [_brief_out(a, authors) for a in articles]}


class ComposeBody(BaseModel):
    raw_text: str = Field(min_length=1, max_length=20000)
    kind: str = "article"
    conversation_id: str | None = None

    @field_validator("kind")
    @classmethod
    def _user_kind(cls, v: str) -> str:
        if v not in USER_KINDS:
            raise ValueError("kind 只支持 article / birdnote")
        return v


class ClipBody(BaseModel):
    text: str = Field(min_length=2, max_length=500)


@router.post("/{article_id}/clip")
async def clip_article(article_id: str, body: ClipBody, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    """摘抄即记忆：文章划词 → 存档案馆（wiki kind='clip'）+ 写 clip 记忆（R9.4）"""
    from ..security import parse_uuid
    article = await db.get(Article, parse_uuid(article_id))
    if not article:
        raise HTTPException(404, "文章不存在")
    text = body.text.strip()
    if text not in article.content:
        raise HTTPException(400, "这段话不在原文里哦")
    if not user.is_owner and not await rate_limit("clip", str(user.id), 20):
        raise HTTPException(429, "今天摘抄得够多啦，明天再来")
    from ..models import WikiPage
    db.add(WikiPage(user_id=user.id, title=f"摘抄 · {article.title[:40]}",
                    content=text, mode="clip", public=False))
    from ..engine.memory import clip_memory
    await clip_memory(db, user, text, f"《{article.title}》")
    await db.commit()
    return {"ok": True}


@router.post("/compose")
async def compose(body: ComposeBody, user: User = Depends(get_current_user),
                  db: AsyncSession = Depends(get_db)):
    """「帮我把这些整理成文」：crina 把碎碎念/聊天记录整理成文，返回草稿不落库"""
    if not user.is_owner and not await rate_limit("compose", str(user.id), 10):
        raise HTTPException(429, "今天整理得够多啦，明天再写")
    material = body.raw_text.strip()
    if body.conversation_id:
        from ..security import parse_uuid
        try:
            conv_id = parse_uuid(body.conversation_id)
        except HTTPException:
            raise HTTPException(404, "这段对话找不到了") from None
        conv = await db.get(Conversation, conv_id)
        if not conv or conv.user_id != user.id:
            raise HTTPException(404, "这段对话找不到了")
        msgs = (await db.execute(
            select(Message).where(Message.conversation_id == conv.id, Message.role.in_(["user", "character"]))
            .order_by(desc(Message.seq)).limit(20)
        )).scalars().all()
        dialogue = "\n".join(f"{'朋友' if m.role == 'user' else 'crina'}: {m.content[:300]}"
                             for m in reversed(msgs))
        material += f"\n\n【附：相关聊天记录】\n{dialogue}"
    crina = await db.get(Character, "crina")
    kind_name = "观鸟笔记" if body.kind == "birdnote" else "文章"
    prompt = f"""{WORLD}

{crina.soul_public if crina else ""}

# 任务
你是 crina，帮 {user.nickname} 把下面的原始材料整理成一篇{kind_name}。
铁律：内容必须忠于原材料，原材料没有的事实绝不臆造；拿不准的地方宁可照原文引用。
要求：保留 TA 的口吻和细节，理顺结构、补上过渡；用 Markdown 排版。
只输出 JSON：{{"title": "标题（20字内）", "summary": "一句话摘要（40字内）", "content": "正文 Markdown"}}

# 原始材料
{material[:18000]}"""
    try:
        raw = await tokendance.chat_once([{"role": "user", "content": prompt}],
                                         temperature=0.6, max_tokens=3000)
        raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        draft = json.loads(raw)
        return {"title": str(draft["title"])[:200], "summary": str(draft.get("summary", ""))[:300],
                "content": str(draft["content"]), "kind": body.kind}
    except (json.JSONDecodeError, KeyError, TypeError):
        raise HTTPException(502, "crina 写着写着走神了，再试一次吧") from None


class UpsertArticle(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=50000)
    summary: str = Field(default="", max_length=300)
    kind: str = "article"
    public: bool = False

    @field_validator("kind")
    @classmethod
    def _user_kind(cls, v: str) -> str:
        if v not in USER_KINDS:
            raise ValueError("kind 只支持 article / birdnote")
        return v


@router.post("")
async def create_article(body: UpsertArticle, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    if not user.is_owner and not await rate_limit("article", str(user.id), 10):
        raise HTTPException(429, "今天写得够多啦，灵感存草稿明天发")
    article = Article(author_type="user", author_id=str(user.id), title=body.title.strip(),
                      content=body.content, summary=body.summary.strip(),
                      kind=body.kind, public=body.public)
    db.add(article)
    await db.commit()
    return {"id": str(article.id)}


async def _get_own(db: AsyncSession, article_id: str, user: User) -> Article:
    from ..security import parse_uuid
    article = await db.get(Article, parse_uuid(article_id))
    if not article or article.author_type != "user" or article.author_id != str(user.id):
        raise HTTPException(404, "这篇文找不到啦")
    return article


@router.put("/{article_id}")
async def update_article(article_id: str, body: UpsertArticle, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    article = await _get_own(db, article_id, user)
    article.title = body.title.strip()
    article.content = body.content
    article.summary = body.summary.strip()
    article.kind = body.kind
    article.public = body.public
    await db.commit()
    return {"ok": True}


@router.delete("/{article_id}")
async def delete_article(article_id: str, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    article = await _get_own(db, article_id, user)
    await db.delete(article)
    await db.commit()
    return {"ok": True}


@router.get("/{article_id}")
async def read_article(article_id: str, user: User | None = Depends(get_current_user_optional),
                       db: AsyncSession = Depends(get_db)):
    """公开或本人可读；非作者阅读时 views+1"""
    from ..security import parse_uuid
    try:
        aid = parse_uuid(article_id)
    except HTTPException:
        raise HTTPException(404, "这篇文找不到啦") from None
    article = await db.get(Article, aid)
    if not article:
        raise HTTPException(404, "这篇文找不到啦")
    is_author = bool(user and article.author_type == "user" and article.author_id == str(user.id))
    if not article.public and not is_author:
        raise HTTPException(404, "这篇文还没有公开哦")
    authors = await _resolve_authors(db, [article])
    out = _full_out(article, authors)
    if not is_author:
        article.views += 1
        await db.commit()  # 序列化在 commit 前：updated_at 的 onupdate 会在提交后过期（懒加载炸 MissingGreenlet）
    return {"article": out, "is_author": is_author}
