"""emind.tt2.li 数据导入：把旧家的对话与记忆搬进新家

验证方式：观猹账号绑定的邮箱必须和 emind 账号邮箱一致。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from ..config import get_settings
from ..db import get_db
from ..models import Conversation, Memory, Message, User
from ..security import get_current_user

router = APIRouter(prefix="/import", tags=["import"])
settings = get_settings()
log = logging.getLogger("crina.import")

EMIND_URL = settings.database_url.rsplit("/", 1)[0] + "/eastmind"


@router.get("/emind/status")
async def emind_status(user: User = Depends(get_current_user)):
    """检查当前用户的邮箱在 emind 里有多少可导入的数据"""
    if not user.email:
        return {"available": False, "reason": "你的观猹账号还没绑定邮箱，无法和 emind 账号对上"}
    engine = create_async_engine(EMIND_URL, pool_size=2)
    try:
        async with engine.connect() as conn:
            u = (await conn.execute(text("SELECT id, name FROM users WHERE email = :e"),
                                    {"e": user.email})).first()
            if not u:
                return {"available": False, "reason": "emind 上没找到这个邮箱的账号"}
            convs = (await conn.execute(text("SELECT count(*) FROM conversations WHERE user_id = :u"),
                                        {"u": u.id})).scalar()
            msgs = (await conn.execute(text(
                "SELECT count(*) FROM messages m JOIN conversations c ON m.conversation_id = c.id "
                "WHERE c.user_id = :u AND m.hidden = false"), {"u": u.id})).scalar()
            mems = (await conn.execute(text("SELECT count(*) FROM memories WHERE user_id = :u"),
                                       {"u": u.id})).scalar()
            return {"available": True, "emind_name": u.name,
                    "conversations": convs, "messages": msgs, "memories": mems}
    except Exception:
        log.exception("emind 状态检查失败")
        return {"available": False, "reason": "连不上旧家，稍后再试试"}
    finally:
        await engine.dispose()


KIND_MAP = {"fact": "fact", "preference": "preference", "summary": "summary"}


@router.post("/emind")
async def emind_import(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not user.email:
        raise HTTPException(400, "你的观猹账号还没绑定邮箱，无法和 emind 账号对上")
    # 幂等 + 冷却：30 分钟内只能搬一次
    from ..cache import get_redis
    r = get_redis()
    if await r.get(f"import:emind:{user.id}"):
        raise HTTPException(429, "刚搬完一波，歇 30 分钟再搬（重复对话不会重复入库，放心）")
    await r.setex(f"import:emind:{user.id}", 1800, "1")
    engine = create_async_engine(EMIND_URL, pool_size=2)
    imported = {"conversations": 0, "messages": 0, "memories": 0}
    try:
        async with engine.connect() as conn:
            u = (await conn.execute(text("SELECT id FROM users WHERE email = :e"),
                                    {"e": user.email})).first()
            if not u:
                raise HTTPException(404, "emind 上没找到这个邮箱的账号")

            # 记忆
            mems = (await conn.execute(text(
                "SELECT memory_type, key, value, summary FROM memories WHERE user_id = :u"),
                {"u": u.id})).all()
            for m in mems:
                kind = KIND_MAP.get(m.memory_type, "fact")
                content = f"{m.key}：{m.value}" if m.key else (m.summary or m.value)
                dup = (await db.execute(
                    text("SELECT 1 FROM memories WHERE user_id = :u AND content = :c"),
                    {"u": user.id, "c": content})).first()
                if not dup:
                    db.add(Memory(user_id=user.id, character_id="crina", kind=kind, content=content,
                                  salience=6))
                    imported["memories"] += 1

            # 对话（含消息）
            convs = (await conn.execute(text(
                "SELECT id, title, created_at FROM conversations WHERE user_id = :u ORDER BY created_at"),
                {"u": u.id})).all()
            for c in convs:
                title = f"[emind] {c.title or '未命名对话'}"[:128]
                # 幂等：同名导入会话已存在则跳过
                dup = (await db.execute(
                    text("SELECT 1 FROM conversations WHERE user_id = :u AND title = :t"),
                    {"u": user.id, "t": title})).first()
                if dup:
                    continue
                new_conv = Conversation(user_id=user.id, character_id="crina", mode="auto",
                                        folder="emind", title=title)
                db.add(new_conv)
                await db.flush()
                msgs = (await conn.execute(text(
                    "SELECT role, content, created_at FROM messages "
                    "WHERE conversation_id = :c AND hidden = false ORDER BY created_at"),
                    {"c": c.id})).all()
                for msg in msgs:
                    if msg.role == "user":
                        role, char_id = "user", None
                    elif msg.role == "assistant":
                        role, char_id = "character", "crina"
                    else:
                        continue
                    db.add(Message(conversation_id=new_conv.id, role=role,
                                   character_id=char_id, content=msg.content))
                    imported["messages"] += 1
                imported["conversations"] += 1
        await db.commit()
    except HTTPException:
        raise
    except Exception:
        await db.rollback()
        log.exception("emind 导入失败")
        raise HTTPException(500, "搬家车半路熄火了，稍后再试一次吧")
    finally:
        await engine.dispose()
    return {"ok": True, "imported": imported,
            "message": f"搬好啦：{imported['conversations']} 段对话、{imported['memories']} 条记忆。crina 会替旧家继续记得你。"}
