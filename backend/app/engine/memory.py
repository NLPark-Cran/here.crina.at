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
RECALL_POOL = 60  # 候选池：先按重要性取前 N，再按语义相关性重排
CST = timezone(timedelta(hours=8))


def _cosine(a: list[float], b: list[float]) -> float:
    dot = na = nb = 0.0
    for x, y in zip(a, b, strict=False):
        dot += x * y
        na += x * x
        nb += y * y
    return dot / ((na ** 0.5) * (nb ** 0.5) + 1e-9)


async def _recall(db: AsyncSession, user: User, query: str) -> list:
    """语义召回：候选池按 salience 取前 RECALL_POOL，有余力的用 embedding 余弦重排。
    无向量/无查询时退化为纯重要性排序。"""
    import logging
    mems = list((await db.execute(
        select(Memory).where(Memory.user_id == user.id)
        .order_by(desc(Memory.salience), desc(Memory.created_at)).limit(RECALL_POOL)
    )).scalars().all())
    if not mems:
        return mems
    scored = [m for m in mems if m.embedding]
    if not query or not scored:
        return mems[:HOT_MEMORY_LIMIT]
    try:
        q = (await tokendance.embed([query]))[0]
    except Exception:
        logging.getLogger("crina.memory").exception("查询向量化失败，退化为重要性排序")
        return mems[:HOT_MEMORY_LIMIT]

    def score(m) -> float:
        if not m.embedding:
            return 0.15 * (m.salience / 10)  # 无向量的只靠重要性，排在有相关性的后面
        try:
            vec = json.loads(m.embedding)
            return _cosine(q, vec) + 0.15 * (m.salience / 10)
        except Exception:
            return 0.0

    return sorted(mems, key=score, reverse=True)[:HOT_MEMORY_LIMIT]


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
                        conversation: Conversation, mode: str, aside: bool = True) -> list[dict]:
    """组装分层上下文；aside=True 时要求居民在正文后附一句内心独白（蛐蛐）"""
    now = datetime.now(CST)
    soul_block = _soul_block(character, user.is_owner)

    mem_block = ""
    summary_block = ""
    if conversation.summary:
        summary_block = f"\n\n# 到目前为止你们聊过的（摘要）\n{conversation.summary}"

    mode_prompt = MODE_PROMPTS.get(mode, "")

    # DayPlan：居民此刻正在做的事（同一状态机，防瞬移）
    from . import dayplan
    state_line = ""
    state = await dayplan.current_state(db, character.id)
    if state:
        ev, weather = state["event"], state["weather"]
        state_line = (f"- 你此刻正在{ev['location']}：{ev['activity']}"
                      f"{'（今天天气：' + weather + '）' if weather else ''}——你的言行要和这个状态自洽")
    # 蛐蛐：性格句式而非行为许可（Alice 方法论："你有 X 的习惯" ≫ "你可以偶尔 X"）
    aside_prompt = ""
    if aside:
        aside_prompt = (
            "\n- 你有内心独白的习惯：回复正文之后另起一段，用 <aside>…</aside> 写一句只说给自己听的小声嘀咕"
            "（20 字以内，口语化，带点当下的小情绪）。正文保持完整自然，别在正文里提到这句嘀咕。"
        )

    # 热记忆：语义相关性召回（以本会话最近一条用户消息为查询）
    last_user_msg = (await db.execute(
        select(Message.content).where(
            Message.conversation_id == conversation.id, Message.role == "user")
        .order_by(desc(Message.seq)).limit(1)
    )).scalar_one_or_none()
    mems = await _recall(db, user, last_user_msg or "")
    if mems:
        lines = [f"- [{m.kind}] {m.content}" for m in mems]
        mem_block = "\n\n# 你记得的关于这位朋友的事\n" + "\n".join(lines)

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
{state_line}
{mode_prompt}{special_note}{aside_prompt}
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
    pending_embed: list[tuple[object, str]] = []  # (记忆对象/None, 待向量化文本)
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
                mem = Memory(user_id=user.id, character_id=character_id, kind=kind,
                             content=content, salience=salience, evidence=evidence)
                db.add(mem)
                pending_embed.append((mem, content))
                applied += 1
            elif op == "update":
                mem = by_id.get(str(item.get("id")))
                if mem:
                    new_content = str(item["content"]).strip()
                    if len(new_content) >= 4:
                        mem.content = new_content
                        pending_embed.append((mem, new_content))
                        applied += 1
            elif op == "delete":
                mem = by_id.get(str(item.get("id")))
                if mem:
                    await db.delete(mem)
                    applied += 1
        except Exception:
            continue
    # 存量回填：顺带把没有向量的记忆补上（每次最多 30 条，随聊天自然补齐）
    backfill = list((await db.execute(
        select(Memory).where(Memory.user_id == user.id, Memory.embedding == "")
        .order_by(desc(Memory.salience)).limit(30)
    )).scalars().all())
    for m in backfill:
        pending_embed.append((m, m.content))
    if pending_embed:
        try:
            vecs = await tokendance.embed([t[:500] for _, t in pending_embed], api_key=api_key)
            for (m, _), vec in zip(pending_embed, vecs, strict=False):
                m.embedding = json.dumps(vec)
            applied += 0  # 向量写入不改变 ops 计数
        except Exception:
            log.exception("记忆向量化失败（不影响记忆本身）")
    if applied or pending_embed:
        await db.commit()
        log.info("记忆维护完成 user=%s ops=%d embedded=%d", user.id, applied, len(pending_embed))


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
