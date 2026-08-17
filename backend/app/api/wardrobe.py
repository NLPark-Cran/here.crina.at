"""衣橱 API：小金库余额 / 购置 / 拨款"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..bg import fire_and_forget
from ..db import SessionLocal, get_db
from ..engine import wardrobe
from ..models import PurseLedger, User, WardrobeItem
from ..security import get_current_user

router = APIRouter(prefix="/space/wardrobe", tags=["wardrobe"])


@router.get("")
async def show(db: AsyncSession = Depends(get_db)):
    items = (await db.execute(
        select(WardrobeItem).order_by(desc(WardrobeItem.created_at)).limit(30)
    )).scalars().all()
    ledger = (await db.execute(
        select(PurseLedger).order_by(desc(PurseLedger.created_at)).limit(10)
    )).scalars().all()
    return {
        "balance": await wardrobe.get_balance(db),
        "items": [{"id": str(i.id), "kind": i.kind, "title": i.title, "image_url": i.image_url,
                   "cost": i.cost, "note": i.note, "wearing": i.wearing,
                   "created_at": i.created_at.isoformat()} for i in items],
        "ledger": [{"delta": entry.delta, "reason": entry.reason, "created_at": entry.created_at.isoformat()} for entry in ledger],
    }


class Fund(BaseModel):
    amount: int = Field(ge=1, le=200)


@router.post("/fund")
async def give_fund(body: Fund, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """给 crina 塞零花钱"""
    balance = await wardrobe.fund(db, body.amount, f"{user.nickname} 塞的零花钱")
    return {"ok": True, "balance": balance, "message": f"塞给 crina {body.amount} 镜币，她眼睛都亮了"}


class Wish(BaseModel):
    kind: str = "outfit"  # outfit / decor
    hint: str = Field(default="", max_length=200)


async def _buy_bg(kind: str, hint: str, nickname: str):
    async with SessionLocal() as db:
        await wardrobe.buy(db, kind, hint, nickname)


@router.post("/wish")
async def wish(body: Wish, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """主人可以提议购置（异步生图，稍后出现在衣橱和客厅）"""
    if not user.is_owner:
        raise HTTPException(403, "购置大权目前在小屋主人手里哦，你可以先塞零花钱")
    if body.kind not in ("outfit", "decor"):
        raise HTTPException(400, "kind 只能是 outfit 或 decor")
    balance = await wardrobe.get_balance(db)
    cost = wardrobe.OUTFIT_COST if body.kind == "outfit" else wardrobe.DECOR_COST
    if balance < cost:
        raise HTTPException(400, f"小金库不够啦（需要 {cost} 镜币，现在只有 {balance}）")
    fire_and_forget(_buy_bg(body.kind, body.hint, user.nickname))
    return {"ok": True, "message": "crina 拿着经费出门逛街啦，回来会去客厅炫耀的"}
