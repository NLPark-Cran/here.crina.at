"""DayPlan 全天剧本：凌晨为每位居民预写一天的结构化事件，全空间共享同一状态机。

Alice 方法论三条铁律：
1. 一致性优于随机性——先定义状态机再实现功能（消灭"瞬移"）
2. 事件必须是结构体（时间/地点/活动/心情），缺一个维度下游就开始瞎猜
3. 凌晨批量生成一次，全天摊销成本
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..cache import get_redis
from ..db import SessionLocal
from ..models import Character, DayPlan
from ..soul.characters import WORLD
from . import tokendance

log = logging.getLogger("crina.dayplan")
CST = timezone(timedelta(hours=8))

WEATHER_KEY = "weather:hangzhou"
WEEKDAYS = "一二三四五六日"

# 剧本生成失败时的兜底（按人设作息写死的最小骨架，绝不让居民"没有一天"）
FALLBACK: dict[str, list[dict]] = {
    "xianmoying": [
        {"slot": "03:00", "kind": "creation", "location": "三楼房间", "activity": "写歌", "mood": "focused", "note": ""},
        {"slot": "14:00", "kind": "sleep", "location": "三楼房间", "activity": "补觉", "mood": "calm", "note": ""},
        {"slot": "22:00", "kind": "creation", "location": "三楼房间", "activity": "编曲", "mood": "focused", "note": ""},
    ],
    "guagua": [
        {"slot": "09:00", "kind": "rest", "location": "阳台瓜田", "activity": "*抱瓜打滚*", "mood": "happy", "note": ""},
        {"slot": "23:00", "kind": "rest", "location": "客厅", "activity": "*抱瓜路过*", "mood": "calm", "note": ""},
    ],
}
FALLBACK_DEFAULT = [
    {"slot": "08:00", "kind": "routine", "location": "客厅", "activity": "开始新的一天", "mood": "calm", "note": ""},
    {"slot": "14:00", "kind": "rest", "location": "自己房间", "activity": "午后小憩", "mood": "relaxed", "note": ""},
    {"slot": "21:00", "kind": "rest", "location": "客厅", "activity": "晚上随便待着", "mood": "calm", "note": ""},
]

VALID_KINDS = {"routine", "meal", "outing", "creation", "social", "rest", "sleep"}


async def fetch_weather() -> str:
    """杭州当日天气（wttr.in，Redis 缓存 6h；失败返回空串不阻塞剧本）"""
    r = get_redis()
    cached = await r.get(WEATHER_KEY)
    if cached:
        return cached
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get("https://wttr.in/Hangzhou?format=%C+%t&lang=zh")
            text = resp.text.strip()
            if resp.status_code == 200 and text and len(text) < 40:
                await r.setex(WEATHER_KEY, 6 * 3600, text)
                return text
    except Exception:
        log.exception("天气获取失败")
    return ""


PLAN_PROMPT = """{world}

{soul}

# 任务
为「你」预写明天（{date_str} 星期{weekday}）的一日剧本。{weather_line}{yesterday_line}
要求：
- 6-9 个事件，覆盖从早到晚；严格符合你的人格和作息（昼伏夜出的白天就在睡觉）
- 事件之间连贯：刚才在哪、接下来去哪，要合理，不许瞬移
- 可以提到其他居民（如"路过客厅时和 TA 打了个招呼"），但不要具体安排他们的行动——他们有自己的剧本
- 地点用世界观里的小屋格局（门厅/客厅/厨房/书房/信箱角/档案馆/各人房间/阳台瓜田）或合理的外出地
- activity 要具体有生活感（不是"工作"而是"给观鸟笔记补第三段"）
- 只输出 JSON 数组，每个事件：
  {{"slot": "HH:MM", "kind": "routine|meal|outing|creation|social|rest|sleep",
    "location": "地点", "activity": "具体在做什么", "mood": "focused|relaxed|tired|excited|blue|happy|calm",
    "note": "一句内心注脚，可为空"}}"""


def _validate_events(raw: str) -> list[dict] | None:
    try:
        raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        events = json.loads(raw)
        if not isinstance(events, list) or not events:
            return None
        out = []
        for e in events[:12]:
            slot = str(e.get("slot", ""))
            activity = str(e.get("activity", "")).strip()
            if len(slot) != 5 or not activity:
                continue
            out.append({
                "slot": slot,
                "kind": e["kind"] if e.get("kind") in VALID_KINDS else "routine",
                "location": str(e.get("location", "客厅"))[:20],
                "activity": activity[:60],
                "mood": str(e.get("mood", "calm"))[:16],
                "note": str(e.get("note", ""))[:60],
            })
        out.sort(key=lambda e: e["slot"])
        return out or None
    except (json.JSONDecodeError, TypeError, AttributeError):
        return None


async def generate_plan(char: Character, plan_date: date, weather: str,
                        yesterday: list[dict] | None) -> list[dict] | None:
    yesterday_line = ""
    if yesterday:
        brief = "；".join(f"{e['slot']}{e['activity']}" for e in yesterday[:6])
        yesterday_line = f"\n你昨天是这样过的：{brief}。今天可以有延续，也可以翻篇，像真的一天接一天。"
    prompt = PLAN_PROMPT.format(
        world=WORLD, soul=char.soul_public,
        date_str=plan_date.strftime("%Y年%m月%d日"), weekday=WEEKDAYS[plan_date.weekday()],
        weather_line=f"明天天气：{weather}。" if weather else "",
        yesterday_line=yesterday_line,
    )
    try:
        raw = await tokendance.chat_once([{"role": "user", "content": prompt}],
                                         temperature=0.9, max_tokens=1200)
        return _validate_events(raw)
    except Exception:
        log.exception("剧本生成失败 char=%s", char.id)
        return None


async def job_dayplan():
    """每天凌晨 04:30：取杭州天气，为每位居民各写一份全天剧本（幂等，已有则跳过）"""
    today = datetime.now(CST).date()
    weather = await fetch_weather()
    async with SessionLocal() as db:
        chars = (await db.execute(select(Character).where(Character.active == True))).scalars().all()  # noqa: E712
        for char in chars:
            dup = (await db.execute(
                select(DayPlan).where(DayPlan.character_id == char.id, DayPlan.plan_date == today)
            )).scalar_one_or_none()
            if dup:
                continue
            yd = (await db.execute(
                select(DayPlan).where(DayPlan.character_id == char.id)
                .order_by(DayPlan.plan_date.desc()).limit(1)
            )).scalar_one_or_none()
            yesterday = json.loads(yd.events) if yd else None
            events = await generate_plan(char, today, weather, yesterday)
            if not events:
                events = FALLBACK.get(char.id, FALLBACK_DEFAULT)
                log.warning("剧本兜底 char=%s", char.id)
            db.add(DayPlan(character_id=char.id, plan_date=today, weather=weather,
                           events=json.dumps(events, ensure_ascii=False)))
            await db.commit()
            # 日记：今天开头的心情（以第一个事件为引子）
            if char.id != "guagua" and events:
                from . import diary
                first = events[0]
                weather_bit = f"今天{weather}。" if weather else ""
                await diary.record(db, char.id, "daily",
                                   f"{weather_bit}新的一天从「{first['activity']}」开始。{first.get('note', '')}".strip(),
                                   mood="up" if first.get("mood") in ("excited", "happy") else "flat",
                                   intensity=2)
                await db.commit()
            log.info("全天剧本已写 char=%s events=%d", char.id, len(events))


async def get_today_plan(db: AsyncSession, character_id: str) -> DayPlan | None:
    return (await db.execute(
        select(DayPlan).where(DayPlan.character_id == character_id,
                              DayPlan.plan_date == datetime.now(CST).date())
    )).scalar_one_or_none()


def event_at(plan: DayPlan, now: datetime | None = None) -> dict | None:
    """当前时刻所处事件：最后一个 slot 不晚于现在的事件（用户不在场时居民也在过这一天）"""
    events = json.loads(plan.events)
    if not events:
        return None
    now = now or datetime.now(CST)
    cur = now.hour * 60 + now.minute
    current = None
    for e in events:
        try:
            h, m = int(e["slot"][:2]), int(e["slot"][3:])
        except (ValueError, KeyError):
            continue
        if h * 60 + m <= cur:
            current = e
        else:
            break
    return current or events[0]  # 剧本开始前：用第一个事件（凌晨刚醒/还没睡）


async def current_state(db: AsyncSession, character_id: str) -> dict | None:
    """消费侧统一入口：返回 {event, weather} 或 None（今天还没剧本）"""
    plan = await get_today_plan(db, character_id)
    if not plan:
        return None
    ev = event_at(plan)
    if not ev:
        return None
    return {"event": ev, "weather": plan.weather}
