# AGENTS.md · 镜听空间

## 项目背景
here.crina.at「镜听空间」：Alice 模式的人格化云端伙伴空间，站主镜听（INFJ-T，杭电英语，哲学/语言学/观鸟）为亲友粉丝所建。主角 crina（蓝紫发异色瞳 AI 搭子），居民：安风（INTP-A 狐系学姐，有现实原型）、秋乐凝、弦墨影、团小满、白叙、瓜瓜（吉祥物小猹）。

## 硬约束
- **禁止容器**：全部 systemd 裸机部署。本机 2 核 / 3.8G RAM / 磁盘紧张，新增常驻进程须克制。
- 复用现有基建：PostgreSQL(5432, 库 `crina`，用户 crina)、Redis(6379, db 10)、nginx+certbot。
- **绝不提交**：`.env`、`assets/src_materials/`（含现实原型私密资料：安风生活指北等）、`_docs/`。
- 不动本机其它 nginx 站点与在跑服务。
- 密钥只能存服务端，不进前端代码、不进 agent worker 环境变量。
- DEBUG=false 时 dev-login 完全关闭；DEBUG=true 时也只允许直连后端的请求（无 X-Forwarded-For 头）。

## 后端（backend/）
- Python 3.13 + FastAPI + SQLAlchemy 2 async + asyncpg；uv 管理 venv（`/root/.local/bin/uv`）。
- 入口 `app/main.py`，端口 8010，systemd 单元 `crina-backend`（`journalctl -u crina-backend -f`）。
- **人设** `app/soul/characters.py`：WORLD 世界观 + 每居民 soul_public/soul_private 双层（私有层仅站主会话注入，绝不可外泄）+ MODE_PROMPTS 六探讨模式。改后运行 `.venv/bin/python -m app.seed` 同步。瓜瓜只能输出"呱"。
- **聊天编排** `app/engine/chat.py`：SSE 事件 speaker/delta/done/error；脑暴圆桌=LLM 选 2 位居民+主角收尾；后台任务必须用 `app/bg.py` 的 `fire_and_forget`（防 GC）。
- **记忆管道** `app/engine/memory.py`：热记忆≤12 + 摘要 + 最近 20 轮；抽取 prompt 里 JSON 示例用 `__DIALOGUE__` 占位（别用 .format 会撞花括号）。
- **TokenDance** `app/engine/tokendance.py`：qwen3.8-max（`enable_thinking:false`）、TTS 走 minimax t2a_v2 原生协议（hex 音频）、生图走 ark images/generations（支持 base64 参考图）。HTTP header 禁止中文。
- **主动性引擎** `app/proactive/engine.py`：APScheduler——presence 轮转(20min)、自主发帖(8/12/18/23 点)、早晚问候信、事件提醒(5min)+邮件(aiosmtplib，需 SMTP 配置)。
- **干活层** `app/agentpool/`：spawn `kimi --wire`（wire 协议 1.10：initialize→prompt→ContentPart/ToolCall/ToolResult/TurnEnd→result），每用户沙箱 `/var/crina/users/<uid>/sandbox`，池≤3，单任务 15min，事件落盘 jsonl 回放。集成约定见 cran-code 仓库 `crina` 分支 examples/crina-space/。
- **认证**：观猹 OAuth2（`api/auth.py`，client_id 含 `+` 必须 URL 编码）；BYOK（`api/byok.py`，TokenDance S256 PKCE）；Google 连接（需站主配 GOOGLE_CLIENT_ID/SECRET）。
- **emind 导入** `api/importer.py`：读 eastmind 库（只读授权），按观猹绑定邮箱匹配旧账号。
- 配额：BYOK 用户与站主不限；站点额度按日计数（chat 200/agent 5/tts 50）。

## 前端（frontend/）
- Vite + React 19 + TS + Tailwind 4 + motion + react-router v7；`build.assetsDir='static'`（绕开 /assets/ 冲突）。
- 构建产物 `dist/` 由 nginx 直出；改完 `npm run build` 即生效。
- 页面：门厅(视频氛围 hero+在场状态)/客厅(碎碎念+垃圾堆彩蛋)/私聊间(六模式+SSE+TTS)/委托板(施工时间线)/信箱/档案馆(记忆·日历ICS·沉淀)/设置(BYOK·Google·emind搬家)。
- 设计令牌：crina 蓝紫 #8A8FC4、安风红 #B7423A、秋乐凝 #C99A5B、弦墨影 #3D4A6B、团小满 #E88BA0、白叙 #7A9E8E、瓜瓜 #9BB25F、暖底 #FAF7F2。空状态文案必须温柔。

## 素材（assets/generated/）
全部由 TokenDance 生成：立绘 `<id>_full.webp`、头像 `<id>_avatar.webp`（crina/安风为原型自设）、hall_hero.webp、hall_ambience.mp4（minimax-h3 图生视频）。重新生成跑 `assets/gen_avatars.py`（断点续跑）。nginx `^~ /assets/` 直出。

## 部署
- 后端：`systemctl restart crina-backend`。
- 前端：`cd frontend && npm run build`。
- nginx：改 `deploy/nginx-here.crina.at.conf` → 同步 `/etc/nginx/sites-available/here.crina.at` → `nginx -t && systemctl reload nginx`。**注意 deploy 文件已含 443+证书路径，是配置唯一事实源，不要让 certbot 再改写**（续期会自动，不受影响）。
- 限流：`/api/chat/` 10r/s burst 20。

## 二期新增（2026-08-17 晚）
- **邮箱**：SMTP 已接 ciallo@crina.at（netcup mx1528）。自建邮箱绑定：`/api/settings/email/send-code|verify`（Redis 验证码 10min、1/min 限流）；通知开关 `/api/settings/notify`。
- **小金库与衣橱**：`engine/wardrobe.py` + `/api/space/wardrobe`（fund/wish/show）。装扮 88 镜币、摆件 45；seedream 参考生图（outfit 以 src_materials/avatar.jpg 为参考）；购置后自动换装+客厅炫耀帖；每周日 20:15 余额够就自己逛街（job_shopping）。
- **装修委托**：AgentTask.target='renovate'（仅主人），workdir=frontend/，写完自动 npm run build 上线；AGENTS.md 会写入 frontend/（装修守则）。
- 会话列表带 last_message 预览。

## 待站主配置（配置后功能自动解锁）
1. **观猹生产 client**：目前用文档测试 client（authorize 已通）。正式请到[观猹申请表](https://agentuniverse.feishu.cn/share/base/form/shrcnHJ3ATlNg6ofNHssT2zK7Dh)申请（domain=https://here.crina.at，scope=read email），然后改 `.env` 的 WATCHA_CLIENT_ID/SECRET + OWNER_WATCHA_ID（站主的观猹 user_id，决定谁能看到私有层人设）。
2. **SMTP**：`.env` 配 SMTP_HOST/PORT/USER/PASSWORD → 早晚问候与事件提醒自动发邮件。
3. **Google**：`.env` 配 GOOGLE_CLIENT_ID/SECRET → 设置页出现连接入口；**WPS 365**：待凭证后接入 agentpool 沙箱。

## 测试
- `curl https://here.crina.at/api/health`
- 无头验收：/root/workspace 下有 playwright 可注入 crina_session cookie 截图。
