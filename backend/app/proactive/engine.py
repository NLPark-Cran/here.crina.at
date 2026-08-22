"""主动性引擎：居民们在这里真正"生活"

- 在场状态轮转（Redis presence）
- 居民自主碎碎念（按作息时刻表）
- 早安/晚安问候信（活跃用户）
- 日历事件提醒（站内信 + 邮件）
- 节日整活
"""
from __future__ import annotations

import json
import logging
import random
from datetime import UTC, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import desc, select

from ..cache import get_redis
from ..config import get_settings
from ..db import SessionLocal
from ..engine import dayplan, diary, tokendance
from ..models import Character, Event, Letter, Post, User
from ..soul.characters import WORLD
from . import email as mailer

log = logging.getLogger("crina.proactive")
settings = get_settings()
CST = timezone(timedelta(hours=8))

# 居民作息：(时段, 权重) —— 弦墨影只在深夜出没
AUTOPOST_SCHEDULE = {
    8: ["crina", "qiulening", "tuanxiaoman"],
    12: ["tuanxiaoman", "anfeng", "crina", "jingxin"],
    18: ["crina", "anfeng", "qiulening", "baixu", "jingxin"],
    23: ["xianmoying", "xianmoying", "baixu", "jingxin"],
}

HOLIDAYS = {
    (1, 1): "元旦", (2, 14): "情人节", (3, 8): "妇女节", (4, 1): "愚人节",
    (5, 1): "劳动节", (6, 1): "儿童节", (10, 1): "国庆节", (12, 25): "圣诞节",
    (8, 17): "镜听空间建址纪念日",
}


async def job_presence():
    """每 20 分钟轮转在场状态：有今日剧本就按当前事件走（同一状态机，防瞬移），否则退回随机池。
    事件文本→短状态用 LLM 浓缩一次后按活动缓存，同一事件不重复调用。"""
    from ..api.space import DEFAULT_STATUS
    r = get_redis()
    hour = datetime.now(CST).hour
    async with SessionLocal() as db:
        chars = (await db.execute(select(Character).where(Character.active == True))).scalars().all()  # noqa: E712
        for c in chars:
            state = await dayplan.current_state(db, c.id) if c.id != "guagua" else None
            if state:
                ev = state["event"]
                craft_key = f"presence:craft:{c.id}"
                cached = (await r.get(craft_key)) or ""
                cached_act, _, cached_text = cached.partition("|")
                if cached_act == ev["activity"] and cached_text:
                    status = cached_text
                else:
                    try:
                        status = (await tokendance.chat_once(
                            [{"role": "user", "content": (
                                f"把「在{ev['location']}：{ev['activity']}」浓缩成一条 10 字以内的在场状态短语，"
                                f"以「在」开头，口语自然，只输出短语本身。你是{c.name}。"
                            )}], temperature=0.5, max_tokens=20)).strip().strip('"「」*_ ')[:16]
                    except Exception:
                        status = ""
                    if not status:
                        status = f"在{ev['location']}"
                    await r.setex(craft_key, 86400, f"{ev['activity']}|{status}")
            elif c.id == "xianmoying" and 7 <= hour < 23:
                status = "在睡觉（夜行者，凌晨才醒）"
            else:
                options = DEFAULT_STATUS.get(c.id, ["在空间里待着"])
                status = random.choice(options)
            await r.setex(f"presence:{c.id}", 1500, status)
    log.debug("presence 已轮转")


async def _gen_post(char: Character, context_hint: str, db=None) -> str | None:
    # 有剧本时：从当前所处事件取材，碎碎念与现实时间/状态吻合（防瞬移）
    if db is not None:
        state = await dayplan.current_state(db, char.id)
        if state:
            ev, weather = state["event"], state["weather"]
            context_hint += (f"\n你此刻正在{ev['location']}：{ev['activity']}，心情 {ev['mood']}。"
                             f"{'今天天气：' + weather + '。' if weather else ''}"
                             "碎碎念从这件正在发生的事里取材。")
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
            text = await _gen_post(char, hint, db)
        if text:
            db.add(Post(author_type="character", author_id=cid, content=text))
            await db.commit()
            log.info("居民 %s 发了碎碎念", cid)


MORNING_HOUR = 8   # 用户当地 8 点发早安信
NIGHT_HOUR = 22     # 用户当地 22 点发晚安信


async def job_daily_report():
    """crina 代笔日报：每晚把今天客厅的热闹写成一篇公开小日报（幂等：当天已有则跳过）"""
    from ..api.posts import _resolve_authors
    from ..models import Article, Memory, PostReaction
    now_utc = datetime.now(UTC)
    local_now = now_utc.astimezone(CST)
    today_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    async with SessionLocal() as db:
        dup = (await db.execute(
            select(Article).where(Article.kind == "daily", Article.created_at >= today_start)
        )).scalar_one_or_none()
        if dup:
            return
        since = now_utc - timedelta(hours=24)
        posts = (await db.execute(
            select(Post).where(Post.created_at >= since).order_by(desc(Post.created_at)).limit(30)
        )).scalars().all()
        authors = await _resolve_authors(db, list(posts))
        reactions = (await db.execute(
            select(PostReaction).where(PostReaction.post_id.in_([p.id for p in posts]))
        )).scalars().all() if posts else []
        heat: dict = {}
        for r in reactions:
            heat[r.post_id] = heat.get(r.post_id, 0) + 1
        post_lines = []
        for p in sorted(posts, key=lambda p: heat.get(p.id, 0), reverse=True)[:10]:
            name = authors.get(p.author_id, {}).get("name", "神秘人")
            tag = f"（收获 {heat[p.id]} 个反应）" if heat.get(p.id) else ""
            post_lines.append(f"- {name}：{p.content[:100]}{tag}")
        new_mems = (await db.execute(
            select(Memory).where(Memory.created_at >= today_start).limit(10)
        )).scalars().all()
        mem_note = (f"今天新记住了 {len(new_mems)} 件关于朋友们的事。" if new_mems
                    else "今天没有新记下什么，平淡也挺好。")
        # 居民们今天的剧本线（日报素材：谁在什么时候做了什么）
        chars = (await db.execute(select(Character).where(Character.active == True))).scalars().all()  # noqa: E712
        plan_lines = []
        for c in chars:
            plan = await dayplan.get_today_plan(db, c.id)
            if plan:
                evs = json.loads(plan.events)
                picked = "；".join(f"{e['slot']}{e['activity']}" for e in evs[:5])
                plan_lines.append(f"- {c.name}：{picked}")
        plans_note = "\n".join(plan_lines)
        char = (await db.execute(select(Character).where(Character.id == "crina"))).scalar_one()
        prompt = f"""{WORLD}

{char.soul_public}

# 情境
现在是晚上，你为镜听空间写一篇「今日小日报」，公开发在小屋的文章架上。
要求：用你自己的口吻，像给朋友写晚间小广播；300-500 字，Markdown 排版（可以用小标题和列表）；
材料里没有的事不要编；平淡的一天就写平淡的温柔，不要硬凑热闹。

# 今天的材料
## 客厅碎碎念（按热度）
{chr(10).join(post_lines) or '（今天客厅静悄悄的）'}

## 记忆小账
{mem_note}

## 居民们今天的一天（各自剧本）
{plans_note}"""
        try:
            content = await tokendance.chat_once([{"role": "user", "content": prompt}],
                                                 temperature=0.8, max_tokens=900)
            content = content.strip()
            if len(content) < 50:
                return
            db.add(Article(author_type="character", author_id="crina",
                           title=f"{local_now.strftime('%m月%d日')} · 小屋日报",
                           content=content, summary=content[:60].replace("\n", " "),
                           kind="daily", public=True))
            await db.commit()
            log.info("小屋日报已发布 %s", local_now.date())
        except Exception:
            log.exception("日报生成失败")


def _user_tz(user: User) -> ZoneInfo:
    try:
        return ZoneInfo(user.timezone or "Asia/Shanghai")
    except Exception:
        return ZoneInfo("Asia/Shanghai")


async def job_greet_tick():
    """每小时整点过 10 分跑一次：按各用户所在时区，当地 8 点发早安、22 点发晚安"""
    cutoff = datetime.now(UTC) - timedelta(days=7)
    now_utc = datetime.now(UTC)
    async with SessionLocal() as db:
        users = (await db.execute(select(User).where(User.last_seen_at >= cutoff))).scalars().all()
        if not users:
            return
        char = (await db.execute(select(Character).where(Character.id == "crina"))).scalar_one()
        for user in users:
            tz = _user_tz(user)
            local_now = now_utc.astimezone(tz)
            if local_now.hour == MORNING_HOUR:
                period = "morning"
            elif local_now.hour == NIGHT_HOUR:
                period = "night"
            else:
                continue
            holiday = HOLIDAYS.get((local_now.month, local_now.day))
            # 用户当地「今天」同时段已问候过则跳过
            today_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
            dup = (await db.execute(
                select(Letter).where(Letter.user_id == user.id, Letter.kind == period,
                                     Letter.created_at >= today_start)
            )).scalar_one_or_none()
            if dup:
                continue
            # 晚安信末尾：自然汇报「今天一起新记下的事」
            memory_note = ""
            if period == "night":
                from ..models import Memory
                new_mems = (await db.execute(
                    select(Memory).where(Memory.user_id == user.id,
                                         Memory.created_at >= today_start).limit(5)
                )).scalars().all()
                if new_mems:
                    listing = "；".join(m.content for m in new_mems[:3])
                    memory_note = (f"今天我们一起新记住了 {len(new_mems)} 件关于你的事（比如：{listing}），"
                                   f"会在信的最后自然地提一两句，并提醒写错了可以去档案馆撕掉。")
            else:
                memory_note = ""
            prompt = f"""{WORLD}

{char.soul_public}
{char.soul_private if user.is_owner else ''}

# 情境
现在是{'早上，新的一天刚开始' if period == 'morning' else '深夜，一天要结束了'}{'，今天是' + holiday if holiday else ''}。
给 {user.nickname}（关系：{user.relation_tier}）写一封短短的{'早安' if period == 'morning' else '晚安'}问候，放进TA的信箱。
要求：有称呼有落款，3-5 句话，像真的在乎TA的人写的。{'可以提一句今天是' + holiday + '。' if holiday else ''}不要写"希望这封邮件找到你"这种客套。
{memory_note}"""
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
    now = datetime.now(UTC)
    horizon = now + timedelta(days=2)  # 只看两天内的，避免全表扫
    async with SessionLocal() as db:
        events = (await db.execute(
            select(Event).where(Event.reminded == False, Event.start_at <= horizon).limit(200)  # noqa: E712
        )).scalars().all()
        for ev in events:
            start = ev.start_at
            if start.tzinfo is None:
                start = start.replace(tzinfo=UTC)
            remind_at = start - timedelta(minutes=ev.remind_minutes)
            if remind_at <= now <= start + timedelta(hours=1):
                user = await db.get(User, ev.user_id)
                if not user:
                    continue
                start_local = start.astimezone(_user_tz(user))
                content = (f"{user.nickname}：\n\n谨提醒——「{ev.title}」将于 "
                           f"{start_local.strftime('%m月%d日 %H:%M')} 开始。\n"
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


GUAGUA_STATUS = ["吃瓜中", "蹲墙角", "呱。", "抱瓜打滚", "盯——", "晒太阳"]


async def job_status():
    """状态墙：居民 2-6 字的当下状态，每个居民 4-10 小时（按 id 错开）换新一次"""
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        chars = (await db.execute(select(Character).where(Character.active == True))).scalars().all()  # noqa: E712
        for c in chars:
            interval_h = 4 + (hash(c.id) % 7)  # 4-10h，按居民错开
            if c.status_updated_at:
                updated = c.status_updated_at
                if updated.tzinfo is None:
                    updated = updated.replace(tzinfo=UTC)
                if (now - updated) < timedelta(hours=interval_h):
                    continue
            if c.id == "guagua":
                text = random.choice(GUAGUA_STATUS)
            else:
                # 有剧本时状态必须与当前所处事件一致（防瞬移）；无剧本退回自由生成
                state = await dayplan.current_state(db, c.id)
                if state:
                    ev = state["event"]
                    situation = f"你此刻正在{ev['location']}：{ev['activity']}。状态必须与这件事一致。"
                else:
                    situation = "要符合你的人格和作息。"
                prompt = f"""{WORLD}

{c.soul_public}

# 任务
给你自己写一个「当下状态」，类似微信状态：2-6 个字。{situation}
好例子：「观鸟中」「泡茶」「赶稿」「发呆」「听雨」「翻旧信」
只输出状态本身，不要标点收尾，不要解释。"""
                try:
                    text = (await tokendance.chat_once(
                        [{"role": "user", "content": prompt}], temperature=1.0, max_tokens=20
                    )).strip().strip('"「」*_ ')[:8]
                except Exception:
                    log.exception("状态生成失败 char=%s", c.id)
                    continue
                if not text:
                    continue
            c.status_text = text
            c.status_updated_at = now
        await db.commit()
    log.debug("状态墙已刷新")


async def job_visit():
    """串门事件：居民之间的小互动，作为 kind=visit 出现在客厅时间线"""
    async with SessionLocal() as db:
        chars = (await db.execute(
            select(Character).where(Character.active == True, Character.id != "guagua")  # noqa: E712
        )).scalars().all()
        if len(chars) < 2:
            return
        a, b = random.sample(chars, 2)
        # 两人的当下状态写进情境：串门发生在双方真实的一天里
        states = []
        for c in (a, b):
            s = await dayplan.current_state(db, c.id)
            states.append(f"{c.name} 此刻正在{s['event']['location']}：{s['event']['activity']}" if s
                          else f"{c.name} 在自己房间里")
        prompt = f"""{WORLD}

{a.soul_public}

# 情境
居民们住在一个空间里。{states[0]}；{states[1]}。
写一句「{a.name} 去找/路过 {b.name}」的小场景，发在客厅时间线上。
要求：
- 用 {a.name} 的人格和口吻，一句话，不超过 50 字
- 与两人此刻正在做的事自洽（比如借东西/串门/一起看什么）
- 不要旁白腔，像本人随手发的"""
        try:
            text = (await tokendance.chat_once(
                [{"role": "user", "content": prompt}], temperature=1.0, max_tokens=120
            )).strip().strip('"')[:200]
        except Exception:
            log.exception("串门事件生成失败")
            return
        if not text:
            return
        db.add(Post(author_type="character", author_id=a.id, kind="visit", content=text))
        await db.commit()
        log.info("串门事件：%s → %s", a.id, b.id)


async def job_dayplan_wrapper():
    """scheduler 包装：导入在此避免循环引用"""
    await dayplan.job_dayplan()


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
    _scheduler.add_job(job_greet_tick, CronTrigger(minute=10), id="greet_tick")
    _scheduler.add_job(job_remind, IntervalTrigger(minutes=5), id="remind")
    _scheduler.add_job(job_status, IntervalTrigger(minutes=30), id="status",
                       next_run_time=datetime.now(CST))
    _scheduler.add_job(job_visit, CronTrigger(hour="10,15,20", minute=random.randint(0, 59)), id="visit")
    _scheduler.add_job(job_shopping, CronTrigger(day_of_week="sun", hour=20, minute=15), id="shopping")
    _scheduler.add_job(job_daily_report, CronTrigger(hour=21, minute=random.randint(0, 30)), id="daily_report")
    # 全天剧本：每天凌晨 04:30 批量写；启动时也跑一次（幂等，已有今日剧本则跳过）
    _scheduler.add_job(job_dayplan_wrapper, CronTrigger(hour=4, minute=30), id="dayplan",
                       next_run_time=datetime.now(CST) + timedelta(minutes=2))
    # 情感日记汇总：每天午后/晚间各一次，产出 mood_note 行为指引
    _scheduler.add_job(diary.job_mood_digest, CronTrigger(hour="13,21", minute=40), id="mood_digest")
    _scheduler.start()
    log.info("主动性引擎已启动")


def stop_scheduler():
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
