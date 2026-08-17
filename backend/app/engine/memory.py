"""分层记忆管道：SOUL → 热记忆 → 对话摘要 → 最近 K 轮"""
from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Character, Conversation, Memory, Message, User
from ..soul.characters import MODE_PROMPTS, WORLD
from . import tokendance

RECENT_K = 20
HOT_MEMORY_LIMIT = 12
CST = timezone(timedelta(hours=8))


# SOUL 前缀缓存（WORLD+人设是不变的大字符串，按 character+是否站主缓存）
_SOUL_CACHE: dict[tuple[str, bool], str] = {}


def _soul_block(character: Character, is_owner: bool) -> str:
    key = (character.id, is_owner)
    if key not in _SOUL_CACHE:
        soul = character.soul_public
        if is_owner and character.soul_private:
            soul += "\n\n" + character.soul_private
        _SOUL_CACHE[key] = f"{WORLD}\n\n{soul}"
    return _SOUL_CACHE[key]


async def build_context(db: AsyncSession, user: User, character: Character,
                        conversation: Conversation, mode: str) -> list[dict]:
    """组装分层上下文"""
    now = datetime.now(CST)
    soul_block = _soul_block(character, user.is_owner)

    # 热记忆（按重要性）
    mems = (await db.execute(
        select(Memory).where(Memory.user_id == user.id)
        .order_by(desc(Memory.salience), desc(Memory.created_at)).limit(HOT_MEMORY_LIMIT)
    )).scalars().all()
    mem_block = ""
    if mems:
        lines = [f"- [{m.kind}] {m.content}" for m in mems]
        mem_block = "\n\n# 你记得的关于这位朋友的事\n" + "\n".join(lines)

    summary_block = ""
    if conversation.summary:
        summary_block = f"\n\n# 到目前为止你们聊过的（摘要）\n{conversation.summary}"

    mode_prompt = MODE_PROMPTS.get(mode, "")

    # 特别的朋友识别（如安风的原型本尊到访）
    from ..soul.characters import SPECIAL_FRIENDS
    special_note = ""
    if user.email:
        hit = SPECIAL_FRIENDS.get(user.email.strip().lower())
        if hit and hit[0] == character.id:
            special_note = f"\n- ⭐ {hit[1]}（按人设要求自然反应，别念设定）"

    system = f"""{soul_block}

# 当前情境
- 现在时间：{now.strftime('%Y年%m月%d日 %H:%M')}（{'凌晨' if now.hour < 6 else '上午' if now.hour < 12 else '下午' if now.hour < 18 else '晚上'}）
- 你在私聊间里和 {user.nickname}（关系：{user.relation_tier}）聊天
{mode_prompt}{special_note}
{mem_block}
{summary_block}

请始终保持人格，用自然的方式回复。回复不要太长，像真的在聊天一样。"""

    messages: list[dict] = [{"role": "system", "content": system}]

    recent = (await db.execute(
        select(Message).where(Message.conversation_id == conversation.id)
        .order_by(desc(Message.created_at)).limit(RECENT_K)
    )).scalars().all()
    for m in reversed(recent):
        if m.role == "user":
            messages.append({"role": "user", "content": m.content})
        elif m.role == "character":
            # 圆桌时标注是谁说的
            prefix = f"【{m.character_id}】" if m.character_id and m.character_id != character.id else ""
            messages.append({"role": "assistant", "content": prefix + m.content})
        elif m.role == "narrator":
            messages.append({"role": "user", "content": f"%[{m.content}]%"})
    return messages


EXTRACT_PROMPT = """从这段对话中，提取值得长期记住的关于用户的信息。
只提取：稳定的事实（fact）、明确的偏好（preference）。不要提取一次性的闲聊。
如果没有值得记住的，输出空数组。

以 JSON 数组输出，每项：{"kind": "fact|preference", "content": "一句话", "salience": 1-10}
对话：
__DIALOGUE__"""


async def extract_memories(db: AsyncSession, user: User, character_id: str,
                           new_exchange: list[dict], api_key: str | None = None):
    """后台记忆抽取"""
    dialogue = "\n".join(f"{'用户' if m['role'] == 'user' else '角色'}: {m['content'][:300]}"
                         for m in new_exchange[-6:])
    import logging
    log = logging.getLogger("crina.memory")
    try:
        raw = await tokendance.chat_once([{"role": "user", "content": EXTRACT_PROMPT.replace("__DIALOGUE__", dialogue)}],
                              api_key=api_key, temperature=0.3, max_tokens=400)
        raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        items = json.loads(raw)
        if not isinstance(items, list):
            return
    except Exception:
        log.exception("记忆抽取失败")
        return
    for item in items[:3]:
        try:
            content = str(item["content"]).strip()
            kind = item["kind"] if item["kind"] in ("fact", "preference") else "fact"
            salience = min(10, max(1, int(item.get("salience", 5))))
        except Exception:
            continue
        if not content or len(content) < 4:
            continue
        # 简单去重
        dup = (await db.execute(
            select(Memory).where(Memory.user_id == user.id, Memory.content == content)
        )).scalar_one_or_none()
        if dup:
            continue
        db.add(Memory(user_id=user.id, character_id=character_id, kind=kind,
                      content=content, salience=salience))
    await db.commit()


SUMMARY_PROMPT = """把这段对话的进展合并进已有的对话摘要。保留关键事实与情绪线索，控制在 150 字以内。
已有摘要：{old}
新对话：
{dialogue}"""


async def update_summary(db: AsyncSession, conversation: Conversation,
                         new_exchange: list[dict], api_key: str | None = None):
    dialogue = "\n".join(f"{'用户' if m['role'] == 'user' else '角色'}: {m['content'][:200]}"
                         for m in new_exchange[-8:])
    try:
        conversation.summary = await tokendance.chat_once(
            [{"role": "user", "content": SUMMARY_PROMPT.format(old=conversation.summary or "（无）", dialogue=dialogue)}],
            api_key=api_key, temperature=0.3, max_tokens=300)
        await db.commit()
    except Exception:
        pass
