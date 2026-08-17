"""文件空间：每用户沙箱的文件浏览与下载（委托产出物在这里）"""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
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


@router.get("/{path:path}")
async def download(path: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    root = _sandbox(user).resolve()
    target = (root / path).resolve()
    if not str(target).startswith(str(root)) or not target.is_file() or target.name in IGNORE:
        raise HTTPException(404, "文件不存在")
    return FileResponse(target, filename=target.name)
