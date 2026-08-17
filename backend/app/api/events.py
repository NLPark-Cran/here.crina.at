"""档案馆 · 日历事件 + ICS 订阅导出"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Event, User
from ..security import get_current_user, parse_uuid

router = APIRouter(tags=["calendar"])

CST = timezone(timedelta(hours=8))

# --------------------------------

class CreateEvent(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2000)
    start_at: datetime
    end_at: datetime | None = None
    remind_minutes: int = Field(default=60, ge=0, le=10080)  # 最长提前一周


@router.get("/events")
async def list_events(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Event).where(Event.user_id == user.id).order_by(Event.start_at).limit(200)
    )).scalars().all()
    return {"events": [
        {"id": str(e.id), "title": e.title, "description": e.description,
         "start_at": e.start_at.isoformat(), "end_at": e.end_at.isoformat() if e.end_at else None,
         "remind_minutes": e.remind_minutes, "source": e.source}
        for e in rows
    ]}


@router.post("/events")
async def create_event(body: CreateEvent, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # naive 时间按用户所在时区解释
    from zoneinfo import ZoneInfo
    try:
        tz = ZoneInfo(user.timezone or "Asia/Shanghai")
    except Exception:
        tz = CST
    start = body.start_at.replace(tzinfo=tz) if body.start_at.tzinfo is None else body.start_at
    end = body.end_at
    if end is not None and end.tzinfo is None:
        end = end.replace(tzinfo=tz)
    ev = Event(user_id=user.id, title=body.title, description=body.description,
               start_at=start, end_at=end, remind_minutes=body.remind_minutes)
    db.add(ev)
    await db.commit()
    return {"id": str(ev.id)}


@router.delete("/events/{event_id}")
async def delete_event(event_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ev = await db.get(Event, parse_uuid(event_id))
    if not ev or ev.user_id != user.id:
        raise HTTPException(404, "事件不存在")
    await db.delete(ev)
    await db.commit()
    return {"ok": True}


@router.get("/events/ics-url")
async def ics_url(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """返回当前用户的日历订阅链接（独立只读 token，可重置）"""
    import secrets

    from ..config import get_settings
    if not user.ics_token:
        user.ics_token = secrets.token_urlsafe(32)
        await db.commit()
    return {"url": f"{get_settings().site_url}/api/events.ics?token={user.ics_token}"}


@router.post("/events/ics-url/reset")
async def ics_url_reset(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """重置订阅 token（旧链接立即失效）"""
    import secrets
    user.ics_token = secrets.token_urlsafe(32)
    await db.commit()
    return {"ok": True}


@router.get("/events.ics")
async def export_ics(token: str, db: AsyncSession = Depends(get_db)):
    """日历订阅导出（挂进手机日历）：?token=<只读订阅 token>"""
    from fastapi.responses import Response
    from icalendar import Calendar
    from icalendar import Event as ICalEvent
    user = (await db.execute(select(User).where(User.ics_token == token))).scalar_one_or_none()
    if not user or not token:
        raise HTTPException(401, "token 无效")
    rows = (await db.execute(select(Event).where(Event.user_id == user.id))).scalars().all()
    cal = Calendar()
    cal.add("prodid", "-//Crina Space//here.crina.at//CN")
    cal.add("version", "2.0")
    cal.add("x-wr-calname", "镜听空间")
    for e in rows:
        ie = ICalEvent()
        ie.add("uid", f"{e.id}@here.crina.at")
        ie.add("summary", e.title)
        ie.add("description", e.description)
        ie.add("dtstart", e.start_at)
        if e.end_at:
            ie.add("dtend", e.end_at)
        ie.add("dtstamp", datetime.now(UTC))
        cal.add_component(ie)
    return Response(content=cal.to_ical(), media_type="text/calendar",
                    headers={"Content-Disposition": "attachment; filename=crina.ics"})

