import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import {
  BatteryCharging,
  CheckCircle2,
  ClipboardList,
  Hammer,
  Loader2,
  Pin,
  X,
  XCircle,
} from 'lucide-react'
import { agentApi, ApiError, streamTask } from '../api/client'
import type { AgentTask, TaskStatus } from '../api/types'
import { AuthGate } from '../components/AuthGate'
import { EmptyState } from '../components/EmptyState'
import { relativeTime } from '../lib/time'
import { useAuth } from '../store/auth'

const STATUS_META: Record<TaskStatus, { label: string; cls: string }> = {
  queued: { label: '排队中', cls: 'bg-qiule/15 text-qiule' },
  running: { label: '施工中', cls: 'bg-crina/15 text-crina-deep' },
  done: { label: '交付啦', cls: 'bg-baixu/15 text-baixu' },
  failed: { label: '搞砸了', cls: 'bg-anfeng/12 text-anfeng' },
  cancelled: { label: '已撕下', cls: 'bg-ink-soft/10 text-ink-soft' },
}

interface ToolEvent {
  key: number
  name: string
  state: 'running' | 'ok' | 'fail'
  message?: string
}

export function BoardPage() {
  return (
    <AuthGate roomName="委托板">
      <BoardInner />
    </AuthGate>
  )
}

function BoardInner() {
  const { user } = useAuth()
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [loaded, setLoaded] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [quotaHit, setQuotaHit] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [renovate, setRenovate] = useState(false)

  const load = useCallback(() => {
    agentApi
      .list()
      .then((d) => setTasks(d.tasks))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  useEffect(load, [load])

  const submit = async () => {
    if (!title.trim() || !prompt.trim() || sending) return
    setSending(true)
    setError('')
    setQuotaHit(false)
    try {
      await agentApi.create(title.trim(), prompt.trim(), renovate ? 'renovate' : 'sandbox')
      setTitle('')
      setPrompt('')
      setRenovate(false)
      setFormOpen(false)
      load()
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setQuotaHit(true)
        setError(e.message)
      } else {
        setError(e instanceof ApiError ? e.message : '小纸条没钉上去，再试一次？')
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-end justify-between gap-3"
      >
        <div>
          <h1 className="font-title text-3xl flex items-center gap-2">
            <ClipboardList className="w-7 h-7 text-crina" />
            委托板
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            把活儿写在小纸条上钉上来，crina 做完了会敲你。写代码、查资料、整理文档、生成图片、读写云文档都行。
          </p>
        </div>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="btn-press shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-crina text-white text-sm hover:bg-crina-deep shadow-sm"
        >
          <Pin className="w-4 h-4" />
          钉小纸条
        </button>
      </motion.div>

      {/* 钉小纸条表单 */}
      <AnimatePresence>
        {formOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0, rotate: -1 }}
            animate={{ opacity: 1, height: 'auto', rotate: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="relative mt-5 bg-qiule/8 rounded-2xl shadow-card border border-qiule/25 p-5">
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-anfeng/70 shadow-sm" />
              <div className="flex items-center justify-between mb-3">
                <span className="font-title">新的小纸条</span>
                <button onClick={() => setFormOpen(false)} className="p-1 rounded-full hover:bg-cream" aria-label="收起">
                  <X className="w-4 h-4 text-ink-soft" />
                </button>
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="一句话说清要干嘛（比如：帮我整理观鸟笔记）"
                maxLength={128}
                className="w-full bg-paper rounded-xl px-4 py-2.5 text-sm outline-none border border-warm-line focus:border-crina/50"
              />
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="细节都写在这儿：背景、要求、想要的产出……写得越清楚，crina 干得越漂亮。"
                rows={5}
                maxLength={8000}
                className="mt-3 w-full resize-none bg-paper rounded-xl px-4 py-3 text-sm leading-relaxed outline-none border border-warm-line focus:border-crina/50"
              />
              {user?.is_owner && (
                <button
                  type="button"
                  onClick={() => setRenovate((v) => !v)}
                  className={`mt-3 w-full flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                    renovate ? 'border-anfeng/40 bg-anfeng/6' : 'border-warm-line bg-paper hover:bg-cream'
                  }`}
                >
                  <Hammer className={`w-4 h-4 mt-0.5 shrink-0 ${renovate ? 'text-anfeng' : 'text-ink-soft'}`} />
                  <span>
                    <span className={`text-sm ${renovate ? 'text-anfeng font-medium' : ''}`}>这是空间装修委托</span>
                    <span className="block mt-0.5 text-xs text-ink-soft leading-relaxed">
                      她会直接修改空间的前端代码并构建上线。想改哪里，写在纸条上就行。
                    </span>
                  </span>
                  <span
                    className={`ml-auto mt-0.5 w-9 h-5 rounded-full p-0.5 transition-colors shrink-0 ${
                      renovate ? 'bg-anfeng' : 'bg-warm-line'
                    }`}
                  >
                    <span className={`block w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${renovate ? 'translate-x-4' : ''}`} />
                  </span>
                </button>
              )}
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-ink-soft/70">{prompt.length}/8000</span>
                <button
                  onClick={submit}
                  disabled={!title.trim() || !prompt.trim() || sending}
                  className="btn-press inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-crina text-white text-sm disabled:opacity-40 hover:bg-crina-deep"
                >
                  <Hammer className="w-4 h-4" />
                  {sending ? '敲钉子中…' : '敲钉子，钉上！'}
                </button>
              </div>
              {error && (
                <div className="mt-3 text-sm text-anfeng">
                  <p>{error}</p>
                  {quotaHit && (
                    <Link to="/settings" className="inline-flex items-center gap-1 mt-1.5 text-crina-deep hover:underline">
                      <BatteryCharging className="w-4 h-4" />
                      去设置页接上词元蓄电池，干活不限量 →
                    </Link>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 任务卡片列表 */}
      <div className="mt-6 space-y-3">
        {loaded && tasks.length === 0 && (
          <EmptyState
            icon={ClipboardList}
            title="板上还空空的"
            hint="钉第一张委托小纸条吧——哪怕是「帮我夸夸今天的天空」也可以。"
          />
        )}
        {tasks.map((t, i) => (
          <TaskCard
            key={t.id}
            task={t}
            index={i}
            open={openId === t.id}
            onToggle={() => setOpenId(openId === t.id ? null : t.id)}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  )
}

function TaskCard({
  task,
  index,
  open,
  onToggle,
  onChanged,
}: {
  task: AgentTask
  index: number
  open: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const meta = STATUS_META[task.status] ?? STATUS_META.queued
  const [report, setReport] = useState('')
  const [tools, setTools] = useState<ToolEvent[]>([])
  const [live, setLive] = useState(false)
  const [streamErr, setStreamErr] = useState('')
  const [finishedStatus, setFinishedStatus] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const toolKey = useRef(0)
  const streamedRef = useRef(false)
  const liveStartedRef = useRef(false)

  // 排队中的任务转为施工中时，允许重新连接拿到实时流
  useEffect(() => {
    if (task.status === 'running' && !liveStartedRef.current) streamedRef.current = false
  }, [task.status])

  // 展开详情时自动连接施工流（历史回放 + 实时追加）
  useEffect(() => {
    if (!open || streamedRef.current) return
    streamedRef.current = true
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLive(task.status === 'running' || task.status === 'queued')
    streamTask(
      task.id,
      (ev) => {
        switch (ev.type) {
          case 'started':
            liveStartedRef.current = true
            setLive(true)
            break
          case 'text':
            if (ev.text) setReport((r) => r + ev.text)
            break
          case 'tool_start':
            setTools((ts) => [...ts, { key: ++toolKey.current, name: ev.name ?? 'tool', state: 'running' }])
            break
          case 'tool_end':
            setTools((ts) => {
              // 找到最后一个同名 running 徽章收尾；找不到就补一个
              const next = [...ts]
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].state === 'running' && next[i].name === (ev.name ?? next[i].name)) {
                  next[i] = { ...next[i], state: ev.ok ? 'ok' : 'fail', message: ev.message }
                  return next
                }
              }
              return [...next, { key: ++toolKey.current, name: ev.name ?? 'tool', state: ev.ok ? 'ok' : 'fail', message: ev.message }]
            })
            break
          case 'finished':
            setFinishedStatus(ev.status ?? null)
            setLive(false)
            break
          case 'error':
            setStreamErr(ev.message ?? '施工流出了点状况')
            setLive(false)
            break
          case 'closed':
          case 'eof':
            setLive(false)
            break
          default:
            break // ping 等心跳忽略
        }
      },
      ctrl.signal,
    )
      .catch(() => setLive(false))
      .finally(() => {
        setLive(false)
        onChanged()
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task.id, task.status])

  const cancel = async () => {
    if (cancelling) return
    setCancelling(true)
    try {
      await agentApi.cancel(task.id)
      onChanged()
    } catch {
      /* ignore */
    } finally {
      setCancelling(false)
    }
  }

  const displayStatus = (finishedStatus as TaskStatus | null) ?? task.status
  const displayMeta = STATUS_META[displayStatus] ?? meta

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.05, 0.4) }}
      className="bg-paper rounded-2xl shadow-card border border-warm-line overflow-hidden"
    >
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-4 text-left">
        <span className="w-2.5 h-2.5 rounded-full bg-anfeng/60 shrink-0 shadow-sm" title="钉子" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{task.title}</span>
            {task.target === 'renovate' && (
              <span className="shrink-0 inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full bg-anfeng/10 text-anfeng">
                <Hammer className="w-3 h-3" />
                装修
              </span>
            )}
            <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${displayMeta.cls}`}>
              {displayStatus === 'running' && <Loader2 className="inline w-3 h-3 mr-0.5 animate-spin" />}
              {displayMeta.label}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-ink-soft/80">
            钉于 {relativeTime(task.created_at)}
            {task.finished_at && ` · ${relativeTime(task.finished_at)}交付`}
          </div>
        </div>
        <span className="text-xs text-crina-deep shrink-0">{open ? '合上' : '看看'}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-1 border-t border-warm-line/60 space-y-4">
              {/* 委托原文 */}
              <div className="mt-3 text-xs text-ink-soft bg-cream rounded-xl p-3 leading-relaxed whitespace-pre-wrap">
                {task.prompt}
              </div>

              {/* 施工时间线 */}
              {tools.length > 0 && (
                <div>
                  <div className="text-xs text-ink-soft mb-2">施工时间线</div>
                  <div className="flex flex-wrap gap-1.5">
                    <AnimatePresence initial={false}>
                      {tools.map((t) => (
                        <motion.span
                          key={t.key}
                          initial={{ opacity: 0, scale: 0.7 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                          title={t.message}
                          className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full ${
                            t.state === 'running'
                              ? 'bg-crina/15 text-crina-deep'
                              : t.state === 'ok'
                                ? 'bg-baixu/12 text-baixu'
                                : 'bg-anfeng/12 text-anfeng'
                          }`}
                        >
                          {t.state === 'running' ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : t.state === 'ok' ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <XCircle className="w-3 h-3" />
                          )}
                          {t.name}
                        </motion.span>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* crina 的交付汇报 */}
              {(report || live) && (
                <div>
                  <div className="text-xs text-ink-soft mb-2">crina 的汇报</div>
                  <div
                    className={`bg-cream rounded-xl rounded-tl-md border border-warm-line/70 border-l-2 border-l-crina px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      live ? 'typing-caret' : ''
                    }`}
                  >
                    {report || (live ? 'crina 卷起袖子开始干活了……' : '')}
                  </div>
                </div>
              )}

              {/* 交付摘要 */}
              {task.result_summary && displayStatus === 'done' && (
                <div className="bg-baixu/8 border border-baixu/25 rounded-xl p-3.5">
                  <div className="text-xs text-baixu mb-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    交付啦
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{task.result_summary}</p>
                </div>
              )}
              {displayStatus === 'failed' && (
                <p className="text-sm text-anfeng">
                  这次没干成{task.result_summary ? `：${task.result_summary}` : '。'}可以再钉一张纸条让 crina 换个思路试试。
                </p>
              )}
              {streamErr && <p className="text-xs text-anfeng">{streamErr}</p>}

              {/* 取消（仅排队中） */}
              {task.status === 'queued' && (
                <button
                  onClick={cancel}
                  disabled={cancelling}
                  className="btn-press text-xs text-ink-soft hover:text-anfeng disabled:opacity-50"
                >
                  {cancelling ? '撕下来中…' : '还没开工，撕下这张纸条（取消）'}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
