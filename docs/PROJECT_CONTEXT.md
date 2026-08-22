# 项目上下文 · 镜听空间（/compact 记忆恢复锚点）

> 最后更新：2026-08-18。读我即可恢复全部工程上下文。配合 AGENTS.md（硬约束）与 docs/CONVENTIONS.md（规范）使用。

## 1. 这是什么

here.crina.at「镜听空间」：Alice 模式人格化云端伙伴空间 + 站主个人博客/主站。
站主：**Cran（镜听）**，观猹 ID **10036145**，`users.is_owner=true`，收信邮箱 crina@tt2.li。
居民（`characters` 表）：crina(主角/唯一会干活)、anfeng(安风,INTP-A,狐系学姐,原型本尊 pinusandy@163.com)、qiulening、xianmoying(高个中性风妹妹)、tuanxiaoman、baixu、guagua(只说呱)。
派派凫 = 安风本尊的站内账号（已注册）。

## 2. 部署拓扑

```
公网 → nginx :443 (here.crina.at, Let's Encrypt, /etc/nginx/sites-available/here.crina.at)
  ├─ /                → frontend/dist（vite 构建，assetsDir='static'！）
  ├─ /assets/         → alias assets/generated/（^~ 优先于静态正则，30d 缓存）
  ├─ /api/chat/       → 127.0.0.1:8010（limit_req 10r/s burst 20，SSE 关缓冲）
  └─ /api/ /ws /px/   → 127.0.0.1:8010
backend: systemd crina-backend（uvicorn 单进程，/root/workspace/test0607/here.crina.at/backend）
数据: PostgreSQL 库 crina（用户 crina 密码在 backend/.env）+ Redis db 10
Agent 沙箱: /var/crina/users/<uid>/sandbox（+ kimi.toml 代理配置 + tasks/*.jsonl 事件日志）
项目根: /root/workspace/test0607/here.crina.at（git: NLPark-Cran/here.crina.at）
 cran-code 仓库: /root/workspace/crys（crina 分支有 examples/crina-space 集成约定）
```

## 3. API 全清单（55 端点，前缀 /api）

**auth**：GET auth/watcha/login → 302 观猹授权（S256 PKCE，state+verifier 存 Redis 10min）；GET auth/watcha/callback → 换 token+userinfo，upsert 用户，Set-Cookie `crina_session`（JWT 30 天 httponly）；POST auth/logout；GET auth/me | auth/me/optional；GET auth/dev-login（DEBUG 且直连才可用）
**chat**：POST chat/conversations {character_id,mode}；GET chat/conversations（含 last_message、folder）；GET/PATCH/DELETE chat/conversations/{id}（PATCH 改 mode：auto/brainstorm/guide/probe/extract/off）；POST chat/conversations/{id}/messages {content} → **SSE**：`data: {type:speaker|delta|done|error}`（脑暴多 speaker）；POST chat/tts {text,character_id} → audio/mpeg（Redis 缓存 7d）
**posts**：GET posts?limit（含 replies，author 已解析）；POST posts {content,image_url?}（70% 概率居民回帖）；POST posts/{id}/replies
**space**：GET space/characters | space/presence（Redis，20min 轮转）；POST space/garbage（垃圾堆彩蛋，免登录）；GET space/wardrobe；POST space/wardrobe/fund {amount≤200}；POST space/wardrobe/wish {kind:outfit|decor,hint}（仅站主，异步生图）
**letters**：GET letters；POST letters {character_id,content}（异步回信）；POST letters/{id}/read
**events**：GET/POST/DELETE events（naive 时间按 CST+8）；GET events/ics-url（JWT 订阅链接）；GET events.ics?token=
**archive**：GET memories / DELETE memories/{id}；GET wiki（未登录仅 public）；POST wiki/extract {conversation_id,public}
**agent（委托板）**：POST agent/tasks {title,prompt,target:sandbox|renovate(仅主人)}；GET agent/tasks[/{id}]；POST agent/tasks/{id}/cancel（仅 queued）；GET agent/tasks/{id}/stream → SSE（回放 jsonl+实时广播；事件：started/text/tool_start/tool_end/finished/error/closed/eof/ping）
**files**：GET files（沙箱文件列表）；GET files/{path}（下载，防穿越）；GET files/read/{path}（文本读取≤512KB）；PUT files/write/{path}（写入≤1MB）——read/write 必须声明在下载通配路由之前
**byok**：GET byok/status；GET byok/connect → TokenDance OAuth(S256) → GET byok/callback（存加密 api_key）；DELETE byok；Google 同构（byok/google/*，需 GOOGLE_CLIENT_ID）
**settings**：POST settings/email/send-code|verify（6 位码 10min，错 5 次作废）；POST settings/notify {notify_email}；POST settings/timezone {timezone}（IANA 名，zoneinfo 校验）
**importer**：GET import/emind/status；POST import/emind（邮箱匹配 eastmind 库，title 前缀幂等+30min 冷却）
**px**：POST px/{token}/v1/chat/completions（任务级词元代理，仅此处放行）

## 4. DB schema（15 表，PG 库 crina）

users(id,watcha_user_id uniq,nickname,avatar_url,email,is_owner,relation_tier 陌生/熟人/老友,notify_email,timezone 默认Asia/Shanghai,affinity 熟悉度(聊天+2/写信+5/发帖+1,30升熟人/120升老友,只升不降),ics_token 日历订阅只读token,last_seen_at)
oauth_accounts(user_id+provider uniq, payload_enc Fernet 加密 JSON, scopes)
characters(id slug 主键,name,tagline,mbti,color,avatar_url,soul_public,soul_private,voice_id,is_agent,active)
conversations(id,user_id,character_id,mode,folder(''/'emind'),title,summary) ← messages(conversation_id,role user/character/narrator,character_id,kind,content) append-only
memories(user_id,character_id,kind fact/preference/summary,content,salience 1-10,evidence 原文证据)
posts / post_replies（author_type user|character + author_id 字符串）
events(user_id,title,start_at tz,remind_minutes,reminded 有索引,source)
letters(user_id,character_id,kind morning/night/reply/reminder/greeting/holiday,read,emailed)
wiki_pages(user_id nullable,title,content,mode,public)
agent_tasks(user_id,title,prompt,status queued/running/done/failed/cancelled,target sandbox/renovate,result_summary)
wardrobe_items(kind outfit/decor,image_url,cost,wearing) / purse_ledger(delta,reason) 余额=sum(delta)
usage_counters(user_id+day+kind uniq, count) 配额原子计数

## 5. 外部依赖契约

- **TokenDance**（base https://tokendance.space/gateway，header `Authorization: Bearer`，**禁中文 header**）：
  - 聊天 `POST /v1/chat/completions` model=qwen3.8-max（reasoning 模型，`enable_thinking:false` 防出戏；stream SSE）
  - TTS `POST /minimax/v1/t2a_v2` model=minimax-speech-2.8-hd → `data.audio` 是 **hex**；voice_id：crina=female-shaonv、anfeng=female-yujie、qiulening/tuanxiaoman=female-tianmei、xianmoying=female-chengshu、baixu=male-qn-jingying
  - 生图 `POST /ark/v3/images/generations` model=seedream-5.0-pro；参考图用 data:image base64；**透明底**：`background:"transparent"` 需输入图已有透明像素（先加 20px 透明边框）
  - 视频 `POST /minimax/v2/video_generation` model=minimax-h3（768P/2K，无 1080P；首帧图生视频；轮询 /v2/query/video_generation/<task>）
  - BYOK OAuth：`/auth?callback_url&code_challenge(S256)&app_url&key_name` → 换 key `POST /portal/api/v1/auth/keys`
- **观猹 OAuth**：authorize `https://watcha.cn/oauth/authorize`；token `POST /oauth/api/token`（form）；userinfo `GET /oauth/api/userinfo?access_token=`；生产 client 已配（.env）；client_id 含特殊字符必须 URL 编码
- **SMTP**：ciallo@crina.at @ mx1528.netcup.net:465 SSL（aiosmtplib use_tls）——发件显示名待改 `crina <ciallo@crina.at>`（R1）
- **cran-code wire**：spawn `/root/.local/bin/kimi --wire -w <dir> --config-file <toml>`（yolo 在 toml 里 default_yolo=true）；JSON-RPC：initialize(protocol_version 1.10)→prompt→事件(ContentPart.text delta/ToolCall/ToolResult/StatusUpdate/TurnEnd)→result；config provider type=openai_legacy
- **emind**：eastmind 库只读（crina 有 SELECT）；users.email 匹配，memories/conversations/messages 搬迁

## 6. 已知怪癖与踩坑（重要！）

- SOUL 前缀有进程内缓存（memory.py _SOUL_CACHE）→ 改人设后 seed + **重启后端**
- FastAPI 0.141 路由是 _IncludedRouter 懒挂载（遍历 app.routes 看不到子路由）
- vite `build.assetsDir='static'`（/assets/ 被立绘占用）
- Python `hash()` 进程随机 → 需要稳定 ID 用 md5
- EXTRACT_PROMPT 用 `__EXISTING__`/`__DIALOGUE__` 占位（.format 撞花括号）
- 观猹 email/phone 可能缺失，代码必须容忍
- 本机 2 核 3.8G：agent worker 池 ≤3，单任务 15min 超时；npm build 约 1-2min
- dev-login 仅 DEBUG=true 且请求无 X-Forwarded-For（即直连 :8010）时可用

## 7. 站主偏好（Q&A 结论）

书桌干活：常驻按钮+智能提议卡片都要 / 小屋：剖面地图+房间氛围角（混合生成策略）/ 视觉：纸感 2.0+局部玻璃拟态 / 记忆：mem0 式+大扫除+晚安信汇报 / 邮件 From：`crina <ciallo@crina.at>` / IDE：查看+编辑+续改 / 博客：人人有房（/@昵称），镜听房间=长文+观鸟笔记+crina日报+收藏摘抄 / 写作：手写+crina 代整理 / 客厅：点赞+emoji反应+收藏 / GitHub commit 邮箱用 noreply

## 8. 当前状态矩阵

✅ 上线：观猹登录/聊天六模式/脑暴圆桌/记忆管道(新 ops 机制)/碎碎念+居民接话/垃圾堆/信箱/日历ICS/委托板/文件空间(读)/BYOK/emind导入/衣橱小金库/早晚安+提醒+邮件/门厅沉浸 hero/衣柜透明立绘
🚧 进行中：记忆大扫除/晚安信记忆汇报/邮件 From 显示名（R1 未完）
✅ R1 记忆系统（ops+evidence、大扫除、晚安信汇报新记忆、发件人显示名）+ 用户时区（问候信/提醒按用户当地时间触发：greet_tick 每小时轮询各时区 8 点/22 点）
✅ R2 streamdown 2.5 渲染（components/Markdown.tsx 统一封装；plugins code/math/cjk；聊天气泡/档案馆/信箱/委托汇报全接入；katex.min.css + index.css @source 指令 + shadcn 变量映射暖纸色；shiki/mermaid 按需 chunk；MarkdownLite 已删除）
✅ R3 书桌工作台：聊天常驻「去书桌」按钮（带当前输入/最近一句→/board?draft= 预填小纸条）+ 干活意图启发式提议卡（WORK_HINTS 关键词→流式完成后弹「钉到委托板」卡片，可忽略）+ 轻IDE（文件空间打开文本文件：md 用 streamdown 渲染/代码等宽，编辑保存 PUT /files/write，「让 crina 接着改」预填委托）
✅ R3.5 独响启发：状态墙（characters.status_text 2-6字，job_status 每30min检查、按居民 4-10h 错开 LLM 换新，门厅卡片 chip 展示）/ 关系数值（users.affinity + engine/affinity.py，自动升 tier）/ 串门事件（job_visit 每天10/15/20点，posts.kind=visit 虚线卡）/ 专注模式（Chat 头部「一起专注」25min 番茄钟浮窗，前端仪式）
✅ 二轮深度审查修复：worker 降权（crinawork 用户跑 sandbox 委托，kimi 复制到 /opt/kimi-cli + /usr/local/bin/kimi，HOME 指向沙箱；renovate 仍服务身份）/ 衣橱 pg_advisory_xact_lock 防双花+异常退款+bg.py 异常进日志 / config 移除硬编码观猹 secret / 生成失败不再透出上游细节 / files 三端点统一 is_relative_to+.kimi 拦截 / ICS 独立只读 token（可重置）/ messages.seq BIGSERIAL IDENTITY 排序列 / 会话 updated_at 随消息触碰 / 消息取最新N条再反转 / letters(10/日) posts(30/日) replies(60/日) extract(5/日) Redis 限流(cache.rate_limit) / posts.image_url 仅 /assets/ / 委托先验资格再扣配额 / TTS 成功才计配额 / 施工流先订阅再回放+事件序号 n 去重 / importer engine 模块级单例 / 设置页假开关移除 / Chat pendingFirst 被挡自动补发 / Board 合上复位可重连
✅ R4 小屋剖面地图：house_section.webp（seedream 剖面图）+ 6 张 corner_*.webp 氛围角（门厅/客厅/书房 i2i 保连续，委托板/信箱/档案馆独立风格；backend/scripts/gen_house_map.py 可 --only 重生成）；components/HouseMap.tsx 热点导航（坐标按图校准，改图需同步改）+ 悬停氛围角预览 + 走动过渡动画（crina 头像穿过屏幕 780ms 后 navigate）；门厅 Home 新增「小屋地图」区块
✅ R5 设计系统 2.0：feed 页 max-w-2xl→3xl、Settings→2xl（桌面利用率）；hero 遮罩减淡（cream/45→15、左 scrim 85→60）；衣橱「今天穿的」object-contain max-h-96 完整显示；小金库数字 text-3xl→2xl；浮层玻璃拟态统一（Toast/ModeDropdown/提议卡/专注浮窗 bg-paper/85+backdrop-blur-md）
✅ R6 文档处理：documents 表 + POST /api/docs/upload（PDF mutool/DOCX python-docx/图片 qwen3.7-plus 视觉转写（3.8-max 也会看但贵，降本），≤10MB，提取≤2万字）+ list/detail/delete + POST /api/docs/export（md→docx python-docx / md→pdf reportlab CID 字体 STSong-Light，OTC CFF 字体 reportlab 不支持是坑）+ 聊天📎引用（SendMessage.doc_ids→load_doc_context 拼进当轮上下文，材料铁律 prompt 防臆想）+ 委托引用（CreateTask.doc_ids 拼进 prompt）；Board 新增「我的文档」区块、轻IDE 导出 docx/pdf 按钮
✅ 思考强度：探讨模式（brainstorm/guide/probe/extract）传 reasoning_effort=xhigh（config.chat_reasoning_effort，实测支持 low/high/xhigh）；auto/off 闲聊不传保秒回活人感
✅ 记忆语义检索：memories.embedding 列（Text/JSON，qwen-text-embedding-v4 1024 维，tokendance.embed 内部分块——上游单批限 10 条）；热记忆混合召回：salience 候选池 60 条 → 余弦相似度+0.15*(salience/10) 重排取 top12（无向量退化纯重要性）；抽取 add/update 时写向量，存量随聊天增量回填（每次≤30 条，首次已一次性回填 38 条）
✅ R7 博客与房间：articles/post_reactions/post_favorites 三表 + users.handle（默认观猹ID，设置页可改 3-32 位 slug）；api/articles.py（public 游标流/mine/CRUD/compose 整理成文草稿不落库，限流 article 10 compose 10）+ api/rooms.py（/@handle 免登录房间）；posts 扩展（reaction toggle 白名单 ❤️🍉🦉😂🤔 限 120/日、favorite toggle、/favorites、timeline 带 reactions/my_reactions/favorited、瓜瓜 20% 延迟 30-120s 丢🍉）；job_daily_report 每晚 21 点 crina 代笔小屋日报（kind=daily public，当天幂等）；前端 /@handle（React Router 不支持段内前缀+动态参数，走 * 兜底 StarRoute 自己解析）、/p/:id、/write(/:id) 编辑器（模板含观鸟笔记+整理成文）、Parlor 反应条+收藏+日报卡、Archive 加「我的文章」「收藏」tab、Settings 门牌卡。坑：updated_at 有 onupdate 时 commit 后属性过期，必须先序列化再 commit（MissingGreenlet）
✅ R8.2 蛐蛐：build_context(aside=True) 注入性格句式「你有内心独白的习惯」（正文后 <aside> 20字内）；SendMessage.no_aside 链路 stream_reply→_stream_character→build_context；Chat 气泡 splitAside（流式藏未闭合标签）+ AsideLine 小字斜体渲染 + TTS 只读正文；设置页「居民的小声嘀咕」开关存 localStorage crina_aside_enabled
✅ R8.4 世界观密度：docs/soul/ 7 居民设定集（唯一真相源，README 约定八节结构）+ soul_public 编译产物加反应模板×4+作息（瓜瓜除外）+ WORLD 加小屋格局（三层小屋/阳台瓜田/镜听卧室在二楼）+ 弦墨影私有层补妹妹身份；改人格先改 docs/soul/ 再同步 characters.py 并重 seed
✅ R8.1 DayPlan：day_plans 表（events JSON 结构体 slot/kind/location/activity/mood/note，character+date 唯一）+ engine/dayplan.py（凌晨 04:30 job_dayplan 批量生成/昨天剧本作连续性输入/失败按作息兜底/启动补跑幂等）+ wttr.in 杭州天气（Redis 6h，全空间一致）+ 六出口共享状态（状态墙/串门/autopost/日报取材当前事件，私聊注入「你此刻正在…」）+ prompt 防跨居民安排行动
✅ R8.3 情感日记：diaries 表（无用户可见 API，AI 的隐私）+ engine/diary.py（聊后守门员 worth 二元判断+事件直写：塞零花钱/买衣物+DayPlan 开头心情）+ job_mood_digest 13:40/21:40 汇总近3天日记→characters.mood_note 注入私聊（叙事化，不数值展示）
✅ R8 卧室：corner_bedroom.webp（i2i 保连续）+ HouseMap 卧室热点（右上窗帘角 x88 y16）+ /bedroom 页（月光 hero+时间感知文案+crina 在场状态+说晚安→crina 私聊）
✅ 安风反馈四项修复（ceff0a8）：presence 接 DayPlan（job_presence 按当前剧本事件 LLM 浓缩+活动级缓存，随机池仅兜底，消灭「门厅打盹」瞬移；crina 池「门厅」→「房间」）/ 亲密度分档（build_context 按 relation_tier 注入亲昵度指引：老友可撒娇贴贴、熟人自在开玩笑）/ crina_full.webp 加 ?v=2 破 nginx 30d 强缓存（文件本透明底，旧缓存致白底）/ 加载文案「搬椅子上楼」→「推门进去中」
✅ 二轮反馈批：HouseMap 同路由点击卡死（go() 已在目标房间时滚顶+遮罩 1.2s 兜底复位）/ 专注浮窗 mobile 被底栏遮挡（bottom-20 md:bottom-5 z-50）+时间加大+接 presence 显示「ta 此刻在做什么」/ 弦墨影 voice male-qn-qingse→female-chengshu（实测音色列表后选定）/ 安风查岗复读（SPECIAL_FRIENDS 改 list 结构+软化人设「很熟了别复读梗」，docs/soul/anfeng.md 同步）/ 委托停滞看门狗（STALL_TIMEOUT_S=180s 无 wire 消息即收工，原干等 900s）+proxy ≥400 读体记日志+worker stderr 落 tasks/<id>.stderr.log / gen_v2 to_transparent 补透明边框技巧（seedream transparent 需输入含透明像素，曾 400）/ 安风立绘重生成（prompt 去「肩上挂着观鸟望远镜」+「严格以参考图为准」前缀，i2i 无 strength 参数文本是唯一杆）
✅ 镜昕入住（第 8 位居民，全量）：docs/soul/jingxin.md 设定集+characters.py（jingxin，ENFJ #4E7E5B，安风 QQ 机器人出身，「镜听」站名借自她；SPECIAL_FRIENDS 加饲养员本尊识别）+立绘/头像（gen_v2 i2i 自设图，头像从全身像裁头部）+voice_id=audiobook_female_1（DB 手改，seed 不写 voice）+接入点：AUTOPOST_SCHEDULE/REPLY_CANDIDATES/BRAINSTORM_CANDIDATES/DEFAULT_STATUS/WORLD 阁楼机房小间；DayPlan/状态墙/presence/diary 自动含新居民（读 Character.active）
✅ 私聊一键全屏（Chat zen 状态 fixed inset-0 z-60）+小屋指南页 /guide（关系升温/衣橱小金库/委托板/信箱/档案馆/专注/卧室八节，首页 hero 入口）+私聊 prompt 注入玩法小抄 GUIDE_NOTE（被问起才带出）+设置页观猹账号卡加「头像昵称在 watcha.cn 改」
✅ R9 记忆系统：守门员二元预判（chat_once max_tokens=5 temp=0 判有/没有，没有直接返回只回填向量）→ 候选抽取（CANDIDATE_PROMPT，角色回复仅语境标注）→ 主客体代码级过滤（evidence 必须在用户原话里子串匹配，否则整条丢弃）→ 恒定成本写入（精确匹配零成本 skip / embed 召回 top5 相似阈值 0.55 / 无相似直接 create 不调 LLM / LLM 四选一 create/merge/conflict(旧条 kind=archived+salience=0+unlink)/skip，故障降级 create 写入永不丢）；links 关联图（memories.links Text JSON，create 时 LLM 标注双向互写，_recall 两跳：一跳混合排序 top8→沿 links 各扩 1 条标 _via「由…想起」补足 top12，unlink_memory 删除/归档防孤儿引用，archive.py 删除端点已接）；摘抄即记忆 clip_memory（kind=clip salience=4 幂等+向量化）：posts 收藏钩子 + POST /articles/{id}/clip（划词校验必须在原文 + WikiPage mode=clip 入档案馆 + clip 限流 20/日）；前端 ArticleView 划词 popover「收进档案馆」。_backfill_embeddings 拆为独立函数。验收：守门员闲聊/事实二分 PASS、两跳召回带出关联+via 标注 PASS、unlink 清理 PASS、extract 全链路（evidence 校验+links 互写）PASS、clip 幂等+召回 PASS
✅ emind（EastMind）复活：emind.tt2.li 重新上线——后端原样起（:8000 systemd eastmind-backend，已 enable），前端改为静态 dist 直出（摘掉 5173 Vite 常驻进程，省内存）；TokenDance key 实测仍有效；Cran 的 system prompt 留存在 eastmind 库 bots 表（Cran-Expert/Cran 两版）
✅ R10 工程体验：SSE 断线续流（engine/resume.py：生产者 detached 写 Redis list gen:{id}:ev + meta hash，gen 首包带 gen_id；GET /chat/pending?conversation_id= 找回 + GET /chat/stream/{gen_id} 从断点重挂补发；前端 gen_id 存 sessionStorage，会话加载先查本地再查 pending，reattach 重放后重拉权威历史；实测掐断→pending 非空→重挂补发续传到 done）/ 客厅快照秒开（localStorage crina:parlor:{uid} TTL 24h 同步渲染，内容签名 id+created_at+reactions+favorited 有变才换卡片，反应/收藏立即写快照）/ 圆桌三幕（FRAME_PROMPT 主持人选框架 SWOT/六顶帽/第一性原理/辩论赛+分工 → frame SSE 事件 → 2-3 居民 asyncio 并行独立作答，各自独立 SessionLocal（AsyncSession 禁并发共享、禁跨 session ORM 对象）经 queue 汇流，前端 delta 按 character 分桶 → CONCLUDE_PROMPT 四段收束 共识/分歧/盲点/建议；实测价值观题→辩论赛，总耗时 48s<90s）
📋 待做：遗留低优先：JWT 黑名单、观猹 secret 轮换、cron 闹钟未装；emind 复活待站主拍板（源码 /root/workspace/eastmind + /opt/eastmind + eastmind PG 库 + systemd 单元 + nginx 配置全在）；R18 边界议题见对话记录
📚 调研存档：docs/research/duxiang-ai-moments.md（独响 App 全拆解：异步朋友圈节奏/七层关系数值/一起入睡/情绪兜底猫/居民互相串门）
