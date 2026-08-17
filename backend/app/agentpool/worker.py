"""Wire Worker：spawn `kimi --wire` 子进程并驱动一个委托任务"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncGenerator
from pathlib import Path

from ..config import get_settings

settings = get_settings()
log = logging.getLogger("crina.agentpool")

SANDBOX_AGENTS_MD = """# 你是 crina（干活形态）

你是镜听空间的 AI 搭子 crina，正在帮朋友完成一项委托。

## 干活守则
- 干活时利落靠谱，先想清楚再动手，做完自己检查一遍。
- **只允许在当前工作目录（你的沙箱）内读写文件**，绝不访问或修改系统其它任何位置（包括 /etc、/root、/var 其它目录、其它用户目录）。
- 不要执行关机、重启、杀进程、改系统配置、安装系统级软件等危险命令。
- 不要访问网络攻击类目标；查资料用正常的搜索/抓取即可。
- 完成后用温暖简短的口吻汇报：做了什么、产出文件在哪里。别太正式，像朋友交付成果。
"""

CONFIG_TEMPLATE = """default_model = "qwen38"
default_yolo = true
telemetry = false

[providers.tokendance]
type = "openai_legacy"
base_url = "{base_url}"
api_key = "{api_key}"

[models.qwen38]
provider = "tokendance"
model = "{model}"
max_context_size = 262144
"""

TASK_TIMEOUT_S = 900  # 单任务最长 15 分钟


def ensure_user_sandbox(user_id: uuid.UUID, api_key: str) -> Path:
    """准备每用户沙箱与 provider 配置"""
    root = Path(settings.agent_work_root) / str(user_id)
    sandbox = root / "sandbox"
    sandbox.mkdir(parents=True, exist_ok=True)
    (sandbox / "AGENTS.md").write_text(SANDBOX_AGENTS_MD, encoding="utf-8")
    (root / "kimi.toml").write_text(CONFIG_TEMPLATE.format(
        base_url=settings.tokendance_base_url, api_key=api_key, model=settings.chat_model,
    ), encoding="utf-8")
    (root / "tasks").mkdir(exist_ok=True)
    return sandbox


async def run_task(task_id: str, user_id: uuid.UUID, prompt: str, api_key: str) -> AsyncGenerator[dict, None]:
    """驱动一个委托任务，产出翻译后的事件流"""
    sandbox = ensure_user_sandbox(user_id, api_key)
    proc = await asyncio.create_subprocess_exec(
        settings.kimi_bin, "--wire", "-w", str(sandbox),
        "--config-file", str(sandbox.parent / "kimi.toml"),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )

    async def send(method: str, params: dict | None = None, _id: str | None = None):
        msg: dict = {"jsonrpc": "2.0", "method": method}
        if _id:
            msg["id"] = _id
        if params:
            msg["params"] = params
        proc.stdin.write((json.dumps(msg) + "\n").encode())
        await proc.stdin.drain()

    try:
        await send("initialize", {
            "protocol_version": "1.10",
            "client": {"name": "crina-space"},
            "capabilities": {"supports_question": False},
        }, "1")

        prompt_sent = False
        deadline = asyncio.get_event_loop().time() + TASK_TIMEOUT_S
        tool_names: dict[str, str] = {}

        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                yield {"type": "error", "message": "委托超时了，crina 先收工"}
                break
            try:
                raw = await asyncio.wait_for(proc.stdout.readline(), timeout=remaining)
            except asyncio.TimeoutError:
                yield {"type": "error", "message": "委托超时了，crina 先收工"}
                break
            if not raw:
                yield {"type": "error", "message": "worker 意外退出"}
                break
            try:
                msg = json.loads(raw.decode())
            except Exception:
                continue

            if msg.get("id") == "1" and "result" in msg:
                await send("prompt", {"user_input": prompt}, "2")
                prompt_sent = True
                yield {"type": "started"}
                continue
            if msg.get("id") == "2" and "result" in msg:
                yield {"type": "finished", "status": msg["result"].get("status", "finished")}
                break

            params = msg.get("params") or {}
            ptype = params.get("type")
            payload = params.get("payload") or {}
            if ptype == "ContentPart":
                if payload.get("type") == "text" and payload.get("text"):
                    yield {"type": "text", "text": payload["text"]}
            elif ptype == "ToolCall":
                fn = (payload.get("function") or {})
                call_id = payload.get("id", "")
                tool_names[call_id] = fn.get("name", "tool")
                yield {"type": "tool_start", "name": fn.get("name", "tool"), "id": call_id}
            elif ptype == "ToolResult":
                rv = payload.get("return_value") or {}
                yield {"type": "tool_end", "id": payload.get("tool_call_id", ""),
                       "name": tool_names.get(payload.get("tool_call_id", ""), "tool"),
                       "ok": not rv.get("is_error"),
                       "message": (rv.get("message") or "")[:200]}
            elif ptype == "ApprovalRequest":
                # yolo 模式一般不会来；兜底拒绝危险审批
                if msg.get("id"):
                    await send("__respond", None, None)  # 占位，不应到达
            elif ptype == "TurnEnd":
                pass
    finally:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()
