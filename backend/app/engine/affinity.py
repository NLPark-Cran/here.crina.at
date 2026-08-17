"""熟悉度：互动累积，跨阈值自动升 relation_tier（只升不降；站主固定老友）"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import User

# 各互动一次累积的熟悉度
POINTS = {"chat": 2, "letter": 5, "post": 1}

# 升档阈值（affinity 累计值）
TIER_THRESHOLDS = [("熟人", 30), ("老友", 120)]

_TIER_ORDER = {"陌生": 0, "熟人": 1, "老友": 2}


async def bump_affinity(db: AsyncSession, user_id: uuid.UUID, kind: str) -> None:
    """互动后累积熟悉度；跨阈值自动升 relation_tier。调用方无需再 commit。"""
    user = await db.get(User, user_id)
    if not user or user.is_owner:
        return
    user.affinity = (user.affinity or 0) + POINTS.get(kind, 1)
    for tier, threshold in TIER_THRESHOLDS:
        if user.affinity >= threshold and _TIER_ORDER.get(user.relation_tier, 0) < _TIER_ORDER[tier]:
            user.relation_tier = tier
    await db.commit()
