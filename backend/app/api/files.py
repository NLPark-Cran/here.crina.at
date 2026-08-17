"""文件空间：每用户沙箱的文件浏览与下载（委托产出物在这里）"""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..models import User
from ..security import get_current_user

router = APIRouter(prefix="/files", tags=["files"])
settings = get_settings()

IGNORE = {"AGENTS.md", ".kimi"}


def _sandbox(user: User) -> Path:
    return Path(settings.agent_work_root) / str(user.id) / "sandbox"


@router.get("")
async def list_files(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    root = _sandbox(user)
    if not root.exists():
        return {"files": [], "hint": "文件空间还空着——去委托板钉一张小纸条，产出物会出现在这里"}
    files = []
    for p in sorted(root.rglob("*")):
        if p.is_file() and p.name not in IGNORE and ".kimi" not in p.parts:
            rel = p.relative_to(root)
            files.append({
                "path": str(rel),
                "name": p.name,
                "size": p.stat().st_size,
                "mtime": p.stat().st_mtime,
                "kind": mimetypes.guess_type(p.name)[0] or "file",
            })
    files.sort(key=lambda f: f["mtime"], reverse=True)
    return {"files": files[:200]}


# ---------- 轻 IDE：在线读/写（注意：必须声明在 /{path:path} 下载路由之前） ----------

READ_MAX = 512 * 1024   # 超出只给前 512KB
WRITE_MAX = 1024 * 1024  # 写入上限 1MB


def _resolve_text_target(user: User, path: str) -> Path:
    root = _sandbox(user).resolve()
    target = (root / path).resolve()
    if not str(target).startswith(str(root)) or target.name in IGNORE or ".kimi" in target.parts:
        raise HTTPException(404, "文件不存在")
    return target


@router.get("/read/{path:path}")
async def read_file(path: str, user: User = Depends(get_current_user)):
    target = _resolve_text_target(user, path)
    if not target.is_file():
        raise HTTPException(404, "文件不存在")
    if target.stat().st_size > READ_MAX * 4:
        raise HTTPException(413, "文件太大了，还是下载下来看吧")
    raw = target.read_bytes()[: READ_MAX + 1]
    try:
        content = raw[:READ_MAX].decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(415, "这不是文本文件，直接下载吧") from None
    return {"path": path, "content": content, "truncated": len(raw) > READ_MAX}


class WriteBody(BaseModel):
    content: str = Field(max_length=WRITE_MAX)


@router.put("/write/{path:path}")
async def write_file(path: str, body: WriteBody, user: User = Depends(get_current_user)):
    target = _resolve_text_target(user, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body.content, encoding="utf-8")
    return {"ok": True, "path": path, "size": target.stat().st_size}


@router.get("/{path:path}")
async def download(path: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    root = _sandbox(user).resolve()
    target = (root / path).resolve()
    if not str(target).startswith(str(root)) or not target.is_file() or target.name in IGNORE:
        raise HTTPException(404, "文件不存在")
    return FileResponse(target, filename=target.name)
