"""文档处理 API：上传（PDF/DOCX/图片）→ 提取 → 聊天/委托引用 → 导出 docx/pdf"""
from __future__ import annotations

import re
import uuid as _uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..engine import docs as doc_engine
from ..models import Document, User
from ..security import get_current_user, parse_uuid

router = APIRouter(prefix="/docs", tags=["docs"])
settings = get_settings()

UPLOAD_MAX = 10 * 1024 * 1024  # 10MB
KIND_BY_EXT = {
    ".pdf": "pdf", ".docx": "docx",
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image",
}
SAFE_NAME_RE = re.compile(r"[^\w.一-鿿-]+")


def _upload_dir(user: User) -> Path:
    root = Path(settings.agent_work_root) / str(user.id) / "sandbox" / "uploads"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _doc_out(d: Document, preview: bool = True) -> dict:
    out = {"id": str(d.id), "filename": d.filename, "kind": d.kind,
           "chars": d.chars, "created_at": d.created_at.isoformat()}
    if preview:
        out["preview"] = d.text[:100]
    return out


@router.post("/upload")
async def upload(file: UploadFile, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    raw = await file.read(UPLOAD_MAX + 1)
    if len(raw) > UPLOAD_MAX:
        raise HTTPException(413, "文件超过 10MB 啦，拆小一点再传")
    ext = Path(file.filename or "").suffix.lower()
    kind = KIND_BY_EXT.get(ext)
    if not kind:
        raise HTTPException(400, "目前支持 PDF / DOCX / PNG / JPG / WEBP")
    doc_id = _uuid.uuid4()
    safe = SAFE_NAME_RE.sub("_", Path(file.filename or "file").name)[:80]
    rel = f"uploads/{doc_id.hex[:8]}_{safe}"
    target = _upload_dir(user) / f"{doc_id.hex[:8]}_{safe}"
    target.write_bytes(raw)
    # 提取文本（图片走视觉模型；失败不阻塞，允许空文本）
    text = ""
    api_key = settings.tokendance_api_key
    try:
        text = await doc_engine.extract(target, kind, api_key)
    except Exception:
        import logging
        logging.getLogger("crina.docs").exception("文档提取失败 %s", file.filename)
    doc = Document(id=doc_id, user_id=user.id, filename=safe, kind=kind,
                   path=rel, text=text, chars=len(text))
    db.add(doc)
    await db.commit()
    return {**_doc_out(doc), "message": "收到啦，内容已经读出来了" if text else "收到啦（这份没能读出文字，可能是扫描件）"}


@router.get("")
async def list_docs(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Document).where(Document.user_id == user.id)
        .order_by(desc(Document.created_at)).limit(50)
    )).scalars().all()
    return {"docs": [_doc_out(d) for d in rows]}


@router.get("/{doc_id}")
async def get_doc(doc_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, parse_uuid(doc_id))
    if not doc or doc.user_id != user.id:
        raise HTTPException(404, "文档不存在")
    return {**_doc_out(doc, preview=False), "text": doc.text}


@router.delete("/{doc_id}")
async def delete_doc(doc_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, parse_uuid(doc_id))
    if not doc or doc.user_id != user.id:
        raise HTTPException(404, "文档不存在")
    root = Path(settings.agent_work_root) / str(user.id) / "sandbox"
    target = (root / doc.path).resolve()
    if target.is_relative_to(root.resolve()) and target.is_file():
        target.unlink()
    await db.delete(doc)
    await db.commit()
    return {"ok": True}


class ExportBody(BaseModel):
    doc_id: str | None = None
    path: str | None = None  # 沙箱内 md/txt 文件
    format: str = Field(pattern="^(docx|pdf)$")
    title: str = Field(default="", max_length=60)


@router.post("/export")
async def export(body: ExportBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """把文档/沙箱文本导出为 docx 或 pdf"""
    text = ""
    title = body.title or "导出文档"
    if body.doc_id:
        doc = await db.get(Document, parse_uuid(body.doc_id))
        if not doc or doc.user_id != user.id:
            raise HTTPException(404, "文档不存在")
        text, title = doc.text, body.title or doc.filename.rsplit(".", 1)[0]
    elif body.path:
        root = (Path(settings.agent_work_root) / str(user.id) / "sandbox").resolve()
        target = (root / body.path).resolve()
        if not target.is_relative_to(root) or not target.is_file() or target.suffix.lower() not in (".md", ".markdown", ".txt"):
            raise HTTPException(404, "只能导出沙箱里的 md/txt 文件")
        if target.stat().st_size > 1024 * 1024:
            raise HTTPException(413, "文件太大了")
        text = target.read_text(encoding="utf-8", errors="replace")
        title = body.title or target.stem
    else:
        raise HTTPException(400, "给 doc_id 或 path 其中一个")
    if not text.strip():
        raise HTTPException(400, "内容是空的，没什么好导出的")
    if body.format == "docx":
        import asyncio
        data = await asyncio.to_thread(doc_engine.make_docx, text, title)
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        fname = f"{title}.docx"
    else:
        import asyncio
        data = await asyncio.to_thread(doc_engine.make_pdf, text, title)
        mime = "application/pdf"
        fname = f"{title}.pdf"
    from urllib.parse import quote
    return Response(content=data, media_type=mime,
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}"})


async def load_doc_context(db: AsyncSession, user: User, doc_ids: list[str], per_doc: int = 3000) -> str:
    """聊天/委托引用：把所选文档的提取文本拼成上下文块"""
    if not doc_ids:
        return ""
    uids = [_uuid.UUID(i) for i in doc_ids[:3]]  # 最多带 3 份
    rows = (await db.execute(select(Document).where(
        Document.id.in_(uids), Document.user_id == user.id))).scalars().all()
    parts = [f"《{d.filename}》：\n{d.text[:per_doc]}" for d in rows if d.text]
    if not parts:
        return ""
    return ("\n\n（附带材料——回答问题优先依据这些材料；"
            "转述材料内容时必须严格忠于原文，拿不准就照原文引用，绝不添油加醋）\n"
            + "\n\n".join(parts))
