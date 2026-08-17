"""镜听空间 · FastAPI 入口"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .agentpool import proxy as agent_proxy
from .api import agent, auth, byok, chat, importer, letters, posts, settings_extra, space, wardrobe
from .config import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .proactive.engine import start_scheduler, stop_scheduler
    start_scheduler()
    yield
    stop_scheduler()
    # 释放连接
    from .cache import get_redis
    from .db import engine
    try:
        await get_redis().aclose()
    except Exception:
        pass
    await engine.dispose()


app = FastAPI(title="镜听空间", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.site_url, "http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(chat.router, prefix=settings.api_prefix)
app.include_router(space.router, prefix=settings.api_prefix)
app.include_router(posts.router, prefix=settings.api_prefix)
app.include_router(letters.router, prefix=settings.api_prefix)
app.include_router(byok.router, prefix=settings.api_prefix)
app.include_router(agent.router, prefix=settings.api_prefix)
app.include_router(importer.router, prefix=settings.api_prefix)
app.include_router(settings_extra.router, prefix=settings.api_prefix)
app.include_router(wardrobe.router, prefix=settings.api_prefix)
app.include_router(agent_proxy.router)  # /px/<token>/v1/... 任务级词元代理


@app.get("/api/health")
async def health():
    return {"ok": True, "site": settings.site_name}
