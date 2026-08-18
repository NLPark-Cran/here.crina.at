"""镜听空间 · 数据模型（PostgreSQL）"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def uid() -> uuid.UUID:
    return uuid.uuid4()


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    watcha_user_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    nickname: Mapped[str] = mapped_column(String(64))
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_owner: Mapped[bool] = mapped_column(Boolean, default=False)
    relation_tier: Mapped[str] = mapped_column(String(16), default="陌生")  # 陌生→熟人→老友
    notify_email: Mapped[bool] = mapped_column(Boolean, default=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Shanghai")  # IANA 时区，问候信/提醒按此触发
    affinity: Mapped[int] = mapped_column(Integer, default=0)  # 熟悉度：互动累积，跨阈值自动升 relation_tier
    ics_token: Mapped[str] = mapped_column(String(64), default="")  # 日历订阅专用只读 token（可重置，非会话 JWT）
    handle: Mapped[str | None] = mapped_column(String(32), unique=True, index=True, nullable=True)  # 房间地址 /@handle（默认观猹ID，可改）
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OAuthAccount(Base):
    """第三方授权凭据（观猹/Google/TokenDance BYOK），token 全部 Fernet 加密落库"""
    __tablename__ = "oauth_accounts"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_oauth_user_provider"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32))  # watcha / google / tokendance
    payload_enc: Mapped[str] = mapped_column(Text)  # 加密后的 JSON（access/refresh/api_key...）
    scopes: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Character(Base):
    """空间居民"""
    __tablename__ = "characters"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # slug: crina/anfeng/...
    name: Mapped[str] = mapped_column(String(32))
    tagline: Mapped[str] = mapped_column(String(128), default="")
    mbti: Mapped[str] = mapped_column(String(8), default="")
    color: Mapped[str] = mapped_column(String(16), default="#8A8FC4")
    avatar_url: Mapped[str] = mapped_column(Text, default="")
    soul_public: Mapped[str] = mapped_column(Text, default="")   # 公开层人设
    soul_private: Mapped[str] = mapped_column(Text, default="")  # 站主私有层人设
    voice_id: Mapped[str] = mapped_column(String(64), default="")
    is_agent: Mapped[bool] = mapped_column(Boolean, default=False)  # crina 才有干活能力
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    status_text: Mapped[str] = mapped_column(String(16), default="")  # 状态墙：2-6 字当下状态，调度器每 4-10h 换新
    status_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    mood_note: Mapped[str] = mapped_column(String(200), default="")  # 情感日记产出的「行为指引」，注入私聊 prompt


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    character_id: Mapped[str] = mapped_column(String(32), ForeignKey("characters.id"), default="crina")
    mode: Mapped[str] = mapped_column(String(16), default="auto")  # auto/brainstorm/guide/probe/extract/off
    folder: Mapped[str] = mapped_column(String(32), default="")  # 空=未分组；emind=旧家导入
    title: Mapped[str] = mapped_column(String(128), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    messages: Mapped[list[Message]] = relationship(back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
    """append-only"""
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)  # 单调序号：同秒消息排序稳定
    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16))  # user / character / narrator
    character_id: Mapped[str | None] = mapped_column(String(32), nullable=True)  # 哪位居民说的
    kind: Mapped[str] = mapped_column(String(16), default="text")  # text / action / narration
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class Memory(Base):
    """分层记忆：fact 事实 / preference 偏好 / summary 摘要"""
    __tablename__ = "memories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    character_id: Mapped[str] = mapped_column(String(32), default="crina")
    kind: Mapped[str] = mapped_column(String(16))  # fact / preference / summary
    content: Mapped[str] = mapped_column(Text)
    salience: Mapped[int] = mapped_column(Integer, default=5)  # 1-10 重要性
    evidence: Mapped[str] = mapped_column(Text, default="")  # 原文证据
    embedding: Mapped[str] = mapped_column(Text, default="")  # JSON 向量（qwen-text-embedding-v4），相关性召回用
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Post(Base):
    """碎碎念（居民与朋友们的客厅时间线）"""
    __tablename__ = "posts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    author_type: Mapped[str] = mapped_column(String(16))  # user / character
    author_id: Mapped[str] = mapped_column(String(64), index=True)  # user uuid str / character slug
    kind: Mapped[str] = mapped_column(String(16), default="post")  # post 碎碎念 / visit 串门小事件
    content: Mapped[str] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    replies: Mapped[list[PostReply]] = relationship(back_populates="post", cascade="all, delete-orphan")


class PostReply(Base):
    __tablename__ = "post_replies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    post_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    author_type: Mapped[str] = mapped_column(String(16))
    author_id: Mapped[str] = mapped_column(String(64))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    post: Mapped[Post] = relationship(back_populates="replies")


# 客厅反应允许的 emoji（瓜瓜的 🍉 也在里面）
POST_EMOJIS = ("❤️", "🍉", "🦉", "😂", "🤔")


class PostReaction(Base):
    """客厅帖子的 emoji 反应（双态作者：用户/居民），同作者同 emoji 唯一——toggle 语义"""
    __tablename__ = "post_reactions"
    __table_args__ = (UniqueConstraint("post_id", "author_type", "author_id", "emoji", name="uq_reaction"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    post_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    author_type: Mapped[str] = mapped_column(String(16))
    author_id: Mapped[str] = mapped_column(String(64))
    emoji: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PostFavorite(Base):
    """客厅帖子收藏（仅登录用户）"""
    __tablename__ = "post_favorites"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_favorite"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    post_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Diary(Base):
    """居民的第一人称情感日记（AI 的隐私：无用户可见 API，只产出 mood_note 行为指引）"""
    __tablename__ = "diaries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    character_id: Mapped[str] = mapped_column(String(32), ForeignKey("characters.id"), index=True)
    event_kind: Mapped[str] = mapped_column(String(16), default="chat")  # chat / gift / daily / system
    content: Mapped[str] = mapped_column(Text)  # 第一人称
    mood_direction: Mapped[str] = mapped_column(String(8), default="flat")  # up / down / flat
    intensity: Mapped[int] = mapped_column(Integer, default=3)  # 1-5
    trigger_ref: Mapped[str] = mapped_column(Text, default="")  # 触发上下文摘要
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DayPlan(Base):
    """居民的全天剧本（DayScript）：每天凌晨预写，状态墙/串门/碎碎念/私聊/日报共享同一状态机。
    events 是 JSON 数组：[{slot,kind,location,activity,mood,note}]——事件必须是结构体（Alice 教训）"""
    __tablename__ = "day_plans"
    __table_args__ = (UniqueConstraint("character_id", "plan_date", name="uq_dayplan"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    character_id: Mapped[str] = mapped_column(String(32), ForeignKey("characters.id"), index=True)
    plan_date: Mapped[date] = mapped_column(Date, index=True)
    weather: Mapped[str] = mapped_column(String(32), default="")  # 当天天气（全空间一致，wttr.in 杭州）
    events: Mapped[str] = mapped_column(Text, default="[]")  # JSON 事件结构体数组
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Article(Base):
    """长文（博客 article / crina 代笔日报 daily / 观鸟笔记 birdnote），可公开分享"""
    __tablename__ = "articles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    author_type: Mapped[str] = mapped_column(String(16))  # user / character
    author_id: Mapped[str] = mapped_column(String(64), index=True)  # user uuid str / character slug
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(String(300), default="")
    kind: Mapped[str] = mapped_column(String(16), default="article")  # article / daily / birdnote
    public: Mapped[bool] = mapped_column(Boolean, default=False)
    views: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Event(Base):
    """日历事件（可 ICS 导出 / 邮件提醒）"""
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remind_minutes: Mapped[int] = mapped_column(Integer, default=60)
    reminded: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual / crina / import / google
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Letter(Base):
    """信箱：主动来信（问候/提醒/贺卡/回信）"""
    __tablename__ = "letters"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    character_id: Mapped[str] = mapped_column(String(32), default="crina")
    kind: Mapped[str] = mapped_column(String(16), default="greeting")  # greeting / reminder / holiday / reply
    title: Mapped[str] = mapped_column(String(128), default="")
    content: Mapped[str] = mapped_column(Text)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    emailed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class Document(Base):
    """用户上传的文档（PDF/DOCX/图片 → 提取文本，可被聊天/委托引用）"""
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(16))  # pdf / docx / image
    path: Mapped[str] = mapped_column(String(512))  # 沙箱内相对路径
    text: Mapped[str] = mapped_column(Text, default="")  # 提取出的文本
    chars: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WikiPage(Base):
    """档案馆 · 探讨沉淀"""
    __tablename__ = "wiki_pages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    title: Mapped[str] = mapped_column(String(128))
    content: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(String(16), default="extract")
    source_conversation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    public: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AgentTask(Base):
    """委托板：干活任务"""
    __tablename__ = "agent_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(128))
    prompt: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)  # queued/running/done/failed/cancelled
    target: Mapped[str] = mapped_column(String(16), default="sandbox")  # sandbox 沙箱 / renovate 空间装修（主人专属）
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result_summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WardrobeItem(Base):
    """crina 的衣橱/空间摆件（用小金库购置）"""
    __tablename__ = "wardrobe_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String(16))  # outfit 装扮 / decor 摆件
    title: Mapped[str] = mapped_column(String(64))
    image_url: Mapped[str] = mapped_column(Text)
    cost: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str] = mapped_column(Text, default="")
    wearing: Mapped[bool] = mapped_column(Boolean, default=False)  # 当前穿搭
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PurseLedger(Base):
    """小金库流水（镜币）"""
    __tablename__ = "purse_ledger"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    delta: Mapped[int] = mapped_column(Integer)  # 正进负出
    reason: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UsageCounter(Base):
    """每日配额计数"""
    __tablename__ = "usage_counters"
    __table_args__ = (UniqueConstraint("user_id", "day", "kind", name="uq_usage"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(16))  # chat / agent / tts
    count: Mapped[int] = mapped_column(Integer, default=0)
