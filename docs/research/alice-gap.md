# 镜听空间 × Alice 差距分析与升级路线（R8-R10）

> 调研来源：《Alice 方法论》（github.com/itshen/Alice_methodology，重点章：活人感设计/上下文与记忆/多Agent/Prompt工程/Skill）+
> 学 AI 网页助教前端实现（xueai.app/slides/ask-alice.js）+ Alice 官网圆桌脑暴功能描述。
> 与站主两轮对齐结论：**R8 活人感 → R9 记忆 → R10 工程体验**；DayPlan 与情感日记 **7 居民全量**；蛐蛐**仅私聊**。

---

## 0. 差距总览

| 维度 | Alice | 镜听现状 | 差距级 |
|---|---|---|---|
| 一天的剧本 | DayScript 凌晨预写全天结构化事件，三通道共享 | 各 job 独立随机（状态墙/串门/autopost 各管各） | ★★★ |
| 状态一致性 | RPG 状态机（情绪/位置/日程/关系），消灭"瞬移" | 无共享状态 | ★★★ |
| 内心小剧场 | `<aside>` 蛐蛐通道与正文空间分离 | 无 | ★★ |
| 情绪连续体 | 情感日记层（AI 的隐私）→行为指引注入；拒绝数值化展示 | 无（affinity 仅内部，未踩数值化坑） | ★★ |
| 记忆写入 | 守门员二元预判 + 召回 topK 四选一（成本恒定） | 每 3 条全量提取，40 条记忆全塞 LLM | ★★ |
| 记忆检索 | 关联图两跳扩展 | 单层 embedding+salience 混合 | ★ |
| 记忆安全 | 延迟 flush 防自我强化；代码级主客体过滤 | 即时写、无过滤 | ★ |
| SSE 续流 | gen_id + /chat/pending 找回任务重挂流 | 断线重来 | ★★ |
| 首屏 | localStorage 快照+5min TTL+内容签名 | 白屏等接口 | ★ |
| 圆桌脑暴 | 主持人选框架（SWOT/六顶帽）+结构化报告 | 2 居民接力+主角收尾 | ★ |
| Skill 系统 | 用户可写 Markdown 工作流，按需激活 | 无 | 暂缓 |

**Alice 的核心教训（直接抄结论）**：
1. 一致性 > 随机性——先定义状态机再实现功能（"上一条厦门下一条珠海"是真人感杀手）
2. 事件必须是结构体（时间/地点/人物/天气/活动/心情），缺一个维度下游模块就开始瞎猜
3. 用性格描述代替行为许可（"你有内心独白的习惯"≫"你可以偶尔蛐蛐"）
4. 情绪影响表达方式，不影响执行与否——情感通道与任务通道分离
5. 活人感来自脆弱性的可见，不来自能力强大；数值化情绪展示会激活"刷属性"认知，必须叙事化
6. 写入成本恒定设计：召回 topK + LLM 四选一，不遍历全量
7. 绝不把 AI 刚说的话立即写向量库（自我强化循环）

---

## R8 · 活人感系统（7 居民全量）

### R8.1 DayPlan 全天剧本（核心）

**数据模型**（新表 `day_plans`）：
```
id / character_id / plan_date (Date) / created_at
events: JSONB 事件结构体数组：
  [{ "slot": "07:30", "kind": "routine|outing|creation|social|rest",
     "location": "书桌前|阳台|客厅|出门-运河边",
     "activity": "给演讲稿改第三遍开头",
     "mood": "focused|relaxed|tired|excited|blue",
     "weather": "晴|雨|阴",   // 全天共用，生成一次
     "note": "可选一句内心注脚" }]
```
唯一约束 (character_id, plan_date)。

**调度**：
- `job_dayplan`：每天 04:30（错开 greet）为 7 居民批量生成。单个居民一次 `chat_once`（max_tokens 600，temperature 0.8），输入：WORLD+soul_public+昨天日记摘要+今天日期/星期/天气（同一天气串行传给所有居民 prompt，保证全空间天气一致）+该居民人设作息（弦墨影夜行者白天在睡觉）。
- 输出 JSON 数组落库；失败则该居民今天用作息模板兜底（不阻塞其他居民）。
- 成本：7 次/天 × ~1.5K tokens，可忽略。

**消费侧（同一状态机的多个出口）**：
| 出口 | 改法 |
|---|---|
| 状态墙 status_text | job_status 不再自由发挥：查当前时刻所处事件，取 activity 缩 6 字 |
| 串门 job_visit | 从访客今天的 social 事件取材写小记 |
| autopost | 从当前事件取材（"刚在阳台看到……"），时间线与现实时间吻合 |
| 私聊 build_context | 注入「你此刻正在 {location} {activity}，心情 {mood}」——回复与所处状态自洽 |
| 日报 job_daily_report | 素材加入各居民今天的事件线 |
| 衣橱/氛围角生图 | prompt 注入 location+weather 控场景光线（后续） |

**验收**：连续观察 3 天，任一居民的状态墙/碎碎念/私聊自述三者互相印证，无瞬移；弦墨影白天状态为睡觉类。

### R8.2 蛐蛐内心小剧场（仅私聊）

- chat.py stream_reply：探讨与闲聊模式的 system prompt 末尾加：
  「你有内心独白的习惯。回复正文之后，换行用 `<aside>…</aside>` 写一句你的小声嘀咕（不超过 20 字，是只说给自己听的那种）。正文保持完整专业，蛐蛐每条最多一句。」
- 前端 Chat 气泡解析 `<aside>`：小字号+斜体+60% 透明度独立渲染在气泡下沿；streamdown 原文不含 aside 标签（正则剥出后走两个通道）。
- 设置页「居民的小声嘀咕」总开关（users 不加列，存 Redis 或 localStorage——本机设置，跟设备走即可）；关掉则不注入 prompt 段。
- **禁止**出现在：客厅回帖、信件、日报、委托汇报（任务通道不读情感通道）。
- 验收：私聊 10 轮蛐蛐触发率 ≥70%（性格句式应自然高频），正文无泄漏标签；开关关闭后无蛐蛐。

### R8.3 情感日记层（7 居民全量）

**数据模型**（新表 `diaries`）：
```
id / character_id / event_kind (chat|post|letter|visit|daily|system)
/ content Text（第一人称）/ mood_direction (up|down|flat) / intensity 1-5
/ trigger_ref Text（触发上下文摘要）/ created_at
```
**不加用户可见 API**——日记是居民的隐私（Alice 原则："你同事的情绪你也看不到原文"）。

**写入**：
- 私聊会话结束（10 分钟无新消息或新一轮开始时结算上一轮）→ 小模型读最近 6 条判断"这轮对话在 {居民} 心里留下了什么"，值得则写 1 条（成本守门，大多数轮跳过）。
- 特定事件直写：用户拨零花钱/买衣服→crina 正面事件；用户删掉一条记忆→对应居民 flat 事件。
- 每日 DayPlan 生成时顺带写一条"今天开头的心情"。

**行为指引（唯一的消费口）**：
- `job_mood_digest` 每天 2 次（午/晚）：读该居民近 3 天日记 → LLM 生成 80 字「行为指引」段（"刚被夸了观鸟笔记，今天认鸟特别来劲"）存 characters.mood_note 列（新列）。
- build_context 注入：`# 你最近的心境\n{mood_note}\n（这是你自己的感受，让它自然影响你的语气和劲头，不要念出来）`。
- 情绪只影响表达风格，不影响任务执行与否；不注入数字。

**验收**：连续互动 2 天后，居民语气可感知地受近期事件影响（被夸→来劲）；数据库有日记但任何 API 不返回原文；mood_note 每日更新。

### R8.4 世界观密度升级（设定集工程化）

- docs/soul/ 下为 7 居民各建设定集 md（背景/性格/禁忌/语气习惯/**分场景反应模板**：被交代急事→、没把握→、被夸→、深夜被找→），细节密度写到"户型图级"（各自的房间位置、桌上有什么、作息、和彼此的关系史）。
- soul/characters.py 的 soul_public 从设定集编译（seed 时拼接核心段+反应模板进 SYSTEM PROMPT 稳定前缀）。
- DayPlan/蛐蛐/日记的 prompt 全部从设定集取材，保证同一人格三个通道一致。
- 验收：同一情境（如"凌晨两点找 TA"）三个通道的反应互相印证；不出现违背禁忌的输出。

---

## R9 · 记忆系统升级

### R9.1 守门员 + 恒定成本写入

- **守门员**：extract_memories 触发时先调小参数 `chat_once`（max_tokens 5，temperature 0）：「只看这段新对话，有没有值得长期记住的关于用户的事实/偏好？只答 有/没有」。答"没有"直接返回——实测闲聊占大多数，提取调用砍掉大半。
- **恒定成本写入**：现有"塞 40 条已有记忆给 LLM 审"改为：
  1. 新候选事实 embedding → 向量召回 top5 相似记忆；
  2. LLM 只看这 5 条+新事实，输出四选一：`create / merge into <id> / conflict archive <id> + create / skip`；
  3. 精确文本匹配直接 skip（零成本）；无相似直接 create（不调 LLM）；LLM 故障降级 create（写入永不丢）。
- salience/evidence 字段沿用。

### R9.2 防自我强化 + 主客体过滤

- 记忆写入延迟到整轮回复完成后 flush（extract 本来就走 fire_and_forget，把向量写入和 ops 应用放在回复结束之后——当前已满足，需核实 build_context 召回不会读到"本轮刚写入的、源自 AI 回复的"记忆：ops prompt 已有 evidence 要求用户原话，加代码级过滤）。
- **主客体过滤**：extract 输入只传 role=user 的消息原文 + 居民回复仅作语境标注（prompt 明确"只提取用户说的、关于用户的事"；代码侧 evidence 必须能在用户消息里子串匹配，匹配不上丢弃该条）。

### R9.3 关联图两跳检索

- memories 加列 `links JSONB default '[]'`（双向关联 id 列表）。
- 写入时（R9.1 的第 2 步）LLM 顺带标注：新条目与 top5 中哪些有因果/同属关系 → 双向写入 links。
- _recall：第一跳 embedding+salience 混合取 top8 → 第二跳沿 links 各扩 1 条（去重、标注 `via`）→ 补足 top12。
- 删除/归档时清理指向自己的 links（防孤儿引用）。
- 验收：问"Python 项目"能带出"调试先加 log"这类关联记忆；删除后无悬挂引用。

### R9.4 摘抄即记忆

- 客厅收藏（已有 post_favorites）与文章摘抄（新增：文章页划词弹「收进档案馆」→ 存 wiki_pages kind='clip'）后，写入一条 kind='clip' 记忆（salience 4，content="用户收藏了 {作者} 的一句话：xxx"）→ 后续对话自然召回。
- 前端：ArticleView 加划词工具条（selection → popover），客厅收藏不变（已落表，补记忆写入钩子）。
- 验收：收藏一条客厅帖子后，次日私聊相关话题能自然提到"你昨天收藏的那句……"。

---

## R10 · 工程体验

### R10.1 SSE 断线续流

- 后端：chat stream 开始时生成 gen_id 存 Redis（key `gen:{id}` → {conversation_id, 已产出文本, 状态}，TTL 30min）；首包 SSE 事件带 gen_id。
- 新增 `GET /api/chat/pending?conversation_id=`：返回该会话进行中的 gen_id + 已产出文本。
- 新增 `GET /api/chat/stream/{gen_id}`：从断点继续推流（已产出的先一次性补发）。
- 前端 Chat：gen_id 存 sessionStorage；断线/翻页回来先查 pending → 有则补全已产出文本并重新挂流；无则按权威历史渲染。
- 验收：生成中途刷新页面，回复无缝继续；弱网断开 10s 重连不丢字。

### R10.2 客厅快照秒开

- postsApi.list 结果按账号写 localStorage（key 含 user id，快照上限 30 帖）。
- Parlor 挂载时同步渲染快照（不等网络），后台拉新后按内容签名（id+updated_at+reactions 哈希）判断有变才重建对应卡片。
- 快照 TTL 24h； reaction/favorite 操作立即同步改快照（不等下轮拉取）。
- 验收：二次进客厅首帧 <100ms 有内容；新帖/新反应 10s 内静默校正，已展开回复区不被重置。

### R10.3 圆桌脑暴升级

- brainstorm 模式从"LLM 选 2 居民接力"升级为三幕结构：
  1. **主持人（crina）先定框架**：按问题类型选 SWOT/六顶帽/第一性原理/辩论赛（一次 chat_once 输出框架+各居民分工）；
  2. **2-3 位居民并行独立作答**（asyncio.gather，互不看到对方答案——独立推理不偷懒）；探讨模式 reasoning_effort=xhigh 沿用；
  3. **主持人收束**：结构化报告「共识 / 分歧 / 盲点 / 建议」四段。
- SSE 事件序列：frame → 各居民流式 → 收束流式。前端圆桌卡片展示框架名+四段报告样式。
- 验收：同一问题两次脑暴框架选择合理（价值观问题→辩论/六顶帽，决策问题→SWOT）；报告四段齐全；总耗时 <90s。

---

## 不做的事（本轮明确排除）

- Skill 系统（用户可写 Markdown 工作流）——陪伴场景优先级低，R10 后视情况
- 自进化架构（L0-L2 代码生成/撤销栈）——委托板已是我们的答案，不照搬
- 情绪数值化展示——Alice 明确否定，我们坚持叙事化
- 蛐蛐进客厅/信件——空间分离原则，仅私聊
- MCP 协议接入——无外部系统需求

## 站主对齐记录

- 分批：R8 活人感 → R9 记忆 → R10 工程（每批独立可上线）
- DayPlan：7 居民全量剧本（不用轻量降级）
- 蛐蛐：仅私聊，设置页总开关
- 情感日记：7 居民全量，用户不可见原文
