"""小金库与衣橱：crina 会拿经费给自己购置装扮和摆件"""
from __future__ import annotations

import asyncio
import base64
import logging
import uuid
from pathlib import Path

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..models import Post, PurseLedger, WardrobeItem

log = logging.getLogger("crina.wardrobe")
settings = get_settings()

ASSETS = Path(__file__).resolve().parent.parent.parent.parent / "assets" / "generated"
OUTFIT_COST = 88
DECOR_COST = 45

# 经费面额限制
MAX_FUND = 200


async def get_balance(db: AsyncSession) -> int:
    total = (await db.execute(select(func.coalesce(func.sum(PurseLedger.delta), 0)))).scalar()
    return int(total or 0)


async def fund(db: AsyncSession, amount: int, reason: str) -> int:
    amount = max(1, min(MAX_FUND, int(amount)))
    db.add(PurseLedger(delta=amount, reason=reason))
    await db.commit()
    return await get_balance(db)


def _read_ref(ref_path: Path) -> str | None:
    if not ref_path.exists():
        return None
    b64 = base64.b64encode(ref_path.read_bytes()).decode()
    suffix = "jpeg" if ref_path.suffix.lower() in (".jpg", ".jpeg") else "png"
    return f"data:image/{suffix};base64,{b64}"


async def _gen_image(prompt: str, ref_path: Path | None = None) -> bytes | None:
    body = {
        "model": settings.image_model,
        "prompt": prompt,
        "size": "2K",
        "output_format": "png",
        "response_format": "b64_json",
        "watermark": False,
    }
    if ref_path:
        ref_data = await asyncio.to_thread(_read_ref, ref_path)
        if ref_data:
            body["image"] = ref_data
    async with httpx.AsyncClient(timeout=240) as client:
        resp = await client.post(
            "https://tokendance.space/gateway/ark/v3/images/generations",
            headers={"Authorization": f"Bearer {settings.tokendance_api_key}",
                     "Content-Type": "application/json"},
            json=body,
        )
        if resp.status_code != 200:
            log.error("衣橱生图失败: %s", resp.text[:200])
            return None
        data = resp.json()["data"][0]
        if data.get("b64_json"):
            return base64.b64decode(data["b64_json"])
        if data.get("url"):
            async with httpx.AsyncClient(timeout=120) as c2:
                return (await c2.get(data["url"])).content
    return None


# 购置串行化：小金库余额是流水汇总，并发扣款会双花 → 用 PG 事务级咨询锁串行
PURSE_LOCK_KEY = 917231


async def buy(db: AsyncSession, kind: str, hint: str, by_nickname: str) -> WardrobeItem | None:
    """购置一件装扮/摆件：先扣款（防双花） → 构思 → 生图 → 入库 → 客厅炫耀；任何异常都退款"""
    from sqlalchemy import text

    from . import tokendance
    cost = OUTFIT_COST if kind == "outfit" else DECOR_COST
    # 咨询锁：并发 buy 串行，第二个能看到第一个已提交的扣款
    await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": PURSE_LOCK_KEY})
    # 先插负流水并校验余额，不够则回滚
    prepaid = PurseLedger(delta=-cost, reason="（预付购置款）")
    db.add(prepaid)
    await db.flush()
    if await get_balance(db) < 0:
        await db.rollback()
        return None

    async def _refund(reason: str) -> None:
        """退款：与扣款同事务上下文，直接转正备注+补回正流水"""
        db.add(PurseLedger(delta=cost, reason=reason))
        await db.commit()

    # 让 crina 自己构思要买什么
    plan_prompt = (
        "你是 crina（蓝紫发异色瞳少女，温柔带狡黠），要"
        + (f"根据朋友「{by_nickname}」的提议「{hint}」" if hint else "自己逛街时心血来潮，")
        + ("给自己搭配一身新装扮。" if kind == "outfit" else "给空间添置一个小摆件。")
        + "输出 JSON：{\"title\": \"名字（8字内）\", \"reason\": \"为什么想要它（一句话，你的口吻）\", "
          "\"prompt\": \"给画师的详细画面描述（中文，30字以上）\"}"
    )
    try:
        raw = await tokendance.chat_once([{"role": "user", "content": plan_prompt}], temperature=0.9, max_tokens=300)
        raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        import json
        plan = json.loads(raw)
    except Exception:
        plan = {"title": "新装扮" if kind == "outfit" else "小摆件",
                "reason": "看着喜欢就拿下啦", "prompt": hint or ("秋日针织连衣裙" if kind == "outfit" else "一盏暖光小台灯")}

    ref = None
    if kind == "outfit":
        prompt = ("以参考图中的动漫少女为主体（蓝紫色长发、异色瞳左绿右琥珀、小发卡），"
                  f"给她换上这身新衣服：{plan['prompt']}。日系柔和插画风，全身立绘，干净浅色背景。")
        ref = ASSETS.parent / "src_materials" / "avatar.jpg"
    else:
        prompt = f"一个温馨的小物件静物插画：{plan['prompt']}。柔和暖色，吉卜力式治愈风，干净背景。"

    try:
        image = await _gen_image(prompt, ref)
    except Exception:
        log.exception("生图请求异常")
        await _refund("（购置失败退回）")
        return None
    if not image:
        await _refund("（购置失败退回）")
        return None

    item_id = uuid.uuid4()
    fname = f"wardrobe_{item_id.hex[:12]}.webp"
    try:
        import io

        from PIL import Image
        img = Image.open(io.BytesIO(image)).convert("RGB")
        img.thumbnail((900, 1200), Image.LANCZOS)
        img.save(ASSETS / fname, "WEBP", quality=82)
    except Exception:
        fname = f"wardrobe_{item_id.hex[:12]}.png"
        (ASSETS / fname).write_bytes(image)

    # 装扮自动穿上（换装）
    if kind == "outfit":
        for old in (await db.execute(select(WardrobeItem).where(WardrobeItem.wearing == True))).scalars().all():  # noqa: E712
            old.wearing = False

    item = WardrobeItem(id=item_id, kind=kind, title=plan["title"][:60],
                        image_url=f"/assets/{fname}", cost=cost,
                        note=plan.get("reason", "")[:200], wearing=(kind == "outfit"))
    db.add(item)
    # 预付款转正（就改本次插入的那条流水）
    prepaid.reason = f"购置「{plan['title'][:40]}」"
    # 客厅炫耀
    db.add(Post(author_type="character", author_id="crina",
                content=f"{'收到' if by_nickname else '新入手'}「{plan['title']}」！{plan.get('reason', '')}",
                image_url=f"/assets/{fname}"))
    await db.commit()
    log.info("crina 购置了 %s (%s)", plan["title"], kind)
    return item
