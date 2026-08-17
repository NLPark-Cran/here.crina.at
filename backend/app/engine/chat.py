"""聊天编排器：单聊流式 + 脑暴圆桌 + 配额/BYOK"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..bg import fire_and_forget
from ..config import get_settings
from ..db import SessionLocal
from ..models import Character, Conversation, Message, OAuthAccount, UsageCounter, User
from ..security import decrypt_payload
from . import memory, tokendance

settings = get_settings()

BRAINSTORM_CANDIDATES = ["anfeng", "xianmoying", "baixu", "tuanxiaoman", "qiulening"]


async def get_user_api_key(db: AsyncSession, user: User, kind: str) -> tuple[str | None, bool]:
    """返回 (api_key, 是否BYOK)。BYOK 用户用自己的词元蓄电池"""
    acct = (await db.execute(
        select(OAuthAccount).where(OAuthAccount.user_id == user.id, OAuthAccount.provider == "tokendance")
    )).scalar_one_or_none()
    if acct:
        try:
            payload = decrypt_payload(acct.payload_enc)
            if payload.get("api_key"):
                return payload["api_key"], True
        except Exception:
            pass
    return settings.tokendance_api_key or None, False


async def check_and_count_quota(db: AsyncSession, user: User, kind: str, is_byok: bool) -> None:
    """站点额度用户计配额；BYOK 不限"""
    if is_byok or user.is_owner:
        return
    limits = {"chat": settings.quota_chat_per_day, "agent": settings.quota_agent_per_day,
              "tts": settings.quota_tts_per_day}
    today = date.today()
    row = (await db.execute(
        select(UsageCounter).where(UsageCounter.user_id == user.id,
                                   UsageCounter.day == today, UsageCounter.kind == kind)
    )).scalar_one_or_none()
    if row and row.count >= limits.get(kind, 50):
        raise QuotaExceeded(kind)
    if row:
        row.count += 1
    else:
        db.add(UsageCounter(user_id=user.id, day=today, kind=kind, count=1))
    await db.commit()


class QuotaExceeded(Exception):
    def __init__(self, kind: str):
        self.kind = kind


def sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


async def _stream_character(db: AsyncSession, user: User, character: Character,
                            conversation: Conversation, mode: str, api_key: str | None,
                            round_note: str = "") -> AsyncGenerator[tuple[str, str], None]:
    """流式生成一位居民的回复，产出 (event_type, text)；完整文本最后入库"""
    ctx = await memory.build_context(db, user, character, conversation, mode)
    if round_note:
        ctx.append({"role": "user", "content": round_note})
    full = ""
    async for delta in tokendance.chat_stream(ctx, api_key=api_key):
        full += delta
        yield "delta", delta
    msg = Message(conversation_id=conversation.id, role="character",
                  character_id=character.id, content=full)
    db.add(msg)
    await db.commit()
    yield "saved", full


async def stream_reply(conversation_id: str, user: User, content: str,
                       db: AsyncSession) -> AsyncGenerator[str, None]:
    """主入口：SSE 事件流"""
    import uuid as _uuid
    conv_id = _uuid.UUID(conversation_id)
    conversation = (await db.execute(select(Conversation).where(
        Conversation.id == conv_id, Conversation.user_id == user.id))).scalar_one_or_none()
    if not conversation:
        yield sse({"type": "error", "message": "对话不存在"})
        return

    api_key, is_byok = await get_user_api_key(db, user, "chat")
    if not api_key:
        yield sse({"type": "error", "message": "站点词元池未配置，请先在设置里接入词元蓄电池"})
        return
    try:
        await check_and_count_quota(db, user, "chat", is_byok)
    except QuotaExceeded:
        yield sse({"type": "error", "message": "今日站点额度用完啦，接入自己的词元蓄电池可以无限畅聊（设置 → 词元蓄电池）"})
        return

    # 存入用户消息
    db.add(Message(conversation_id=conversation.id, role="user", content=content))
    await db.commit()

    main_char = (await db.execute(select(Character).where(Character.id == conversation.character_id))).scalar_one()
    mode = conversation.mode
    exchange: list[dict] = [{"role": "user", "content": content}]

    try:
        if mode == "brainstorm":
            async for ev in _brainstorm(db, user, conversation, main_char, api_key, exchange):
                yield ev
        else:
            yield sse({"type": "speaker", "character": main_char.id, "name": main_char.name,
                       "color": main_char.color, "avatar_url": main_char.avatar_url})
            full = ""
            async for etype, text in _stream_character(db, user, main_char, conversation, mode, api_key):
                if etype == "delta":
                    yield sse({"type": "delta", "character": main_char.id, "text": text})
                elif etype == "saved":
                    full = text
            exchange.append({"role": "assistant", "content": full})
    except Exception as e:
        yield sse({"type": "error", "message": f"生成失败：{e}"})
        return

    # 后台：记忆抽取 + 摘要
    import logging
    log = logging.getLogger("crina.bg")

    async def _bg():
        try:
            async with SessionLocal() as s:
                fresh_user = await s.get(User, user.id)
                conv = await s.get(Conversation, conversation.id)
                if fresh_user and conv:
                    await memory.extract_memories(s, fresh_user, main_char.id, exchange, api_key)
                    await memory.update_summary(s, conv, exchange, api_key)
                    log.info("后台记忆/摘要完成 conv=%s", conversation.id)
        except Exception:
            log.exception("后台记忆任务失败")
    fire_and_forget(_bg())

    # 自动起标题
    if not conversation.title:
        conversation.title = content[:20]
        await db.commit()

    yield sse({"type": "done"})


async def _brainstorm(db: AsyncSession, user: User, conversation: Conversation,
                      main_char: Character, api_key: str | None,
                      exchange: list[dict]) -> AsyncGenerator[str, None]:
    """脑暴圆桌：选 2-3 位居民 + 主角收尾"""
    chars = (await db.execute(select(Character).where(
        Character.id.in_(BRAINSTORM_CANDIDATES), Character.active == True))).scalars().all()  # noqa: E712
    char_map = {c.id: c for c in chars}

    # 轻量规划：让模型挑居民
    pick_prompt = (
        "圆桌脑暴即将开始。话题如下。从居民中选择 2 位最适合参与讨论的（考虑各自视角互补），"
        "只输出 id 逗号分隔。\n"
        f"可选居民：{', '.join(f'{c.id}({c.tagline})' for c in chars)}\n"
        f"话题：{exchange[0]['content'][:200]}"
    )
    picked: list[str] = []
    try:
        raw = await tokendance.chat_once([{"role": "user", "content": pick_prompt}],
                                         api_key=api_key, temperature=0.4, max_tokens=40)
        picked = [p.strip() for p in raw.replace("，", ",").split(",") if p.strip() in char_map][:2]
    except Exception:
        pass
    if not picked:
        picked = [cid for cid in ("anfeng", "baixu") if cid in char_map][:2]

    for cid in picked:
        c = char_map[cid]
        yield sse({"type": "speaker", "character": c.id, "name": c.name,
                   "color": c.color, "avatar_url": c.avatar_url})
        note = "（圆桌脑暴进行中，请从你的独特视角简洁地发表看法，可以接前一位的话，100 字左右）"
        full = ""
        async for etype, text in _stream_character(db, user, c, conversation, "brainstorm", api_key, note):
            if etype == "delta":
                yield sse({"type": "delta", "character": c.id, "text": text})
            elif etype == "saved":
                full = text
        exchange.append({"role": "assistant", "content": f"【{c.name}】{full}"})

    # 主角收尾
    yield sse({"type": "speaker", "character": main_char.id, "name": main_char.name,
               "color": main_char.color, "avatar_url": main_char.avatar_url})
    note = "（圆桌脑暴收尾：综合大家的观点给出你的想法，自然一点，别像总结报告）"
    full = ""
    async for etype, text in _stream_character(db, user, main_char, conversation, "brainstorm", api_key, note):
        if etype == "delta":
            yield sse({"type": "delta", "character": main_char.id, "text": text})
        elif etype == "saved":
            full = text
    exchange.append({"role": "assistant", "content": full})
