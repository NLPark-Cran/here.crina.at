"""档案馆 · 日历事件 + ICS 订阅导出"""
from __future__ import annotations

import uuid as _uuid
from datetime import UTC, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Event, User
from ..security import create_session_token, decode_session_token, get_current_user

router = APIRouter(tags=["calendar"])

CST = timezone(timedelta(hours=8))

# --------------------------------

class CreateEvent(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    description: str = ""
    start_at: datetime
    end_at: datetime | None = None
    remind_minutes: int = 60

    @classmethod
    def _naive_as_cst(cls, dt: datetime | None) -> datetime | None:
        """naive 时间一律按 CST（+8）解释"""
        if dt is not None and dt.tzinfo is None:
            return dt.replace(tzinfo=CST)
        return dt

    def model_post_init(self, __context):
        self.start_at = self._naive_as_cst(self.start_at)
        self.end_at = self._naive_as_cst(self.end_at)


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
    ev = Event(user_id=user.id, title=body.title, description=body.description,
               start_at=body.start_at, end_at=body.end_at, remind_minutes=body.remind_minutes)
    db.add(ev)
    await db.commit()
    return {"id": str(ev.id)}


@router.delete("/events/{event_id}")
async def delete_event(event_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ev = await db.get(Event, _uuid.UUID(event_id))
    if not ev or ev.user_id != user.id:
        raise HTTPException(404, "事件不存在")
    await db.delete(ev)
    await db.commit()
    return {"ok": True}


@router.get("/events/ics-url")
async def ics_url(user: User = Depends(get_current_user)):
    """返回当前用户的日历订阅链接"""
    from ..config import get_settings
    token = create_session_token(user.id)
    return {"url": f"{get_settings().site_url}/api/events.ics?token={token}"}


@router.get("/events.ics")
async def export_ics(token: str, db: AsyncSession = Depends(get_db)):
    """日历订阅导出（挂进手机日历）：?token=<JWT>"""
    from fastapi.responses import Response
    from icalendar import Calendar
    from icalendar import Event as ICalEvent
    uid = decode_session_token(token)
    if not uid:
        raise HTTPException(401, "token 无效")
    rows = (await db.execute(select(Event).where(Event.user_id == uid))).scalars().all()
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

