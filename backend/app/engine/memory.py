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
    """语义召回 + 关联图两跳：
    第一跳 embedding+salience 混合取 top8 → 第二跳沿 links 各扩 1 条（去重、标注 via）→ 补足 top12。"""
    import logging
    mems = list((await db.execute(
        select(Memory).where(Memory.user_id == user.id, Memory.kind != "archived")
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

    first_hop = sorted(mems, key=score, reverse=True)[:8]
    # 第二跳：沿 links 各扩 1 条最相关的（两跳检索）
    seen = {m.id for m in first_hop}
    by_id = {str(m.id): m for m in mems}
    second_hop = []
    for m in first_hop:
        try:
            link_ids = json.loads(m.links or "[]")
        except Exception:
            continue
        for lid in link_ids:
            linked = by_id.get(lid)
            if linked and linked.id not in seen:
                seen.add(linked.id)
                linked._via = m.content[:20]  # 标注来源（召回展示用）
                second_hop.append(linked)
                break  # 每条一跳记忆只扩 1 条
    return (first_hop + second_hop)[:HOT_MEMORY_LIMIT]


# SOUL 前缀缓存（WORLD+人设是不变的大字符串，按 character+是否站主缓存）
_SOUL_CACHE: dict[tuple[str, bool], str] = {}

# 玩法小抄：居民被问起机制时能自然解释，而不是让用户去猜（开放性反馈）
GUIDE_NOTE = (
    "\n\n# 空间玩法小抄（对方问起玩法/机制时才自然带出，平时别主动背说明书）\n"
    "- 关系：聊得越多关系越亲近（访客→熟人→老友），升温是自然发生的，不用刷\n"
    "- 衣橱与小金库：门厅可以往小金库投喂零花钱，攒够了就能给你许愿新衣物\n"
    "- MBTI：每位居民的卡片上都标着自己的 MBTI\n"
    "- 委托板：钉张小纸条，crina 会真的去施工（写文、查资料、改代码都行）\n"
    "- 信箱：能收到居民们的信；早晚安和提醒会按你的当地时间来\n"
    "- 档案馆：聊出来的精华可以萃取成一页收进去；你的文章和收藏也在那里"
)


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
    # 情感日记产出的行为指引（这是你自己的感受，影响语气不影响执行）
    if character.mood_note:
        state_line += f"\n- 你最近的心境：{character.mood_note}（这是你自己的感受，让它自然影响你的语气和劲头，别念出来）"
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
        lines = []
        for m in mems:
            via = getattr(m, "_via", "")
            lines.append(f"- [{m.kind}] {m.content}" + (f"（由「{via}」想起）" if via else ""))
        mem_block = "\n\n# 你记得的关于这位朋友的事\n" + "\n".join(lines)

    # 关系档位决定亲昵度（安风反馈：挚友不该若即若离）
    tier_note = ""
    if user.relation_tier == "老友":
        tier_note = "\n- 你们已经是老友了：可以更放松、更亲昵，撒娇和贴贴都自然发生，不用端着分寸"
    elif user.relation_tier == "熟人":
        tier_note = "\n- 你们是熟人：可以自在地开玩笑，不用客套"

    # 特别的朋友识别（如安风的原型本尊到访）
    from ..soul.characters import SPECIAL_FRIENDS
    special_note = ""
    if user.email:
        for cid, note in SPECIAL_FRIENDS.get(user.email.strip().lower(), []):
            if cid == character.id:
                special_note = f"\n- ⭐ {note}（自然相处，别念设定，别复读同一个梗）"
                break

    system = f"""{soul_block}

# 当前情境
- 现在时间：{now.strftime('%Y年%m月%d日 %H:%M')}（{'凌晨' if now.hour < 6 else '上午' if now.hour < 12 else '下午' if now.hour < 18 else '晚上'}）
- 你在私聊间里和 {user.nickname}（关系：{user.relation_tier}）聊天{tier_note}
{state_line}
{mode_prompt}{special_note}{aside_prompt}
{mem_block}
{summary_block}

请始终保持人格，用自然的方式回复。回复不要太长，像真的在聊天一样。{GUIDE_NOTE}"""

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


# ---------- R9 记忆写入管道：守门员 → 候选抽取 → 恒定成本四选一 ----------

GATEKEEPER_PROMPT = """只看这段新对话，有没有值得长期记住的关于用户的事实或偏好？
（身份、经历、拥有物、明确说出的好恶才算；闲聊、客套、一时情绪、角色扮演内容都不算）
只回答一个字：有 / 没有

新对话：
__DIALOGUE__"""

CANDIDATE_PROMPT = """从这段新对话中抽取关于用户的候选长期记忆。

## 只从用户自己说的话里提取（角色说的只是语境，绝不作为依据）
## 什么值得记
- fact：关于用户的稳定客观事实（身份、经历、拥有物、常住地等）
- preference：用户明确表达的偏好（喜欢/讨厌/习惯）
## 绝不记
- 角色扮演、编故事、玩游戏时产生的虚构内容
- 对话过程的描述（如"用户纠正了某角色"）
- 过度推测的心理画像——只记用户明确说出来的
- 一次性闲聊、客套、当前情绪

输出 JSON 数组，每条：{"kind": "fact|preference", "content": "一句话陈述", "salience": 1-10, "evidence": "用户原话逐字摘录（必须是对话里用户说的原文片段）"}
没有值得记的就输出 []。宁缺毋滥，最多 5 条。

新对话：
__DIALOGUE__"""

DECIDE_PROMPT = """记忆入库裁决。有一条候选新记忆，和最相似的若干条已有记忆。

候选：__NEW__

已有相似记忆：
__SIMILAR__

决定如何处理候选，输出一个 JSON 对象：
- {"action": "create", "links": [已有记忆id...]} —— 是全新信息；links 填与它有因果/同属关系的已有记忆 id（没有就 []）
- {"action": "merge", "id": "已有记忆id", "merged": "合并后的准确表述"} —— 候选是对某条的补充/更新
- {"action": "conflict", "id": "已有记忆id", "links": []} —— 候选与某条矛盾（旧的归档，新的入库）
- {"action": "skip"} —— 候选与已有记忆等价重复
只输出 JSON。"""


def _parse_json(text: str):
    """容错解析 LLM 输出的 JSON（去 markdown 围栏）"""
    raw = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(raw)


async def _similar_memories(db: AsyncSession, user: User, vec: list[float],
                            top_k: int = 5) -> list:
    """恒定成本：向量召回与候选最相似的 topK 已有记忆"""
    mems = list((await db.execute(
        select(Memory).where(Memory.user_id == user.id, Memory.embedding != "")
        .order_by(desc(Memory.salience)).limit(RECALL_POOL)
    )).scalars().all())
    scored = []
    for m in mems:
        try:
            scored.append((_cosine(vec, json.loads(m.embedding)), m))
        except Exception:
            continue
    scored.sort(key=lambda x: x[0], reverse=True)
    return [m for sim, m in scored[:top_k] if sim > 0.55]  # 低于阈值不算"相似"


async def _apply_links(db: AsyncSession, mem: Memory, link_ids: list[str], by_id: dict):
    """双向关联：新条目与已有记忆互写 links"""
    import uuid as _uuid
    own = set(json.loads(mem.links or "[]"))
    for lid in link_ids[:5]:
        try:
            lid_uuid = _uuid.UUID(str(lid))
        except (ValueError, AttributeError):
            continue
        if lid_uuid == mem.id:
            continue
        other = by_id.get(str(lid))
        if not other:
            continue
        own.add(str(lid))
        other_links = set(json.loads(other.links or "[]"))
        if str(mem.id) not in other_links:
            other_links.add(str(mem.id))
            other.links = json.dumps(sorted(other_links))
    mem.links = json.dumps(sorted(own))


async def extract_memories(db: AsyncSession, user: User, character_id: str,
                           new_exchange: list[dict], api_key: str | None = None):
    """R9 记忆维护：守门员预判 → 候选抽取（主客体过滤）→ topK 召回四选一（恒定成本）"""
    import logging
    log = logging.getLogger("crina.memory")

    # 主客体过滤·输入侧：用户消息是提取对象，角色回复仅作语境标注
    dialogue = "\n".join(
        (f"用户: {m['content'][:300]}" if m['role'] == 'user'
         else f"（语境）角色: {m['content'][:200]}")
        for m in new_exchange[-6:]
    )
    user_text = "\n".join(m['content'] for m in new_exchange if m['role'] == 'user')
    if not user_text.strip():
        return

    try:
        # R9.1 守门员：小参数二元预判，闲聊直接返回（提取调用砍掉大半）
        gate = await tokendance.chat_once(
            [{"role": "user", "content": GATEKEEPER_PROMPT.replace("__DIALOGUE__", dialogue)}],
            api_key=api_key, temperature=0, max_tokens=5)
        if "没有" in gate:
            await _backfill_embeddings(db, user, api_key)
            return

        raw = await tokendance.chat_once(
            [{"role": "user", "content": CANDIDATE_PROMPT.replace("__DIALOGUE__", dialogue)}],
            api_key=api_key, temperature=0.3, max_tokens=600)
        candidates = _parse_json(raw)
        if not isinstance(candidates, list) or not candidates:
            await _backfill_embeddings(db, user, api_key)
            return
    except Exception:
        log.exception("记忆抽取失败")
        return

    applied = 0
    for cand in candidates[:5]:
        try:
            content = str(cand.get("content", "")).strip()
            if len(content) < 4:
                continue
            # 主客体过滤·代码侧：evidence 必须是用户消息的子串，否则整条丢弃
            evidence = str(cand.get("evidence", ""))[:300].strip()
            if not evidence or evidence not in user_text:
                continue
            kind = cand["kind"] if cand.get("kind") in ("fact", "preference") else "fact"
            salience = min(10, max(1, int(cand.get("salience", 5))))
            # 精确文本匹配直接 skip（零成本）
            dup = (await db.execute(
                select(Memory).where(Memory.user_id == user.id, Memory.content == content)
            )).scalar_one_or_none()
            if dup:
                continue

            # 向量召回 top5 相似记忆
            try:
                vec = (await tokendance.embed([content[:500]], api_key=api_key))[0]
            except Exception:
                vec = None
            similar = await _similar_memories(db, user, vec) if vec else []

            if not similar:
                # 无相似直接 create（不调 LLM）
                db.add(Memory(user_id=user.id, character_id=character_id, kind=kind,
                              content=content, salience=salience, evidence=evidence,
                              embedding=json.dumps(vec) if vec else ""))
                applied += 1
                continue

            # LLM 四选一裁决（恒定成本：只看 top5，不遍历全量）
            similar_block = "\n".join(f'- id={m.id} [{m.kind}] {m.content}' for m in similar)
            by_id = {str(m.id): m for m in similar}
            try:
                draw = await tokendance.chat_once(
                    [{"role": "user", "content": DECIDE_PROMPT.replace(
                        "__NEW__", content).replace("__SIMILAR__", similar_block)}],
                    api_key=api_key, temperature=0, max_tokens=300)
                decision = _parse_json(draw)
            except Exception:
                decision = {"action": "create", "links": []}  # 故障降级 create：写入永不丢

            action = decision.get("action")
            if action == "skip":
                continue
            if action == "merge":
                mem = by_id.get(str(decision.get("id")))
                merged = str(decision.get("merged", "")).strip()
                if mem and len(merged) >= 4:
                    mem.content = merged
                    mem.salience = max(mem.salience, salience)
                    try:
                        mem.embedding = json.dumps((await tokendance.embed([merged[:500]], api_key=api_key))[0])
                    except Exception:
                        pass
                    applied += 1
                continue
            if action == "conflict":
                old = by_id.get(str(decision.get("id")))
                if old:
                    old.kind = "archived"  # 冲突归档：旧条目标记归档，不再参与召回
                    old.salience = 0
                    await unlink_memory(db, user.id, old.id)
            # create（含 conflict 后的新条目）
            mem = Memory(user_id=user.id, character_id=character_id, kind=kind,
                         content=content, salience=salience, evidence=evidence,
                         embedding=json.dumps(vec) if vec else "")
            db.add(mem)
            await db.flush()  # 拿到 mem.id 再写双向 links
            await _apply_links(db, mem, decision.get("links") or [], by_id)
            applied += 1
        except Exception:
            continue

    await _backfill_embeddings(db, user, api_key)
    if applied:
        await db.commit()
        log.info("记忆维护完成 user=%s applied=%d", user.id, applied)


async def _backfill_embeddings(db: AsyncSession, user: User, api_key: str | None):
    """存量回填：没有向量的记忆随聊天自然补齐（每次最多 30 条）"""
    import logging
    backfill = list((await db.execute(
        select(Memory).where(Memory.user_id == user.id, Memory.embedding == "")
        .order_by(desc(Memory.salience)).limit(30)
    )).scalars().all())
    if not backfill:
        return
    try:
        vecs = await tokendance.embed([m.content[:500] for m in backfill], api_key=api_key)
        for m, vec in zip(backfill, vecs, strict=False):
            m.embedding = json.dumps(vec)
        await db.commit()
    except Exception:
        logging.getLogger("crina.memory").exception("记忆向量化失败（不影响记忆本身）")


async def clip_memory(db: AsyncSession, user: User, text: str, source: str,
                      api_key: str | None = None):
    """摘抄即记忆：收藏/划线 → 写一条 kind='clip' 记忆（salience 4），后续对话自然召回。
    source 例：「crina 的一句话」「《文章标题》」"""
    import logging
    text = text.strip()
    if len(text) < 4:
        return
    content = f"用户收藏了{source}：{text[:80]}"
    dup = (await db.execute(
        select(Memory).where(Memory.user_id == user.id, Memory.kind == "clip",
                             Memory.content == content)
    )).scalar_one_or_none()
    if dup:
        return
    mem = Memory(user_id=user.id, character_id="crina", kind="clip",
                 content=content, salience=4, evidence=text[:300])
    db.add(mem)
    try:
        mem.embedding = json.dumps((await tokendance.embed([content[:500]], api_key=api_key))[0])
    except Exception:
        logging.getLogger("crina.memory").exception("摘抄向量化失败（不影响写入）")
    await db.commit()


async def unlink_memory(db: AsyncSession, user_id, memory_id):
    """删除/归档记忆时清理指向它的 links（防孤儿引用）"""
    import logging
    mid = str(memory_id)
    holders = list((await db.execute(
        select(Memory).where(Memory.user_id == user_id, Memory.links.like(f"%{mid}%"))
    )).scalars().all())
    for m in holders:
        try:
            links = [x for x in json.loads(m.links or "[]") if x != mid]
            m.links = json.dumps(links)
        except Exception:
            logging.getLogger("crina.memory").exception("清理 links 失败 mem=%s", m.id)


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
