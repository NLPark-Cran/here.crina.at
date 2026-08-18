import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  BookMarked,
  Brain,
  CalendarDays,
  Check,
  Copy,
  Download,
  LibraryBig,
  Plus,
  Trash2,
} from 'lucide-react'
import { ApiError, archiveApi } from '../api/client'
import type { Memory, SpaceEvent, WikiPage } from '../api/types'
import { AuthGate } from '../components/AuthGate'
import { EmptyState } from '../components/EmptyState'
import { Markdown } from '../components/Markdown'
import { formatDateTime, relativeTime } from '../lib/time'

type Tab = 'memories' | 'calendar' | 'wiki'

const TABS: { id: Tab; label: string; icon: typeof Brain }[] = [
  { id: 'memories', label: '记忆', icon: Brain },
  { id: 'calendar', label: '日历', icon: CalendarDays },
  { id: 'wiki', label: '沉淀', icon: BookMarked },
]

export function ArchivePage() {
  return (
    <AuthGate roomName="档案馆">
      <ArchiveInner />
    </AuthGate>
  )
}

function ArchiveInner() {
  const [tab, setTab] = useState<Tab>('memories')
  return (
    <div className="max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="font-title text-3xl flex items-center gap-2">
          <LibraryBig className="w-7 h-7 text-baixu" />
          档案馆
        </h1>
        <p className="mt-2 text-sm text-ink-soft">这里收着你们一起攒下的东西。</p>
      </motion.div>

      <div className="mt-5 flex gap-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`btn-press flex items-center gap-1.5 px-4 py-2 rounded-full text-sm transition-colors ${
              tab === id ? 'bg-crina text-white shadow-sm' : 'bg-paper text-ink-soft border border-warm-line hover:bg-cream'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
          >
            {tab === 'memories' && <MemoriesTab />}
            {tab === 'calendar' && <CalendarTab />}
            {tab === 'wiki' && <WikiTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

// ---------- 记忆 ----------
const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  fact: { label: '事实', cls: 'bg-xianmo/10 text-xianmo' },
  preference: { label: '偏好', cls: 'bg-tuanman/15 text-tuanman' },
  summary: { label: '摘要', cls: 'bg-qiule/15 text-qiule' },
}

function MemoriesTab() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(() => {
    archiveApi.memories().then((d) => setMemories(d.memories)).catch(() => {}).finally(() => setLoaded(true))
  }, [])

  useEffect(load, [load])

  const remove = async (id: string) => {
    try {
      await archiveApi.deleteMemory(id)
      setMemories((ms) => ms.filter((m) => m.id !== id))
    } catch {
      /* 静默失败，下次刷新会恢复 */
    }
  }

  return (
    <div>
      <p className="text-sm text-ink-soft mb-4">crina 记住的关于你的事。不想让她记着的，可以悄悄撕掉。</p>
      {loaded && memories.length === 0 && (
        <EmptyState
          icon={Brain}
          title="还没有记下什么"
          hint="多去私聊间坐坐，聊得多了，crina 会慢慢记住你在意的事。"
        />
      )}
      <div className="space-y-3">
        {memories.map((m, i) => {
          const kind = KIND_LABEL[m.kind] ?? { label: m.kind, cls: 'bg-crina/10 text-crina-deep' }
          return (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.4) }}
              className="group bg-paper rounded-2xl shadow-card border border-warm-line p-4 flex items-start gap-3"
            >
              <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${kind.cls}`}>{kind.label}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-relaxed">{m.content}</p>
                <p className="mt-1 text-xs text-ink-soft/70">{relativeTime(m.created_at)}</p>
              </div>
              <button
                onClick={() => remove(m.id)}
                className="md:opacity-0 md:group-hover:opacity-100 p-1.5 rounded-full text-ink-soft hover:text-anfeng hover:bg-anfeng/10 transition-all shrink-0"
                aria-label="删除这条记忆"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- 日历 ----------
function CalendarTab() {
  const [events, setEvents] = useState<SpaceEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState('')
  const [remind, setRemind] = useState(60)
  const [icsUrl, setIcsUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    archiveApi.events().then((d) => setEvents(d.events)).catch(() => {}).finally(() => setLoaded(true))
  }, [])

  useEffect(load, [load])

  const create = async () => {
    if (!title.trim() || !startAt) return
    setError('')
    try {
      await archiveApi.createEvent({
        title: title.trim(),
        description: description.trim(),
        start_at: new Date(startAt).toISOString(),
        remind_minutes: remind,
      })
      setTitle('')
      setDescription('')
      setStartAt('')
      setFormOpen(false)
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '没存上，再试一次？')
    }
  }

  const remove = async (id: string) => {
    try {
      await archiveApi.deleteEvent(id)
      setEvents((es) => es.filter((e) => e.id !== id))
    } catch {
      /* ignore */
    }
  }

  const exportIcs = async () => {
    try {
      const { url } = await archiveApi.icsUrl()
      setIcsUrl(url)
    } catch {
      setError('订阅链接没拿到，等下再试？')
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(icsUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  // 只展示近期待办，按开始时间升序（最近的最先）
  const upcoming = events
    .filter((e) => new Date(e.start_at).getTime() >= Date.now() - 86_400_000)
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-ink-soft">要紧的日子记在这儿，crina 会替你惦记着。</p>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="btn-press shrink-0 inline-flex items-center gap-1 px-3.5 py-1.5 rounded-full bg-crina text-white text-sm hover:bg-crina-deep"
        >
          <Plus className="w-4 h-4" />
          记一笔
        </button>
      </div>

      <AnimatePresence>
        {formOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mb-4 bg-paper rounded-2xl shadow-card border border-warm-line p-4 space-y-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="什么事？（比如：交稿截止）"
                maxLength={128}
                className="w-full bg-cream rounded-xl px-4 py-2.5 text-sm outline-none border border-warm-line focus:border-crina/50"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="补充两句（可以留空）"
                className="w-full bg-cream rounded-xl px-4 py-2.5 text-sm outline-none border border-warm-line focus:border-crina/50"
              />
              <div className="flex flex-wrap gap-3 items-center">
                <label className="text-xs text-ink-soft">
                  时间
                  <input
                    type="datetime-local"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    className="ml-2 bg-cream rounded-lg px-2.5 py-1.5 text-sm outline-none border border-warm-line focus:border-crina/50"
                  />
                </label>
                <label className="text-xs text-ink-soft">
                  提前
                  <select
                    value={remind}
                    onChange={(e) => setRemind(Number(e.target.value))}
                    className="ml-2 bg-cream rounded-lg px-2 py-1.5 text-sm outline-none border border-warm-line"
                  >
                    <option value={0}>准时</option>
                    <option value={15}>15 分钟</option>
                    <option value={60}>1 小时</option>
                    <option value={1440}>1 天</option>
                  </select>
                  提醒
                </label>
                <button
                  onClick={create}
                  disabled={!title.trim() || !startAt}
                  className="btn-press ml-auto px-4 py-1.5 rounded-full bg-crina text-white text-sm disabled:opacity-40 hover:bg-crina-deep"
                >
                  存进日历
                </button>
              </div>
              {error && <p className="text-xs text-anfeng">{error}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loaded && events.length === 0 && (
        <EmptyState
          icon={CalendarDays}
          title="日历上还干干净净"
          hint="把要紧的日子记上来，到点了 crina 会戳你一下。"
        />
      )}

      <div className="space-y-3">
        {upcoming.map((e, i) => (
          <motion.div
            key={e.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.4) }}
            className="group bg-paper rounded-2xl shadow-card border border-warm-line p-4 flex items-start gap-3"
          >
            <div className="shrink-0 w-11 h-11 rounded-xl bg-qiule/12 text-qiule flex flex-col items-center justify-center">
              <span className="text-base font-semibold leading-none">{new Date(e.start_at).getDate()}</span>
              <span className="text-[10px] mt-0.5">{new Date(e.start_at).getMonth() + 1} 月</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{e.title}</div>
              {e.description && <div className="mt-0.5 text-xs text-ink-soft">{e.description}</div>}
              <div className="mt-1 text-xs text-ink-soft/70">
                {formatDateTime(e.start_at)} · {relativeTime(e.start_at)}
              </div>
            </div>
            <button
              onClick={() => remove(e.id)}
              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full text-ink-soft hover:text-anfeng hover:bg-anfeng/10 transition-all shrink-0"
              aria-label="删除事件"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </div>

      {/* 导出到手机日历 */}
      <div className="mt-6 bg-paper rounded-2xl shadow-card border border-warm-line p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium">挂到手机日历上</div>
            <div className="mt-0.5 text-xs text-ink-soft">生成订阅链接，加进手机日历就能自动同步</div>
          </div>
          <button
            onClick={exportIcs}
            className="btn-press shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-baixu text-white text-sm hover:opacity-90"
          >
            <Download className="w-4 h-4" />
            导出到手机日历
          </button>
        </div>
        {icsUrl && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 flex items-center gap-2">
            <input
              readOnly
              value={icsUrl}
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 bg-cream rounded-lg px-3 py-2 text-xs text-ink-soft outline-none border border-warm-line"
            />
            <button
              onClick={copy}
              className="btn-press shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-crina/12 text-crina-deep text-xs"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? '复制好了' : '复制'}
            </button>
          </motion.div>
        )}
      </div>
    </div>
  )
}

// ---------- 沉淀 ----------
const MODE_LABEL: Record<string, string> = {
  auto: '自动',
  brainstorm: '脑暴',
  guide: '梳理',
  probe: '追问',
  extract: '萃取',
  off: '闲聊',
}

function WikiTab() {
  const [pages, setPages] = useState<WikiPage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    archiveApi.wiki().then((d) => setPages(d.pages)).catch(() => {}).finally(() => setLoaded(true))
  }, [])

  return (
    <div>
      <p className="text-sm text-ink-soft mb-4">探讨之后萃取出的精华，一页一页收在这里。</p>
      {loaded && pages.length === 0 && (
        <EmptyState
          icon={BookMarked}
          title="书架上还空着"
          hint="在私聊间用「萃取」模式认真聊一场，聊完的智慧就会收进这里。"
        />
      )}
      <div className="space-y-3">
        {pages.map((p, i) => {
          const open = openId === p.id
          return (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.4) }}
              className="bg-paper rounded-2xl shadow-card border border-warm-line overflow-hidden"
            >
              <button onClick={() => setOpenId(open ? null : p.id)} className="w-full text-left p-4">
                <div className="flex items-center gap-2">
                  <span className="font-title truncate">{p.title}</span>
                  <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-crina/10 text-crina-deep">
                    {MODE_LABEL[p.mode] ?? p.mode}
                  </span>
                </div>
                <div className="mt-1 text-xs text-ink-soft/70">{relativeTime(p.created_at)}</div>
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
                    <div className="px-5 pb-5 pt-1 border-t border-warm-line/60">
                      <Markdown content={p.content} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
