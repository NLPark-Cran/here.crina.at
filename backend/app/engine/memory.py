"""分层记忆管道：SOUL → 热记忆 → 对话摘要 → 最近 K 轮"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

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


EXTRACT_PROMPT = """你是记忆管理员。根据新对话，维护关于用户的长期记忆库。

## 什么值得记
- fact：关于用户的稳定客观事实（身份、经历、拥有物、常住地、身体状况等）
- preference：用户明确表达的偏好（喜欢/讨厌/习惯）

## 绝不记（重点！）
- 角色扮演、编故事、玩游戏时产生的虚构内容（那不是用户的真实信息）
- 对话过程的描述（如"用户纠正了某角色""用户问了某个问题"）
- 过度推测的心理画像（如"用户有强烈的向往""用户很孤独"）——只记用户明确说出来的
- 一次性闲聊、客套、当前情绪
- 与已有记忆重复的

## 操作
对比已有记忆，输出操作列表：
- {"op": "add", "kind": "fact|preference", "content": "一句话", "salience": 1-10, "evidence": "用户原话"}
- {"op": "update", "id": "已有记忆id", "content": "更准确的表述"}  （已有记忆不准/过时/需补充时）
- {"op": "delete", "id": "已有记忆id"}  （已有记忆是臆想、虚构或错误时，果断删）
没有任何值得做的就输出空数组 []。宁缺毋滥。

## 已有记忆
__EXISTING__

## 新对话
__DIALOGUE__"""


async def extract_memories(db: AsyncSession, user: User, character_id: str,
                           new_exchange: list[dict], api_key: str | None = None):
    """后台记忆维护：mem0 式 add/update/delete 操作（带原文证据，宁缺毋滥）"""
    import logging
    log = logging.getLogger("crina.memory")

    existing = (await db.execute(
        select(Memory).where(Memory.user_id == user.id)
        .order_by(desc(Memory.salience)).limit(40)
    )).scalars().all()
    existing_block = "\n".join(f'- id={m.id} [{m.kind}] {m.content}' for m in existing) or "（空）"
    dialogue = "\n".join(f"{'用户' if m['role'] == 'user' else '角色'}: {m['content'][:300]}"
                         for m in new_exchange[-6:])
    prompt = EXTRACT_PROMPT.replace("__EXISTING__", existing_block).replace("__DIALOGUE__", dialogue)

    try:
        raw = await tokendance.chat_once([{"role": "user", "content": prompt}],
                                         api_key=api_key, temperature=0.3, max_tokens=600)
        raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        ops = json.loads(raw)
        if not isinstance(ops, list):
            return
    except Exception:
        log.exception("记忆抽取失败")
        return

    by_id = {str(m.id): m for m in existing}
    applied = 0
    for item in ops[:5]:
        try:
            op = item.get("op")
            if op == "add":
                content = str(item["content"]).strip()
                if len(content) < 4:
                    continue
                kind = item["kind"] if item.get("kind") in ("fact", "preference") else "fact"
                salience = min(10, max(1, int(item.get("salience", 5))))
                evidence = str(item.get("evidence", ""))[:300]
                dup = (await db.execute(
                    select(Memory).where(Memory.user_id == user.id, Memory.content == content)
                )).scalar_one_or_none()
                if dup:
                    continue
                db.add(Memory(user_id=user.id, character_id=character_id, kind=kind,
                              content=content, salience=salience, evidence=evidence))
                applied += 1
            elif op == "update":
                mem = by_id.get(str(item.get("id")))
                if mem:
                    new_content = str(item["content"]).strip()
                    if len(new_content) >= 4:
                        mem.content = new_content
                        applied += 1
            elif op == "delete":
                mem = by_id.get(str(item.get("id")))
                if mem:
                    await db.delete(mem)
                    applied += 1
        except Exception:
            continue
    if applied:
        await db.commit()
        log.info("记忆维护完成 user=%s ops=%d", user.id, applied)


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
