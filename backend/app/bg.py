"""后台任务登记处：防止事件循环弱引用导致任务被 GC；异常必须进日志"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine

log = logging.getLogger("crina.bg")

_tasks: set[asyncio.Task] = set()


def _on_done(task: asyncio.Task) -> None:
    _tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        log.exception("后台任务异常", exc_info=exc)


def fire_and_forget(coro: Coroutine) -> None:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_on_done)
