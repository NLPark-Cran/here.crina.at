# AGENTS.md · 镜听空间

## 项目背景
here.crina.at「镜听空间」：Alice 模式的人格化云端伙伴空间。站主 Cran（镜听，INFJ-T，杭电英语，哲学/语言学/观鸟，观猹 ID 10036145）。主角 crina（蓝紫发异色瞳 AI 搭子），居民：安风（INTP-A 狐系学姐，有现实原型）、镜昕（ENFJ，安风 QQ 时代的机器人出身，「镜听」之名借自她）、秋乐凝、弦墨影、团小满、白叙、瓜瓜（吉祥物小猹，只说呱）。

## 硬约束（不可违反）
- **禁止容器**：全部 systemd 裸机。本机 2 核 / 3.8G RAM / 磁盘紧张，新增常驻进程须克制。
- 复用现有基建：PostgreSQL(5432, 库 `crina` 用户 crina)、Redis(6379, db 10)、nginx+certbot。
- **绝不提交**：`.env`、`assets/src_materials/`（安风生活指北等私密资料）、`_docs/`。
- 不动本机其它 nginx 站点与在跑服务；不让 certbot 改写我们的站点配置（deploy/ 是唯一事实源，续期自动）。
- 密钥只存服务端；**agent worker 的 kimi.toml 只允许写任务级代理 URL**（/px/<token>，20min 一次性），真实 Key 永不落盘、不进 worker 环境变量。
- 公域内容（客厅/门厅）全年龄安全；私聊柔性表达但不出格；瓜瓜只能输出"呱"。
- 后台异步任务一律 `app/bg.py` 的 `fire_and_forget`（裸 create_task 会被 GC）。
- DEBUG=false 时 dev-login 完全关闭；开启时也只允许无 X-Forwarded-For 的直连请求。

## 三期新增（2026-08-18 凌晨）
- **立绘 v2**：crina/安风/弦墨影 透明底立绘（RGBA webp）。透明底技巧：seedream `background:"transparent"` 需输入图已含透明像素——先给底图加 20px 透明边框再 i2i。脚本 `assets/gen_v2.py`。
- **弦墨影**：高个中性风妹妹（比秋乐凝高），不是男生。安风形象以 `src_materials/安风自设新图.png`（渐变发尾+左绿右蓝异色瞳+三角面纹）为准，头像用官方透明底常服。
- **特别的朋友** `soul/characters.py: SPECIAL_FRIENDS`：pinusandy@163.com（安风原型本尊）登录直升老友；build_context 注入本尊到访情境（仅对应角色可见）。
- **会话文件夹**：Conversation.folder（''=未分组 / 'emind'=旧家导入），导入器自动归档，前端侧栏折叠组。
- **文件空间** `api/files.py`：用户沙箱文件列表/下载（路径穿越已防护，AGENTS.md/.kimi 不暴露）。
- **模块拆分**：原 letters.py 拆为 letters（信箱）/events（日历ICS）/archive（记忆+wiki）/files。
- Alice 更新日志在 `_docs/` 作产品参考。

## 后端（backend/）
- Python 3.13 + FastAPI 0.141 + SQLAlchemy 2 async + asyncpg；uv venv（`/root/.local/bin/uv`）。
- 入口 `app/main.py`，端口 8010，systemd `crina-backend`（`journalctl -u crina-backend -f`）。
- **人设** `app/soul/characters.py`：WORLD + soul_public/private 双层 + MODE_PROMPTS。改后 `.venv/bin/python -m app.seed`。SOUL 前缀在 `engine/memory.py` 有缓存（_SOUL_CACHE），seed 后需重启进程生效。
- **聊天** `engine/chat.py`：SSE 事件 speaker/delta/done/error；脑暴=LLM 选 2 居民+主角收尾；配额 PG 原子 upsert（ON CONFLICT returning）。
- **记忆** `engine/memory.py`：抽取 prompt 用 `__DIALOGUE__` 占位（.format 会撞 JSON 花括号）。
- **TokenDance** `engine/tokendance.py`：qwen3.8-max（enable_thinking:false）、TTS=minimax t2a_v2（hex 音频）、生图=ark images/generations（base64 参考图）。HTTP header 禁止中文。
- **主动性** `proactive/engine.py`：presence 20min、自主发帖 8/12/18/23 点、早晚安 8:10/22:40、提醒 5min（events.reminded 有索引，只看 2 天内）、周日 20:15 逛街。
- **干活层** `agentpool/`：wire 协议（initialize→prompt→ContentPart/ToolCall/ToolResult/TurnEnd→result）；沙箱 `/var/crina/users/<uid>/sandbox`；renovate 委托（仅主人）workdir=frontend/，人格写 frontend/.kimi/AGENTS.md（不覆盖项目 AGENTS.md），完成自动 npm run build；`proxy.py` 任务级词元代理；`_live` 订阅表 done 补发 closed + 5min GC。
- **emind 导入** `api/importer.py`：只读 eastmind 库，邮箱匹配，title 前缀幂等 + 30min 冷却。
- **衣橱** `engine/wardrobe.py`：先扣款（负流水+余额校验回滚）防双花，生图失败自动退款；图片存 webp ≤900px。
- 对外错误信息统一温柔文案，异常细节只进日志。
- naive datetime 入口一律按 CST（+8）解释（CreateEvent.model_post_init 已处理）。

## 前端（frontend/）
- Vite + React 19 + TS + Tailwind 4（@tailwindcss/vite）+ motion + react-router v7；`build.assetsDir='static'`（绕开 /assets/ 冲突）。
- 页面级 React.lazy 拆包；构建 `npm run build` 即上线。
- SSE 读取统一 `readSseStream`（client.ts，兼容 \r\n）；输入框 Enter 必须判 `!e.nativeEvent.isComposing`；toast 计时器放 useEffect。
- 页面：门厅(视频 hero/在场/衣橱小金库)/客厅(碎碎念+垃圾堆+图片灯箱)/私聊间(三段式+探讨下拉)/委托板(施工时间线+装修开关)/信箱/档案馆(记忆·日历ICS·沉淀)/设置(BYOK·邮箱绑定·emind搬家)。
- 设计令牌：crina 蓝紫 #8A8FC4、安风红 #B7423A、秋乐凝 #C99A5B、弦墨影 #3D4A6B、团小满 #E88BA0、白叙 #7A9E8E、瓜瓜 #9BB25F、暖底 #FAF7F2。空态文案必须温柔。

## 素材（assets/generated/）
webp 优先（立绘 `<id>_full.webp`、头像 `<id>_avatar.webp`、衣橱 wardrobe_*.webp、hall_hero.webp、hall_ambience.mp4）。重跑 `assets/gen_avatars.py`（断点续）。nginx `^~ /assets/` 直出，30d 缓存。

## 部署
- 后端：`systemctl restart crina-backend`（SOUL/人设改动必须重启，缓存原因）。
- 前端：`cd frontend && npm run build`。
- nginx：改 `deploy/nginx-here.crina.at.conf` → cp 到 `/etc/nginx/sites-available/here.crina.at` → `nginx -t && systemctl reload nginx`。
- 限流：`/api/chat/` 10r/s burst 20。

## 待站主配置（.env，配好自动解锁）
1. **Google**：GOOGLE_CLIENT_ID/SECRET（GCP OAuth client，redirect=`https://here.crina.at/api/byok/google/callback`，scope drive.file+calendar）
2. **WPS 365**：凭证到手后接入 agentpool 沙箱（wps365-open/cli）
3. 已配：观猹生产 client + OWNER_WATCHA_ID=10036145、TokenDance、SMTP(ciallo@crina.at)

## 验收
- `curl https://here.crina.at/api/health`
- 无头截图：/root/workspace 有 playwright（node_modules 在 /root/workspace/node_modules），注入 crina_session cookie（domain here.crina.at, secure）即可模拟登录态。
