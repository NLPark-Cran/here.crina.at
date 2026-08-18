"""空间 API：居民名录 + 在场状态"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..cache import get_redis
from ..db import get_db
from ..models import Character

router = APIRouter(prefix="/space", tags=["space"])
CST = timezone(timedelta(hours=8))

# 默认在场状态（主动性引擎会写入 Redis 覆盖）
DEFAULT_STATUS = {
    "crina": ["在房间打盹", "在煮桂花茶", "在写今天的手账", "在窗边观鸟", "在整理委托板"],
    "anfeng": ["在翻文献", "在垃圾堆里翻找什么", "在阳台上认鸟", "在调试骰子"],
    "qiulening": ["在写信", "在晒桂花", "在读一本旧书"],
    "xianmoying": ["在睡觉（夜行者）", "在调音", "不在，凌晨才回来"],
    "tuanxiaoman": ["在厨房偷吃", "在策划下一场活动", "在试新菜谱"],
    "baixu": ["在档案馆整理卷宗", "在给日历盖章", "在修补一封信"],
    "guagua": ["*抱瓜路过*", "在墙角睡觉", "在吃瓜"],
}


@router.get("/characters")
async def list_characters(db: AsyncSession = Depends(get_db)):
    chars = (await db.execute(select(Character).where(Character.active == True))).scalars().all()  # noqa: E712
    return {"characters": [
        {"id": c.id, "name": c.name, "tagline": c.tagline, "mbti": c.mbti,
         "color": c.color, "avatar_url": c.avatar_url, "is_agent": c.is_agent,
         "status_text": c.status_text}
        for c in chars
    ]}


@router.post("/garbage")
async def garbage():
    """翻翻安风的垃圾堆（彩蛋，免登录）"""
    from ..soul.garbage import dig
    return dig()


@router.get("/presence")
async def presence(db: AsyncSession = Depends(get_db)):
    r = get_redis()
    chars = (await db.execute(select(Character).where(Character.active == True))).scalars().all()  # noqa: E712
    hour = datetime.now(CST).hour
    keys = [f"presence:{c.id}" for c in chars]
    values = await r.mget(keys) if keys else []
    out = {}
    for c, status in zip(chars, values, strict=False):
        if not status:
            options = DEFAULT_STATUS.get(c.id, ["在空间里待着"])
            # 夜行者白天睡觉
            if c.id == "xianmoying" and 7 <= hour < 23:
                status = "在睡觉（夜行者，凌晨才醒）"
            else:
                status = options[(hour + len(c.id)) % len(options)]
        out[c.id] = status
    return {"presence": out}
