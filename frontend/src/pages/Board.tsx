import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import {
  BatteryCharging,
  CheckCircle2,
  ClipboardList,
  Download,
  File,
  FileText,
  FolderOpen,
  Hammer,
  Loader2,
  PenLine,
  Pin,
  Save,
  Upload,
  FileDown,
  Trash2,
  WandSparkles,
  X,
  XCircle,
} from 'lucide-react'
import { agentApi, ApiError, docsApi, filesApi, streamTask } from '../api/client'
import type { AgentTask, SpaceDoc, SpaceFile, TaskStatus } from '../api/types'
import { AuthGate } from '../components/AuthGate'
import { EmptyState } from '../components/EmptyState'
import { Markdown } from '../components/Markdown'
import { Toast } from '../components/Toast'
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
  const [toast, setToast] = useState('')
  const [filesNonce, setFilesNonce] = useState(0)
  const [searchParams, setSearchParams] = useSearchParams()

  // 从聊天「去书桌」带来的草稿：?draft=...
  useEffect(() => {
    const draft = searchParams.get('draft')
    if (draft) {
      setPrompt(draft.slice(0, 8000))
      setTitle('')
      setFormOpen(true)
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 「让 crina 接着改」：把文件带成一张预填的小纸条 */
  const continueWithCrina = (f: SpaceFile) => {
    setTitle(`接着改 ${f.name}`)
    setPrompt(
      `请继续完善我文件空间里的 ${f.path}（用读文件工具看现状，改完保存回去）。\n补充要求：`,
    )
    setFormOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  /** 各任务上一次的状态，用于探测「刚刚交付」 */
  const prevStatusRef = useRef<Map<string, TaskStatus> | null>(null)

  const load = useCallback(() => {
    agentApi
      .list()
      .then((d) => {
        const prev = prevStatusRef.current
        if (prev) {
          // 有任务刚从别的状态变成 done → 提示去文件空间验收
          const justDone = d.tasks.some(
            (t) => t.status === 'done' && prev.has(t.id) && prev.get(t.id) !== 'done',
          )
          if (justDone) {
            setToast('交付啦——产出物已放进文件空间 ↓')
            setFilesNonce((n) => n + 1)
          }
        }
        prevStatusRef.current = new Map(d.tasks.map((t) => [t.id, t.status]))
        setTasks(d.tasks)
      })
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
    <div className="max-w-3xl mx-auto">
      <Toast text={toast} onClose={() => setToast('')} />
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

      {/* 我的文件空间（轻 IDE） */}
      <FileSpace nonce={filesNonce} onContinue={continueWithCrina} />

      {/* 我的文档：上传→提取→可附到聊天/委托 */}
      <DocsSection />
    </div>
  )
}

/** 人性化文件大小 */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 文本类文件可以在书桌里直接打开编辑 */
function isEditable(f: SpaceFile): boolean {
  if (f.kind.startsWith('text/')) return true
  return /\.(md|markdown|txt|json|js|jsx|ts|tsx|css|html|py|sh|yml|yaml|toml|csv|svg|xml)$/i.test(
    f.name,
  )
}

/** 文件空间（轻 IDE）：委托产出物在这里，能看、能改、能让 crina 接着改 */
function FileSpace({ nonce, onContinue }: { nonce: number; onContinue: (f: SpaceFile) => void }) {
  const [files, setFiles] = useState<SpaceFile[]>([])
  const [hint, setHint] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [openPath, setOpenPath] = useState<string | null>(null)

  const reload = useCallback(() => {
    filesApi
      .list()
      .then((d) => {
        setFiles(d.files)
        setHint(d.hint ?? '')
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  useEffect(reload, [reload, nonce])

  const openFile = files.find((f) => f.path === openPath) ?? null

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
      className="mt-8 bg-paper rounded-2xl shadow-card border border-warm-line p-5"
    >
      <h2 className="font-title text-lg flex items-center gap-2">
        <FolderOpen className="w-5 h-5 text-baixu" />
        文件空间
      </h2>
      <p className="mt-1 text-xs text-ink-soft">
        委托的产出物会放在这里——文本文件可以直接打开改，改完保存，或者叫 crina 接着改。
      </p>

      <div className="mt-4">
        {loaded && files.length === 0 && (
          <p className="text-sm text-ink-soft text-center py-8 leading-relaxed">
            {hint || '文件空间还空着——去委托板钉一张小纸条，产出物会出现在这里'}
          </p>
        )}
        <div className="space-y-1">
          {files.map((f) => {
            const isImage = f.kind.startsWith('image/')
            const editable = isEditable(f)
            const url = filesApi.url(f.path)
            return (
              <div
                key={f.path}
                className={`group flex items-center gap-3 px-2.5 py-2 rounded-xl transition-colors hover:bg-cream ${
                  openPath === f.path ? 'bg-cream' : ''
                }`}
              >
                {isImage ? (
                  <img
                    src={url}
                    alt={f.name}
                    loading="lazy"
                    className="w-10 h-10 rounded-lg object-cover shrink-0 border border-warm-line"
                  />
                ) : (
                  <span className="w-10 h-10 rounded-lg bg-cream border border-warm-line flex items-center justify-center shrink-0">
                    {editable ? (
                      <FileText className="w-4.5 h-4.5 text-xianmo" />
                    ) : (
                      <File className="w-4.5 h-4.5 text-ink-soft" />
                    )}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{f.name}</div>
                  <div className="text-xs text-ink-soft/80">
                    {humanSize(f.size)} · {relativeTime(new Date(f.mtime * 1000).toISOString())}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {editable && (
                    <button
                      onClick={() => setOpenPath(openPath === f.path ? null : f.path)}
                      className="btn-press text-xs px-2.5 py-1.5 rounded-lg border border-warm-line text-ink-soft hover:text-crina-deep hover:border-crina/40"
                    >
                      {openPath === f.path ? '收起' : '打开'}
                    </button>
                  )}
                  <a
                    href={url}
                    download={f.name}
                    aria-label={`下载 ${f.name}`}
                    className="btn-press p-1.5 rounded-lg text-ink-soft/60 hover:text-crina-deep"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>
              </div>
            )
          })}
        </div>

        {/* 轻编辑器 */}
        <AnimatePresence>
          {openFile && (
            <FileEditor
              key={openFile.path}
              file={openFile}
              onClose={() => setOpenPath(null)}
              onSaved={reload}
              onContinue={() => onContinue(openFile)}
            />
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  )
}

/** 轻 IDE 编辑器：查看（md 渲染 / 代码等宽）→ 编辑 → 保存；一键「让 crina 接着改」 */
function FileEditor({
  file,
  onClose,
  onSaved,
  onContinue,
}: {
  file: SpaceFile
  onClose: () => void
  onSaved: () => void
  onContinue: () => void
}) {
  const isMd = /\.(md|markdown)$/i.test(file.name)
  const [content, setContent] = useState('')
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    let stale = false
    filesApi
      .read(file.path)
      .then((d) => {
        if (stale) return
        setContent(d.content)
        setDraft(d.content)
        setTruncated(d.truncated)
      })
      .catch((e) => !stale && setError(e instanceof ApiError ? e.message : '打开失败'))
      .finally(() => !stale && setLoading(false))
    return () => {
      stale = true
    }
  }, [file.path])

  const dirty = draft !== content

  const save = async () => {
    if (saving || !dirty) return
    setSaving(true)
    setError('')
    try {
      await filesApi.write(file.path, draft)
      setContent(draft)
      setEditing(false)
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '没存上，再试一次？')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="mt-3 rounded-xl border border-crina/30 bg-cream/60 overflow-hidden">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-warm-line/70 bg-paper/70">
          <FileText className="w-4 h-4 text-xianmo shrink-0" />
          <span className="text-sm truncate flex-1">{file.path}</span>
          {truncated && <span className="text-xs text-qiule shrink-0">只显示了前一段</span>}
          <button
            onClick={onContinue}
            className="btn-press inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-crina/10 text-crina-deep hover:bg-crina/20"
          >
            <WandSparkles className="w-3.5 h-3.5" />
            让 crina 接着改
          </button>
          {/\.(md|markdown|txt)$/i.test(file.name) && (
            <>
              <button
                onClick={() => docsApi.export({ path: file.path, format: 'docx' }).catch(() => {})}
                title="导出为 Word"
                className="btn-press inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-warm-line text-ink-soft hover:text-crina-deep"
              >
                <FileDown className="w-3.5 h-3.5" />
                docx
              </button>
              <button
                onClick={() => docsApi.export({ path: file.path, format: 'pdf' }).catch(() => {})}
                title="导出为 PDF"
                className="btn-press inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-warm-line text-ink-soft hover:text-crina-deep"
              >
                <FileDown className="w-3.5 h-3.5" />
                pdf
              </button>
            </>
          )}
          {editing ? (
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="btn-press inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-crina text-white disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              保存
            </button>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="btn-press inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-warm-line text-ink-soft hover:text-crina-deep"
            >
              <PenLine className="w-3.5 h-3.5" />
              编辑
            </button>
          )}
          <button onClick={onClose} aria-label="收起" className="btn-press p-1.5 rounded-lg text-ink-soft/60 hover:text-ink">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-[28rem] overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-soft">
              <Loader2 className="w-4 h-4 animate-spin" />
              翻开中……
            </div>
          ) : editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="w-full min-h-72 bg-transparent px-4 py-3 text-[13px] leading-relaxed font-mono outline-none resize-y"
            />
          ) : isMd ? (
            <div className="px-4 py-3 text-sm leading-relaxed">
              <Markdown content={content} />
            </div>
          ) : (
            <pre className="px-4 py-3 text-[13px] leading-relaxed font-mono whitespace-pre-wrap break-all">
              {content}
            </pre>
          )}
        </div>
        {error && <p className="px-4 py-2 text-xs text-anfeng border-t border-warm-line/70">{error}</p>}
      </div>
    </motion.div>
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

  // 合上详情时复位，下次展开重连（服务端日志回放是幂等的，本地要先清空防重复）
  useEffect(() => {
    if (open) return
    streamedRef.current = false
    liveStartedRef.current = false
    setReport('')
    setTools([])
    abortRef.current?.abort()
  }, [open])

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
                  <div className="text-sm leading-relaxed">
                    <Markdown content={task.result_summary} />
                  </div>
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

/** 我的文档：上传 PDF/DOCX/图片 → 提取文本 → 可在私聊/委托里引用 */
function DocsSection() {
  const [docs, setDocs] = useState<SpaceDoc[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    docsApi
      .list()
      .then((d) => setDocs(d.docs))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  useEffect(load, [load])

  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(''), 5000)
    return () => clearTimeout(t)
  }, [msg])

  const onPick = async (f: File | undefined) => {
    if (!f || busy) return
    setBusy(true)
    try {
      const res = await docsApi.upload(f)
      setMsg(res.message)
      load()
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : '上传失败了，再试一次？')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const remove = async (id: string) => {
    try {
      await docsApi.remove(id)
      setDocs((d) => d.filter((x) => x.id !== id))
    } catch {
      setMsg('没删掉，再试一次？')
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="mt-8 bg-paper rounded-2xl shadow-card border border-warm-line p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-title text-lg flex items-center gap-2">
            <FileText className="w-5 h-5 text-xianmo" />
            我的文档
          </h2>
          <p className="mt-1 text-xs text-ink-soft">
            上传 PDF / DOCX / 图片，crina 会读出内容——私聊和委托里都能附上引用。
          </p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="btn-press shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-xianmo text-white text-sm hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {busy ? '读取中…' : '上传'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
      </div>
      {msg && <p className="mt-3 text-xs text-baixu">{msg}</p>}

      <div className="mt-4">
        {loaded && docs.length === 0 && (
          <p className="text-sm text-ink-soft text-center py-6 leading-relaxed">
            还没有文档——把观鸟 PDF、课程资料、截图传上来，聊天时点 📎 就能给居民看。
          </p>
        )}
        <div className="space-y-1">
          {docs.map((d) => (
            <div
              key={d.id}
              className="group flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-cream transition-colors"
            >
              <span className="w-10 h-10 rounded-lg bg-cream border border-warm-line flex items-center justify-center shrink-0">
                <FileText className="w-4.5 h-4.5 text-xianmo" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">{d.filename}</div>
                <div className="text-xs text-ink-soft/80 truncate">
                  {d.kind.toUpperCase()} · {d.chars > 0 ? `${d.chars} 字` : '未提取到文字'} ·{' '}
                  {relativeTime(d.created_at)}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => docsApi.export({ doc_id: d.id, format: 'docx' }).catch(() => {})}
                  title="导出 docx"
                  className="btn-press p-1.5 rounded-lg text-ink-soft/60 hover:text-crina-deep"
                >
                  <FileDown className="w-4 h-4" />
                </button>
                <button
                  onClick={() => remove(d.id)}
                  title="删除"
                  className="btn-press p-1.5 rounded-lg text-ink-soft/60 hover:text-anfeng"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  )
}
