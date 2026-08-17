"""初始化：建表 + 写入居民人设"""
from __future__ import annotations

import asyncio

from sqlalchemy import select

from .db import SessionLocal, engine
from .models import Base, Character
from .soul.characters import CHARACTERS


async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        for c in CHARACTERS:
            existing = (await db.execute(select(Character).where(Character.id == c["id"]))).scalar_one_or_none()
            if existing:
                for k, v in c.items():
                    if k != "id":
                        setattr(existing, k, v)
            else:
                db.add(Character(**c))
        await db.commit()
    print("✅ 建表完成，居民已入住：", ", ".join(c["name"] for c in CHARACTERS))


if __name__ == "__main__":
    asyncio.run(main())
