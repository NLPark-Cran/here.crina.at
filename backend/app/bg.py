"""后台任务登记处：防止事件循环弱引用导致任务被 GC"""
from __future__ import annotations

import asyncio
from collections.abc import Coroutine

_tasks: set[asyncio.Task] = set()


def fire_and_forget(coro: Coroutine) -> None:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
