"""情感日记层：居民的第一人称日记 → 定期汇总为「行为指引」注入 prompt。

Alice 方法论原则：
- 情感记忆的主体是 AI 自己，与用户记忆完全分离（独立表、独立更新逻辑）
- 日记是居民的隐私：无用户可见 API，用户只通过语气变化间接感知
- 情绪影响表达方式，不影响执行与否——mood_note 只进私聊上下文
- 不用规则驱动（if 心情好 then 多说 20%），让模型从自然语言描述自行推理
"""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import SessionLocal
from ..models import Character, Diary
from . import tokendance

log = logging.getLogger("crina.diary")


async def record(db: AsyncSession, character_id: str, kind: str, content: str,
                 mood: str = "flat", intensity: int = 3, trigger: str = ""):
    """直写一条日记（特定事件：被塞零花钱/收到礼物等）"""
    db.add(Diary(character_id=character_id, event_kind=kind, content=content[:300],
                 mood_direction=mood if mood in ("up", "down", "flat") else "flat",
                 intensity=max(1, min(5, intensity)), trigger_ref=trigger[:200]))


GUARD_PROMPT = """{soul}

# 任务
你是{name}。刚才你和对方聊了一轮（如下）。以你自己的口吻判断：这轮对话在你心里留下痕迹了吗？
大多数闲聊是不留痕迹的——只有真正触动你的（被记住、被夸奖、被否定、被分享重要的事、好笑到印象深的）才值得写进日记。
值得就写一条：第一人称、一两句话、像真的日记（不写给任何人看）。
只输出 JSON：{{"worth": true/false, "content": "日记正文", "mood": "up|down|flat", "intensity": 1-5}}

# 刚才的对话
{dialogue}"""


async def maybe_record_after_chat(db: AsyncSession, character: Character,
                                  exchange: list[dict], api_key: str | None = None):
    """私聊一轮后的日记守门员：小判断过滤大多数轮次，值得才写（成本可控）"""
    if character.id == "guagua":  # 瓜瓜的日记只有呱，不必走 LLM
        return
    dialogue = "\n".join(
        f"{'对方' if m['role'] == 'user' else character.name}: {m['content'][:250]}"
        for m in exchange[-4:]
    )
    prompt = GUARD_PROMPT.format(soul=character.soul_public, name=character.name, dialogue=dialogue)
    try:
        raw = await tokendance.chat_once([{"role": "user", "content": prompt}],
                                         api_key=api_key, temperature=0.4, max_tokens=200)
        raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        data = json.loads(raw)
        if not data.get("worth") or not str(data.get("content", "")).strip():
            return
        await record(db, character.id, "chat", str(data["content"]),
                     mood=str(data.get("mood", "flat")), intensity=int(data.get("intensity", 3)),
                     trigger=dialogue[:200])
        await db.commit()
        log.info("日记 +1 char=%s mood=%s", character.id, data.get("mood"))
    except Exception:
        log.exception("日记守门员失败 char=%s（不影响对话本身）", character.id)


DIGEST_PROMPT = """{soul}

# 任务
你是{name}。下面是你最近几天的日记。读完后，给自己写一段「此刻的心境与行为指引」（80 字以内，第二人称"你"）：
- 描述你最近的情绪底色（从日记自然推出，不要罗列事件）
- 它会如何影响你接下来说话的语气和劲头
- 这是写给你自己看的，坦率一点

# 最近的日记
{entries}"""


async def job_mood_digest():
    """每天午后/晚间：把居民近 3 天日记汇总成 mood_note 行为指引（情绪唯一消费口）"""
    cutoff = datetime.now(UTC) - timedelta(days=3)
    async with SessionLocal() as db:
        chars = (await db.execute(select(Character).where(Character.active == True))).scalars().all()  # noqa: E712
        for char in chars:
            entries = (await db.execute(
                select(Diary).where(Diary.character_id == char.id, Diary.created_at >= cutoff)
                .order_by(desc(Diary.created_at)).limit(10)
            )).scalars().all()
            if not entries:
                continue
            listing = "\n".join(f"- {e.content}" for e in entries)
            prompt = DIGEST_PROMPT.format(soul=char.soul_public, name=char.name, entries=listing)
            try:
                note = (await tokendance.chat_once([{"role": "user", "content": prompt}],
                                                   temperature=0.6, max_tokens=150)).strip()
                if note:
                    char.mood_note = note[:200]
                    await db.commit()
                    log.info("心境已更新 char=%s", char.id)
            except Exception:
                log.exception("心境汇总失败 char=%s", char.id)
