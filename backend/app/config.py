"""镜听空间 · 后端配置"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # 站点
    site_name: str = "镜听空间"
    site_url: str = "https://here.crina.at"
    api_prefix: str = "/api"
    debug: bool = False

    # 数据库 / 缓存
    database_url: str = "postgresql+asyncpg://postgres@127.0.0.1:5432/crina"
    redis_url: str = "redis://127.0.0.1:6379/10"

    # 安全
    jwt_secret: str = "change-me"
    jwt_expire_days: int = 30
    fernet_key: str = ""  # BYOK/Token 加密（Fernet 32B urlsafe b64）

    # 观猹 OAuth2（凭据只从 .env 读，勿写入源码）
    watcha_client_id: str = ""
    watcha_client_secret: str = ""
    watcha_authorize_url: str = "https://watcha.cn/oauth/authorize"
    watcha_token_url: str = "https://watcha.cn/oauth/api/token"
    watcha_userinfo_url: str = "https://watcha.cn/oauth/api/userinfo"
    watcha_scope: str = "read email"

    # TokenDance（站点兜底额度 + BYOK OAuth）
    tokendance_api_key: str = ""  # 站点词元池
    tokendance_base_url: str = "https://tokendance.space/gateway/v1"
    tokendance_auth_url: str = "https://tokendance.space/auth"
    tokendance_exchange_url: str = "https://tokendance.space/portal/api/v1/auth/keys"
    chat_model: str = "qwen3.8-max"
    # 探讨模式（脑暴/梳理/追问/萃取）的思考强度：low/medium/high/xhigh；闲聊 auto/off 不思考保秒回
    chat_reasoning_effort: str = "xhigh"
    tts_model: str = "minimax-speech-2.8-hd"
    image_model: str = "seedream-5.0-pro"
    video_model: str = "minimax-h3"

    # Google OAuth（可选，连接 Drive/Calendar）
    google_client_id: str = ""
    google_client_secret: str = ""

    # SMTP（邮件提醒，可选）
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    # Agent 干活层
    agent_enabled: bool = True
    agent_max_workers: int = 3
    agent_idle_seconds: int = 600
    agent_work_root: Path = Path("/var/crina/users")
    kimi_bin: str = "/root/.local/bin/kimi"

    # 配额（站点兜底额度下每位用户的每日限额）
    quota_chat_per_day: int = 200
    quota_agent_per_day: int = 5
    quota_tts_per_day: int = 50

    # 站主（镜听）的观猹 user_id，首次登录自动登记
    owner_watcha_id: int = 0


@lru_cache
def get_settings() -> Settings:
    return Settings()
