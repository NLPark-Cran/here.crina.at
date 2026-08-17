#!/usr/bin/env python3
"""记忆大扫除：LLM 审核每个用户的现有记忆，删除臆想/虚构/过程描述类条目

用法：cd backend && .venv/bin/python -m scripts.memory_cleanup [--apply]
默认 dry-run 只打印；--apply 才真正删除。删除留痕进日志。
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.engine import tokendance
from app.models import Memory, User

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("memory-cleanup")

AUDIT_PROMPT = """你是记忆审计员。审查下面这份关于某位用户的长期记忆库，挑出应该删除的条目。

应该删除的：
- 臆想/过度推测的心理画像（"用户有强烈的向往""用户很孤独"这类没有原话支撑的）
- 角色扮演/游戏/编故事产生的虚构内容
- 对话过程描述（"用户纠正了某角色""用户问了某问题"）
- 一次性闲聊或当时情绪
- 内容重复或互相矛盾的旧条目

应该保留的：稳定客观事实（fact）、明确表达的偏好（preference）。

输出 JSON：{"delete": ["id1", "id2"], "keep_reason_brief": "一句话"}
如果没有要删的，输出 {"delete": []}。

记忆库：
__MEMORIES__"""


async def main():
    apply = "--apply" in sys.argv
    async with SessionLocal() as db:
        users = (await db.execute(select(User))).scalars().all()
        for user in users:
            mems = (await db.execute(
                select(Memory).where(Memory.user_id == user.id)
            )).scalars().all()
            if not mems:
                continue
            block = "\n".join(f"- id={m.id} [{m.kind}] {m.content}（证据：{m.evidence or '无'}）" for m in mems)
            try:
                raw = await tokendance.chat_once(
                    [{"role": "user", "content": AUDIT_PROMPT.replace("__MEMORIES__", block)}],
                    temperature=0.2, max_tokens=400)
                raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
                result = json.loads(raw)
                to_delete = set(str(x) for x in result.get("delete", []))
            except Exception:
                log.exception("审计失败 user=%s，跳过", user.nickname)
                continue
            doomed = [m for m in mems if str(m.id) in to_delete]
            log.info("== %s：%d 条记忆，建议删除 %d 条 ==", user.nickname, len(mems), len(doomed))
            for m in doomed:
                log.info("  🗑 [%s] %s", m.kind, m.content[:60])
                if apply:
                    await db.delete(m)
            if apply and doomed:
                await db.commit()
                log.info("  ✅ 已删除")
    log.info("大扫除完成%s", "" if apply else "（dry-run，加 --apply 真正执行）")


if __name__ == "__main__":
    asyncio.run(main())
