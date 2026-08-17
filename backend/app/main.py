"""镜听空间 · FastAPI 入口"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import agent, auth, byok, chat, letters, posts, space
from .config import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .proactive.engine import start_scheduler, stop_scheduler
    start_scheduler()
    yield
    stop_scheduler()


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


@app.get("/api/health")
async def health():
    return {"ok": True, "site": settings.site_name}
