# 开发规范 · 镜听空间

> 所有贡献者（人类或 AI agent，包括 crina 的装修委托）必读。违反本规范的代码不得合入。

## 0. 铁律（违反=事故）

1. **禁容器**，全部 systemd 裸机；新增常驻进程必须在 PR 说明内存开销（本机 3.8G RAM）。
2. **密钥永不**：进 git / 进前端代码 / 进 agent worker 文件系统或环境变量。worker 只拿 `/px/<一次性token>` 代理 URL。
3. **私密素材**（`assets/src_materials/`）永不提交、永不作为公网可访问内容、私有层 SOUL 仅站主会话注入。
4. 后台异步任务**必须** `app/bg.py: fire_and_forget()`（裸 `asyncio.create_task` 会被事件循环 GC）。
5. 公域内容全年龄安全；瓜瓜只能输出"呱"。
6. 不动本机其它 nginx 站点与在跑服务。

## 1. 后端（Python 3.13 + FastAPI + SQLAlchemy 2 async）

### 分层
```
api/       路由层：只做 参数校验 → 调 engine → 组装返回。不写业务逻辑。
engine/    业务逻辑：chat(编排) / memory(记忆管道) / tokendance(网关客户端) / wardrobe(购置)
agentpool/ 干活层：worker(wire 驱动) / pool(池化) / proxy(词元代理)
proactive/ 主动性引擎：调度器与定时任务
soul/      人设：characters.py(WORLD+SOUL+模式) / garbage.py(垃圾堆词条)
models.py  全部表定义（单文件，保持）
```

### 异步纪律
- 禁跨 session 使用 ORM 对象（后台任务里重新 `await db.get()` 取新鲜对象）。
- 关系访问必须 `selectinload` 预取（否则 MissingGreenlet）。
- `expire_on_commit=False` 已全局设置，commit 后读属性安全。
- 阻塞文件/网络操作用 `asyncio.to_thread` 或 aiofiles/httpx。

### 错误处理
- 对外：温柔中文文案（"搬家车半路熄火了，稍后再试"）；细节 `log.exception` 进 journal。
- `except` 里 raise HTTPException 必须 `from None`。
- UUID 路径参数解析失败要 404/422，不允许 500。

### 安全清单（每个端点自查）
- 属主校验：`where(Model.user_id == user.id)` 或取后比对，缺一不可（防 IDOR）。
- 配额：`check_and_count_quota`（PG 原子 upsert），BYOK/站主豁免。
- 限流：Redis 冷却键（如 `import:emind:<uid>`）。
- `text()` SQL 一律绑定参数。
- 新表：`models.py` 定义 + `sudo -u postgres psql -d crina -c "ALTER/CREATE..."` + seed 幂等。

### LLM 调用约定
- prompt 中含 JSON 示例时**禁止** `.format()`（花括号爆炸），用 `__PLACEHOLDER__` + `.replace()`。
- HTTP header 禁止中文（httpx latin-1 限制）。
- 聊天模型 `enable_thinking: false`（防出戏）；抽取/规划类用 temperature ≤0.4。

## 2. 前端（React 19 + TS + Tailwind 4 + motion）

### 目录职责
```
pages/       路由页（React.lazy 拆包，每页一个 chunk）
components/  共享组件（Avatar/EmptyState/ZoomableImage/toast…）
api/         client.ts(fetch+readSseStream 唯一入口) / types.ts(与后端契约)
utils/       time.ts 等纯函数
```

### 组件规范
- 列表项/气泡组件 `React.memo`；context 只放真正全局的状态。
- 副作用必须清理：定时器/audio/流/订阅都在 cleanup 里处理。
- toast 计时器放 `useEffect([toast])`，禁内联 setTimeout。
- Enter 提交必须 `!e.nativeEvent.isComposing`（中文 IME）。
- SSE 一律走 `readSseStream`（兼容 \r\n、残余 buffer flush）；abort 后不得再 setState（先判 `ctrl.signal.aborted`）。
- 空态/加载态/错误态三态齐全，文案用朋友语气（"网络打了个盹"），禁裸白屏。

### 设计令牌
唯一来源 `index.css @theme`：crina 蓝紫 #8A8FC4 / 安风红 #B7423A / 秋乐凝 #C99A5B / 弦墨影 #3D4A6B / 团小满 #E88BA0 / 白叙 #7A9E8E / 瓜瓜 #9BB25F / 暖米白 #FAF7F2。新颜色先进令牌再用。

## 3. 素材生成
- 立绘：seedream i2i，参考图在 `assets/src_materials/`；**透明底技巧**：`background:"transparent"` 需输入图含透明像素——先加 20px 透明边框。
- 产出统一转 webp（立绘保留 RGBA alpha），头像 512²，全身 ≤760px 宽。
- 生成后必须目检（ReadMediaFile）再上线。

## 4. 质量门（合入前必过）
```bash
cd backend && .venv/bin/ruff check app/        # 全绿
cd frontend && npx tsc --noEmit && npm run build  # 零报错
./scripts/smoke.sh                              # 9/9
systemctl restart crina-backend                # 后端改动后
```

## 5. Git
- commit 用 `NLPark-Cran <289238639+NLPark-Cran@users.noreply.github.com>`（计 contribution）。
- 消息格式：`feat|fix|perf|harden|docs: 摘要`。
