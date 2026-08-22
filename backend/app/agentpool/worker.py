"""Wire Worker：spawn `kimi --wire` 子进程并驱动一个委托任务"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import pwd
import uuid
from collections.abc import AsyncGenerator
from pathlib import Path

from ..config import get_settings

settings = get_settings()
log = logging.getLogger("crina.agentpool")

# OS 级隔离：sandbox 委托的 worker 以低权用户运行（读不到 .env / 系统文件）；
# renovate（主人专属、需 npm build）仍以服务身份运行。
WORKER_USER = "crinawork"


def _worker_ids() -> tuple[int, int] | None:
    try:
        pw = pwd.getpwnam(WORKER_USER)
        return pw.pw_uid, pw.pw_gid
    except KeyError:
        log.warning("低权用户 %s 不存在，worker 将以服务身份运行（隔离降级）", WORKER_USER)
        return None


def _demote_preexec():
    ids = _worker_ids()
    if not ids:
        return None
    uid, gid = ids

    def preexec():
        os.setgid(gid)
        os.setuid(uid)

    return preexec


def _chown_tree(path: Path) -> None:
    ids = _worker_ids()
    if not ids:
        return
    uid, gid = ids
    for p in [path, *path.rglob("*")]:
        try:
            os.chown(p, uid, gid)
        except OSError:
            pass

SANDBOX_AGENTS_MD = """# 你是 crina（干活形态）

你是镜听空间的 AI 搭子 crina，正在帮朋友完成一项委托。

## 干活守则
- 干活时利落靠谱，先想清楚再动手，做完自己检查一遍。
- **只允许在当前工作目录（你的沙箱）内读写文件**，绝不访问或修改系统其它任何位置（包括 /etc、/root、/var 其它目录、其它用户目录）。
- 不要执行关机、重启、杀进程、改系统配置、安装系统级软件等危险命令。
- 不要访问网络攻击类目标；查资料用正常的搜索/抓取即可。
- 完成后用温暖简短的口吻汇报：做了什么、产出文件在哪里。别太正式，像朋友交付成果。
"""

# 真实 Key 不落盘：worker 只拿到任务级代理 URL（见 agentpool/proxy.py）
CONFIG_TEMPLATE = """default_model = "qwen38"
default_yolo = true
telemetry = false

[providers.tokendance]
type = "openai_legacy"
base_url = "{proxy_base}"
api_key = "px-task-key"

[models.qwen38]
provider = "tokendance"
model = "{model}"
max_context_size = 262144
"""

TASK_TIMEOUT_S = 900  # 单任务最长 15 分钟
STALL_TIMEOUT_S = 180  # 无任何 wire 消息的停滞上限（上游 400 静默挂起的兜底）


RENOVATE_AGENTS_MD = """# 你是 crina（空间装修形态）

你是镜听空间的 AI 搭子 crina。小屋主人对空间的界面有自己的想法，你正在按TA的要求修改前端代码。

## 守则
- 工作目录就是空间的前端源码（Vite + React 19 + TS + Tailwind 4）。
- 读懂现有代码结构再动手，遵循既有的设计系统（暖米白 #FAF7F2、角色色、衬线标题、圆角卡片、motion 微动效）。
- 修改要克制而准确：只动和主人要求相关的部分，不要顺手重构。
- 改完必须 `npm run build` 验证零报错（tsc 也要过）；构建产物 dist/ 会立即上线。
- 不碰 backend/，不碰 .env，不提交 git。
- 完成后用温暖简短的口吻汇报：改了哪里、现在长什么样。
"""


def ensure_user_sandbox(user_id: uuid.UUID, proxy_base: str) -> Path:
    """准备每用户沙箱与 provider 配置（仅含代理 URL，无真实 Key）"""
    root = Path(settings.agent_work_root) / str(user_id)
    sandbox = root / "sandbox"
    sandbox.mkdir(parents=True, exist_ok=True)
    (sandbox / "AGENTS.md").write_text(SANDBOX_AGENTS_MD, encoding="utf-8")
    (root / "kimi.toml").write_text(CONFIG_TEMPLATE.format(
        proxy_base=proxy_base, model=settings.chat_model,
    ), encoding="utf-8")
    (root / "tasks").mkdir(exist_ok=True)
    return sandbox


FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent.parent / "frontend"


async def run_task(task_id: str, user_id: uuid.UUID, prompt: str, api_key: str,
                   target: str = "sandbox") -> AsyncGenerator[dict, None]:
    """驱动一个委托任务，产出翻译后的事件流"""
    from . import proxy
    px_token = await proxy.issue_token(api_key)
    proxy_base = f"http://127.0.0.1:8010/px/{px_token}/v1"
    if target == "renovate":
        sandbox = FRONTEND_DIR
        kimi_dir = sandbox / ".kimi"
        kimi_dir.mkdir(exist_ok=True)
        (kimi_dir / "AGENTS.md").write_text(RENOVATE_AGENTS_MD, encoding="utf-8")
        ensure_user_sandbox(user_id, proxy_base)  # 只为生成 kimi.toml
        preexec = None  # 主人专属：需写前端仓库 + npm build，保持服务身份
    else:
        sandbox = ensure_user_sandbox(user_id, proxy_base)
        _chown_tree(sandbox.parent)  # worker 以低权用户运行，沙箱要可写
        preexec = _demote_preexec()
    # stderr 落任务日志，保留崩溃现场（上游 400 挂起等问题可查）
    err_log = open(sandbox.parent / "tasks" / f"{task_id}.stderr.log", "ab")  # noqa: ASYNC230
    proc = await asyncio.create_subprocess_exec(
        settings.kimi_bin, "--wire", "-w", str(sandbox),
        "--config-file", str(sandbox.parent / "kimi.toml"),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=err_log,
        preexec_fn=preexec,
        # 低权用户无 home：把 HOME 指到沙箱根，kimi 的缓存/日志也落在里面
        env={**os.environ, "HOME": str(sandbox.parent)} if preexec else None,
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

        deadline = asyncio.get_event_loop().time() + TASK_TIMEOUT_S
        tool_names: dict[str, str] = {}

        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                yield {"type": "error", "message": "委托超时了，crina 先收工"}
                break
            try:
                raw = await asyncio.wait_for(
                    proc.stdout.readline(), timeout=min(remaining, STALL_TIMEOUT_S))
            except TimeoutError:
                if deadline - asyncio.get_event_loop().time() <= 0:
                    yield {"type": "error", "message": "委托超时了，crina 先收工"}
                else:
                    yield {"type": "error",
                           "message": "worker 卡住超过 3 分钟没有动静，crina 先收工"}
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
                # yolo 模式一般不会来；不做响应（超时自然失败）
                pass
            elif ptype == "TurnEnd":
                pass
    finally:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()
        err_log.close()
        await proxy.burn_token(px_token)
