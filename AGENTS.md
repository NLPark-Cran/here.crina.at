# AGENTS.md · 镜听空间

## 项目背景
here.crina.at「镜听空间」：Alice 模式的人格化云端伙伴空间，站主镜听（INFJ-T，杭电英语，哲学/语言学/观鸟）为亲友粉丝所建。主角 crina（蓝紫发异色瞳 AI 搭子），另有居民安风/秋乐凝/弦墨影/团小满/白叙/瓜瓜。

## 硬约束
- **禁止容器**：全部 systemd 裸机部署。本机 2 核 / 3.8G RAM / 磁盘紧张，新增常驻进程须克制。
- 复用现有基建：PostgreSQL(5432, 库 `crina`，用户 crina)、Redis(6379, db 10)、nginx+certbot。
- **绝不提交**：`.env`、`assets/src_materials/`（含现实原型私密资料）、`_docs/`。
- 不动本机其它 22 个 nginx 站点与在跑服务。
- 密钥只能存服务端，不进前端代码、不进 agent worker 环境变量。

## 后端（backend/）
- Python 3.13 + FastAPI + SQLAlchemy 2 async + asyncpg；uv 管理 venv（`/root/.local/bin/uv`）。
- 入口 `app/main.py`，端口 8010，systemd 单元 `crina-backend`。
- 人设全部在 `app/soul/characters.py`（WORLD 世界观 + 每居民 soul_public/soul_private 双层）。私有层仅站主会话注入，改人设后运行 `.venv/bin/python -m app.seed` 同步。
- 聊天编排 `app/engine/chat.py`（SSE：speaker/delta/done/error 事件）；记忆管道 `app/engine/memory.py`（热记忆≤12 + 摘要 + 最近 20 轮）。
- TokenDance 客户端 `app/engine/tokendance.py`：qwen3.8-max 聊天（`enable_thinking:false` 防出戏）、minimax-speech TTS、seedream 生图。
- 配额：BYOK（oauth_accounts.provider='tokendance'）用户不限；站点额度按日计数（usage_counters）。

## 前端（frontend/）
- Vite + React 19 + TS + Tailwind 4；构建产物 `dist/` 由 nginx 直出，`/api` 反代 8010（SSE 关缓冲）。
- 页面：门厅/客厅/私聊间/委托板/信箱/档案馆/设置。
- 设计令牌：crina 蓝紫 #8A8FC4、安风红 #B7423A、秋乐凝 #C99A5B、弦墨影 #3D4A6B、团小满 #E88BA0、白叙 #7A9E8E、瓜瓜 #9BB25F。暖底 #FAF7F2。

## 部署
- 改后端：`systemctl restart crina-backend`，日志 `journalctl -u crina-backend -f`。
- 改前端：`npm run build` 后 nginx 直出，无需重启。
- nginx 配置源文件在 `deploy/nginx-here.crina.at.conf`，改动同步到 `/etc/nginx/sites-available/here.crina.at` 后 `nginx -t && systemctl reload nginx`。

## 测试
- 健康检查：`curl https://here.crina.at/api/health`。
- DEBUG=true 时可用 `GET /api/auth/dev-login?nickname=xxx` 铸造测试会话（仅调试用，生产必须 DEBUG=false）。
