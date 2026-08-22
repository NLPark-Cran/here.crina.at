"""聊天编排器：单聊流式 + 脑暴圆桌 + 配额/BYOK"""
from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..bg import fire_and_forget
from ..config import get_settings
from ..db import SessionLocal
from ..models import Character, Conversation, Message, OAuthAccount, UsageCounter, User
from ..security import decrypt_payload
from . import memory, tokendance
from .affinity import bump_affinity

settings = get_settings()

BRAINSTORM_CANDIDATES = ["anfeng", "xianmoying", "baixu", "tuanxiaoman", "qiulening", "jingxin"]


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
    """站点额度用户计配额（原子自增防并发绕过）；BYOK 与站主不限"""
    if is_byok or user.is_owner:
        return
    limits = {"chat": settings.quota_chat_per_day, "agent": settings.quota_agent_per_day,
              "tts": settings.quota_tts_per_day}
    # 配额日界按用户时区（海外用户不会在奇怪的时间被重置）
    from zoneinfo import ZoneInfo
    try:
        today = datetime.now(ZoneInfo(user.timezone or "Asia/Shanghai")).date()
    except Exception:
        today = date.today()
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    stmt = pg_insert(UsageCounter).values(user_id=user.id, day=today, kind=kind, count=1)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_usage",
        set_={"count": UsageCounter.count + 1},
    ).returning(UsageCounter.count)
    count = (await db.execute(stmt)).scalar_one()
    await db.commit()
    if count > limits.get(kind, 50):
        raise QuotaExceeded(kind)


class QuotaExceeded(Exception):
    def __init__(self, kind: str):
        self.kind = kind


def sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


async def _stream_character(db: AsyncSession, user: User, character: Character,
                            conversation: Conversation, mode: str, api_key: str | None,
                            round_note: str = "", aside: bool = True) -> AsyncGenerator[tuple[str, str], None]:
    """流式生成一位居民的回复，产出 (event_type, text)；完整文本最后入库"""
    ctx = await memory.build_context(db, user, character, conversation, mode, aside=aside)
    if round_note:
        ctx.append({"role": "user", "content": round_note})
    # 探讨模式开思考（回答更扎实）；闲聊保持秒回的活人感
    effort = settings.chat_reasoning_effort if mode in ("brainstorm", "guide", "probe", "extract") else ""
    full = ""
    async for delta in tokendance.chat_stream(ctx, api_key=api_key, reasoning_effort=effort):
        full += delta
        yield "delta", delta
    msg = Message(conversation_id=conversation.id, role="character",
                  character_id=character.id, content=full)
    db.add(msg)
    await db.commit()
    yield "saved", full


async def stream_reply(conversation_id: str, user: User, content: str,
                       db: AsyncSession, doc_context: str = "", aside: bool = True) -> AsyncGenerator[str, None]:
    """主入口：SSE 事件流"""
    import uuid as _uuid
    try:
        conv_id = _uuid.UUID(conversation_id)
    except ValueError:
        yield sse({"type": "error", "message": "对话不存在"})
        return
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

    # 存入用户消息（同时触碰会话 updated_at，侧边栏按最近排序）
    db.add(Message(conversation_id=conversation.id, role="user", content=content))
    conversation.updated_at = datetime.now(UTC)
    await db.commit()
    await bump_affinity(db, user.id, "chat")

    main_char = (await db.execute(select(Character).where(Character.id == conversation.character_id))).scalar_one()
    mode = conversation.mode
    exchange: list[dict] = [{"role": "user", "content": content + doc_context}]

    try:
        if mode == "brainstorm":
            async for ev in _brainstorm(db, user, conversation, main_char, api_key, exchange, aside):
                yield ev
        else:
            yield sse({"type": "speaker", "character": main_char.id, "name": main_char.name,
                       "color": main_char.color, "avatar_url": main_char.avatar_url})
            full = ""
            async for etype, text in _stream_character(db, user, main_char, conversation, mode, api_key, aside=aside):
                if etype == "delta":
                    yield sse({"type": "delta", "character": main_char.id, "text": text})
                elif etype == "saved":
                    full = text
            exchange.append({"role": "assistant", "content": full})
    except Exception:
        import logging
        logging.getLogger("crina.chat").exception("生成失败 conv=%s", conversation.id)
        yield sse({"type": "error", "message": "刚才脑子打了个结，再说一次试试？"})
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
                    # 情感日记守门员：这轮对话在居民心里留下痕迹了吗（大多数轮次跳过）
                    from . import diary
                    await diary.maybe_record_after_chat(s, main_char, exchange, api_key)
                    log.info("后台记忆/摘要完成 conv=%s", conversation.id)
        except Exception:
            log.exception("后台记忆任务失败")
    fire_and_forget(_bg())

    # 自动起标题
    if not conversation.title:
        conversation.title = content[:20]
        await db.commit()

    yield sse({"type": "done"})


FRAMEWORKS = "SWOT分析 / 六顶帽 / 第一性原理 / 辩论赛"

FRAME_PROMPT = """你是圆桌脑暴的主持人。按话题性质选一个讨论框架，并指定 2-3 位居民各自的分工视角。
可选框架：__FRAMEWORKS__
（价值观/伦理类 → 辩论赛或六顶帽；决策/选择类 → SWOT；本质追问类 → 第一性原理）
可选居民：__CHARS__
只输出 JSON：{"framework": "框架名", "note": "一句话开场白（15字内，主持人语气）", "roles": [{"id": "居民id", "angle": "ta负责的角度（15字内）"}]}

话题：__TOPIC__"""

CONCLUDE_PROMPT = """圆桌脑暴收束。居民们刚围绕话题独立发表了看法（互相没看过对方的答案）。
你作为主持人给出四段式报告，每段一两句话：
## 共识
## 分歧
## 盲点
## 建议
保持你自己的人格语气，别写成公文。

话题：__TOPIC__
各位的发言：
__ANSWERS__"""


async def _brainstorm(db: AsyncSession, user: User, conversation: Conversation,
                      main_char: Character, api_key: str | None,
                      exchange: list[dict], aside: bool = True) -> AsyncGenerator[str, None]:
    """三幕圆桌：主持人定框架 → 2-3 位居民并行独立作答 → 主持人四段收束（R10.3）"""
    import asyncio

    chars = (await db.execute(select(Character).where(
        Character.id.in_(BRAINSTORM_CANDIDATES), Character.active == True))).scalars().all()  # noqa: E712
    char_map = {c.id: c for c in chars}
    topic = exchange[0]['content'][:200]

    # 第一幕：定框架 + 分工
    framework, note, roles = "自由讨论", "大家随便聊聊", []
    try:
        raw = await tokendance.chat_once(
            [{"role": "user", "content": FRAME_PROMPT
                .replace("__FRAMEWORKS__", FRAMEWORKS)
                .replace("__CHARS__", ', '.join(f'{c.id}({c.tagline})' for c in chars))
                .replace("__TOPIC__", topic)}],
            api_key=api_key, temperature=0.4, max_tokens=300)
        plan = json.loads(raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip())
        framework = str(plan.get("framework", framework))[:20]
        note = str(plan.get("note", note))[:50]
        roles = [r for r in plan.get("roles", []) if r.get("id") in char_map][:3]
    except Exception:
        pass
    if not roles:  # 兜底
        roles = [{"id": cid, "angle": "自由发挥"}
                 for cid in ("anfeng", "baixu") if cid in char_map][:2]
    yield sse({"type": "frame", "framework": framework, "note": note})

    # 第二幕：并行独立作答（互不看到对方答案），事件经队列汇合后按到达顺序推流
    queue: asyncio.Queue = asyncio.Queue()
    answers: list[tuple[str, str]] = []  # (name, full)

    async def run_one(char_id: str, angle: str):
        # 并行任务必须用各自独立的 session（AsyncSession 不可并发共享，禁跨 session 用 ORM 对象）
        from ..db import SessionLocal
        full = ""
        try:
            async with SessionLocal() as s:
                fresh_user = await s.get(User, user.id)
                char = await s.get(Character, char_id)
                conv = await s.get(Conversation, conversation.id)
                note_ = f"（圆桌脑暴·{framework}：你负责「{angle}」视角，简洁发言 100 字左右，独立作答不要引用别人）"
                async for etype, text in _stream_character(s, fresh_user, char, conv, "brainstorm",
                                                           api_key, note_, aside=aside):
                    if etype == "delta":
                        await queue.put(("delta", char_id, text))
                    elif etype == "saved":
                        full = text
        except Exception:
            await queue.put(("delta", char_id, "（走麦城了，跳过我吧）"))
        await queue.put(("char_done", char_map[char_id], full))

    # 先发各 speaker 事件（前端建好气泡），再汇流
    picked_chars = [char_map[r["id"]] for r in roles]
    for c in picked_chars:
        yield sse({"type": "speaker", "character": c.id, "name": c.name,
                   "color": c.color, "avatar_url": c.avatar_url})
    tasks = [asyncio.create_task(run_one(r["id"], r.get("angle", "自由发挥")))
             for r in roles]
    done_count = 0
    while done_count < len(tasks):
        ev = await queue.get()
        if ev[0] == "delta":
            yield sse({"type": "delta", "character": ev[1], "text": ev[2]})
        else:
            _, c, full = ev
            answers.append((c.name, full))
            exchange.append({"role": "assistant", "content": f"【{c.name}】{full}"})
            done_count += 1
    await asyncio.gather(*tasks, return_exceptions=True)

    # 第三幕：主持人四段收束
    yield sse({"type": "speaker", "character": main_char.id, "name": main_char.name,
               "color": main_char.color, "avatar_url": main_char.avatar_url})
    answers_block = "\n".join(f"{name}：{text[:300]}" for name, text in answers)
    note_ = CONCLUDE_PROMPT.replace("__TOPIC__", topic).replace("__ANSWERS__", answers_block)
    full = ""
    async for etype, text in _stream_character(db, user, main_char, conversation, "brainstorm",
                                               api_key, note_, aside=aside):
        if etype == "delta":
            yield sse({"type": "delta", "character": main_char.id, "text": text})
        elif etype == "saved":
            full = text
    exchange.append({"role": "assistant", "content": full})
