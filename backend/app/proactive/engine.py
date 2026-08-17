"""主动性引擎：居民们在这里真正"生活"

- 在场状态轮转（Redis presence）
- 居民自主碎碎念（按作息时刻表）
- 早安/晚安问候信（活跃用户）
- 日历事件提醒（站内信 + 邮件）
- 节日整活
"""
from __future__ import annotations

import logging
import random
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select

from ..cache import get_redis
from ..config import get_settings
from ..db import SessionLocal
from ..engine import tokendance
from ..models import Character, Event, Letter, Post, User
from ..soul.characters import WORLD
from . import email as mailer

log = logging.getLogger("crina.proactive")
settings = get_settings()
CST = timezone(timedelta(hours=8))

# 居民作息：(时段, 权重) —— 弦墨影只在深夜出没
AUTOPOST_SCHEDULE = {
    8: ["crina", "qiulening", "tuanxiaoman"],
    12: ["tuanxiaoman", "anfeng", "crina"],
    18: ["crina", "anfeng", "qiulening", "baixu"],
    23: ["xianmoying", "xianmoying", "baixu"],
}

HOLIDAYS = {
    (1, 1): "元旦", (2, 14): "情人节", (3, 8): "妇女节", (4, 1): "愚人节",
    (5, 1): "劳动节", (6, 1): "儿童节", (10, 1): "国庆节", (12, 25): "圣诞节",
    (8, 17): "镜听空间建址纪念日",
}


async def job_presence():
    """每 20 分钟轮转在场状态"""
    from ..api.space import DEFAULT_STATUS
    r = get_redis()
    hour = datetime.now(CST).hour
    async with SessionLocal() as db:
        chars = (await db.execute(select(Character).where(Character.active == True))).scalars().all()  # noqa: E712
        for c in chars:
            options = DEFAULT_STATUS.get(c.id, ["在空间里待着"])
            if c.id == "xianmoying" and 7 <= hour < 23:
                status = "在睡觉（夜行者，凌晨才醒）"
            else:
                status = random.choice(options)
            await r.setex(f"presence:{c.id}", 1500, status)
    log.debug("presence 已轮转")


async def _gen_post(char: Character, context_hint: str) -> str | None:
    prompt = f"""{WORLD}

{char.soul_public}

# 情境
{context_hint}
你要在客厅（碎碎念广场）发一条碎碎念。要求：
- 完全用你的人格和口吻，像真的随手发的动态
- 1-3 句话，不要超过 80 字
- 不要称呼"大家"，直接抒发
- 可以有具体的小细节（天气/食物/书/鸟/心情）"""
    try:
        text = await tokendance.chat_once([{"role": "user", "content": prompt}], temperature=1.0, max_tokens=150)
        return text.strip().strip('"')[:300] or None
    except Exception:
        log.exception("自主发帖生成失败 char=%s", char.id)
        return None


async def job_autopost(hour: int):
    """居民自主发帖"""
    candidates = AUTOPOST_SCHEDULE.get(hour, ["crina"])
    cid = random.choice(candidates)
    async with SessionLocal() as db:
        char = (await db.execute(select(Character).where(Character.id == cid))).scalar_one_or_none()
        if not char:
            return
        now = datetime.now(CST)
        holiday = HOLIDAYS.get((now.month, now.day))
        hint = f"现在是{now.strftime('%m月%d日')}{'，今天是' + holiday if holiday else ''}，{'早上' if hour < 10 else '中午' if hour < 14 else '傍晚' if hour < 20 else '深夜'}。"
        if cid == "guagua":
            text = random.choice(["呱！", "呱呱～ *抱瓜打滚*", "呱……（盯", "*吃瓜* 呱"])
        else:
            text = await _gen_post(char, hint)
        if text:
            db.add(Post(author_type="character", author_id=cid, content=text))
            await db.commit()
            log.info("居民 %s 发了碎碎念", cid)


async def job_greet(period: str):
    """早安/晚安问候信（7 天内活跃的用户）"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    async with SessionLocal() as db:
        users = (await db.execute(select(User).where(User.last_seen_at >= cutoff))).scalars().all()
        if not users:
            return
        char = (await db.execute(select(Character).where(Character.id == "crina"))).scalar_one()
        now = datetime.now(CST)
        holiday = HOLIDAYS.get((now.month, now.day))
        for user in users:
            # 今天同时段已问候过则跳过
            today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            dup = (await db.execute(
                select(Letter).where(Letter.user_id == user.id, Letter.kind == period,
                                     Letter.created_at >= today_start)
            )).scalar_one_or_none()
            if dup:
                continue
            prompt = f"""{WORLD}

{char.soul_public}
{char.soul_private if user.is_owner else ''}

# 情境
现在是{'早上，新的一天刚开始' if period == 'morning' else '深夜，一天要结束了'}{'，今天是' + holiday if holiday else ''}。
给 {user.nickname}（关系：{user.relation_tier}）写一封短短的{'早安' if period == 'morning' else '晚安'}问候，放进TA的信箱。
要求：有称呼有落款，3-5 句话，像真的在乎TA的人写的。{'可以提一句今天是' + holiday + '。' if holiday else ''}不要写"希望这封邮件找到你"这种客套。"""
            try:
                content = await tokendance.chat_once([{"role": "user", "content": prompt}],
                                                     temperature=0.9, max_tokens=300)
                letter = Letter(user_id=user.id, character_id="crina", kind=period,
                                title="早安，新的一天" if period == "morning" else "晚安，好梦",
                                content=content.strip())
                db.add(letter)
                await db.commit()
                # 邮件同步（若配置且用户开启）
                if user.notify_email and user.email and mailer.configured():
                    ok = await mailer.send_mail(user.email, f"[镜听空间] {letter.title}", letter.content)
                    if ok:
                        letter.emailed = True
                        await db.commit()
            except Exception:
                log.exception("问候信生成失败 user=%s", user.id)


async def job_remind():
    """事件提醒：到点未提醒的 → 站内信 + 邮件"""
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        events = (await db.execute(select(Event).where(Event.reminded == False))).scalars().all()  # noqa: E712
        for ev in events:
            start = ev.start_at
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            remind_at = start - timedelta(minutes=ev.remind_minutes)
            if remind_at <= now <= start + timedelta(hours=1):
                user = await db.get(User, ev.user_id)
                if not user:
                    continue
                start_cst = start.astimezone(CST)
                content = (f"{user.nickname}：\n\n谨提醒——「{ev.title}」将于 "
                           f"{start_cst.strftime('%m月%d日 %H:%M')} 开始。\n"
                           f"{ev.description}\n\n别迟到呀。\n\n—— crina 谨上")
                letter = Letter(user_id=user.id, character_id="crina", kind="reminder",
                                title=f"提醒：{ev.title}", content=content)
                db.add(letter)
                ev.reminded = True
                await db.commit()
                if user.notify_email and user.email and mailer.configured():
                    ok = await mailer.send_mail(user.email, f"[镜听空间] 提醒：{ev.title}", content)
                    if ok:
                        letter.emailed = True
                        await db.commit()
                log.info("事件提醒已发送 user=%s event=%s", user.id, ev.title)


async def job_shopping():
    """每周日傍晚：经费充足的话 crina 自己去逛街"""
    from ..engine import wardrobe
    async with SessionLocal() as db:
        balance = await wardrobe.get_balance(db)
        if balance < wardrobe.OUTFIT_COST:
            return
        kind = "outfit" if random.random() < 0.6 else "decor"
        await wardrobe.buy(db, kind, "", "")


_scheduler: AsyncIOScheduler | None = None


def start_scheduler():
    global _scheduler
    if _scheduler:
        return
    _scheduler = AsyncIOScheduler(timezone=CST)
    _scheduler.add_job(job_presence, IntervalTrigger(minutes=20), id="presence",
                       next_run_time=datetime.now(CST))
    for hour in (8, 12, 18, 23):
        _scheduler.add_job(job_autopost, CronTrigger(hour=hour, minute=random.randint(5, 45)),
                           args=[hour], id=f"autopost_{hour}")
    _scheduler.add_job(job_greet, CronTrigger(hour=8, minute=10), args=["morning"], id="greet_morning")
    _scheduler.add_job(job_greet, CronTrigger(hour=22, minute=40), args=["night"], id="greet_night")
    _scheduler.add_job(job_remind, IntervalTrigger(minutes=5), id="remind")
    _scheduler.add_job(job_shopping, CronTrigger(day_of_week="sun", hour=20, minute=15), id="shopping")
    _scheduler.start()
    log.info("主动性引擎已启动")


def stop_scheduler():
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
