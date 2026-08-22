"""任务级词元代理：worker 只拿到一次性代理 URL，真实 Key 永不落盘

仿 cran-code web keyproxy 思路：
- 任务开始时签发 task token → Redis 存真实 Key（20min）
- kimi.toml 里只写 http://127.0.0.1:8010/px/<token>/v1 + 假 key
- 仅放行 POST /chat/completions，任务结束 token 即焚
"""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from ..cache import get_redis
from ..config import get_settings

log = logging.getLogger("crina.px")
settings = get_settings()
router = APIRouter(prefix="/px", tags=["px"])

TOKEN_TTL = 20 * 60


async def issue_token(real_key: str) -> str:
    import secrets
    token = secrets.token_urlsafe(24)
    await get_redis().setex(f"agentkey:{token}", TOKEN_TTL, real_key)
    return token


async def burn_token(token: str):
    await get_redis().delete(f"agentkey:{token}")


@router.post("/{token}/v1/chat/completions")
async def chat_completions(token: str, request: Request):
    real_key = await get_redis().get(f"agentkey:{token}")
    if not real_key:
        return JSONResponse({"error": {"message": "token 无效或已过期"}}, status_code=403)
    body = await request.body()
    client = httpx.AsyncClient(timeout=httpx.Timeout(300, connect=15))
    req = client.build_request(
        "POST",
        f"{settings.tokendance_base_url}/chat/completions",
        content=body,
        headers={
            "Authorization": f"Bearer {real_key}",
            "Content-Type": "application/json",
            "X-Site-URL": settings.site_url,
            "X-Site-Name": "Crina Space Agent",
        },
    )
    resp = await client.send(req, stream=True)

    if resp.status_code >= 400:
        # 上游错误先读体记日志再 relay，否则 400 静默挂起无从排查
        err_body = (await resp.aread())[:500]
        log.warning("tokendance 上游 %s: %s", resp.status_code, err_body.decode("utf-8", "replace"))

        async def err_relay():
            yield err_body
            await resp.aclose()
            await client.aclose()

        return StreamingResponse(
            err_relay(),
            status_code=resp.status_code,
            media_type=resp.headers.get("content-type", "application/json"),
        )

    async def relay():
        try:
            async for chunk in resp.aiter_raw():
                yield chunk
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(
        relay(),
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )
