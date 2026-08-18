import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  Compass,
  Hammer,
  Loader2,
  NotebookPen,
  Package,
  Paperclip,
  Plus,
  SendHorizonal,
  Timer,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'
import { archiveApi, ApiError, chatApi, docsApi, fetchTtsAudio, spaceApi, streamChatMessage } from '../api/client'
import type { Character, ChatMessage, ChatMode, Conversation, SpaceDoc } from '../api/types'
import { AuthGate } from '../components/AuthGate'
import { CharacterAvatar } from '../components/CharacterAvatar'
import { Markdown } from '../components/Markdown'
import { Toast } from '../components/Toast'
import { relativeTime } from '../lib/time'

const MODES: { id: ChatMode; label: string; hint: string }[] = [
  { id: 'auto', label: '自动', hint: '让她自己判断：该闲聊就闲聊，该认真就认真' },
  { id: 'brainstorm', label: '脑暴', hint: '多位居民围成圆桌，一起碰撞想法' },
  { id: 'guide', label: '梳理', hint: '一步步帮你理清模糊的想法' },
  { id: 'probe', label: '追问', hint: '逼近问题的本质，可能有点扎心' },
  { id: 'extract', label: '萃取', hint: '凝练成核心信念，收进档案馆' },
  { id: 'off', label: '禁用', hint: '纯闲聊，不展开探讨' },
]

const INSPIRATIONS = [
  '明天有几件事，先想想',
  '刚想到一个事，记一下',
  '最近动态有点多，理一下',
  '有个想法想比较一下优劣',
]

/** 干活意图启发式：消息里出现这些词，回复完后提议钉到委托板 */
const WORK_HINTS = [
  '帮我写', '帮我做', '帮我整理', '帮我翻译', '帮我查', '帮我改',
  '写个', '写一篇', '写一个', '做个', '做一个', '做份',
  '整理成', '总结一下', '翻译成', '代码', '脚本', '爬虫', '小工具',
  '网页', '网站', '报告', '计划书', 'PPT', '批量', '部署', '修复',
]

function detectWorkIntent(text: string): boolean {
  if (text.length < 6) return false
  return WORK_HINTS.some((k) => text.includes(k))
}

/** 流式渲染中的气泡 */
interface StreamBubble {
  character: string
  name: string
  color: string
  avatarUrl: string
  text: string
}

function chatGreeting(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜深了，想聊点什么吗？'
  if (h < 12) return '早上好呀，想聊点什么吗？'
  if (h < 18) return '下午好呀，想聊点什么吗？'
  return '晚上好呀，想聊点什么吗？'
}

type ConvGroup = { label: string; items: Conversation[] }

/** 未分组会话按时间分组；folder === 'emind' 的单独收走 */
function groupConversations(convs: Conversation[]): { groups: ConvGroup[]; emind: Conversation[] } {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86_400_000
  const groups: ConvGroup[] = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '更早', items: [] },
  ]
  const emind: Conversation[] = []
  for (const c of convs) {
    if (c.folder === 'emind') {
      emind.push(c)
      continue
    }
    const t = new Date(c.updated_at).getTime()
    if (t >= startOfToday) groups[0].items.push(c)
    else if (t >= startOfYesterday) groups[1].items.push(c)
    else groups[2].items.push(c)
  }
  return { groups: groups.filter((g) => g.items.length > 0), emind }
}

/** 展示时去掉旧家搬运的 [emind] 前缀 */
function displayTitle(c: Conversation, fallback: string): string {
  return (c.title || fallback).replace(/^\[emind\]\s*/, '')
}

export function ChatPage() {
  return (
    <AuthGate roomName="私聊间">
      <ChatInner />
    </AuthGate>
  )
}

function ChatInner() {
  const { convId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [characters, setCharacters] = useState<Character[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [active, setActive] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamBubbles, setStreamBubbles] = useState<StreamBubble[]>([])
  const [streaming, setStreaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [toast, setToast] = useState('')
  // 新话题（问候输入框）状态
  const [newChar, setNewChar] = useState('crina')
  const [newMode, setNewMode] = useState<ChatMode>('auto')
  const [newDraft, setNewDraft] = useState('')
  const [creating, setCreating] = useState(false)
  /** 流式完成后待提议的「活儿」（crina 智能提议卡片） */
  const [proposal, setProposal] = useState('')
  const pendingProposalRef = useRef<string | null>(null)
  /** 文档引用：已上传文档列表 + 本条消息附带的文档 */
  const [docs, setDocs] = useState<SpaceDoc[]>([])
  const [attached, setAttached] = useState<SpaceDoc[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 用户是否贴着消息流底部（贴底才自动跟滚） */
  const pinnedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const pendingFirstRef = useRef<string | null>(null)

  const charMap = useMemo(() => {
    const m = new Map<string, Character>()
    characters.forEach((c) => m.set(c.id, c))
    return m
  }, [characters])

  const loadConversations = useCallback(() => {
    chatApi.list().then((d) => setConversations(d.conversations)).catch(() => {})
  }, [])

  useEffect(() => {
    spaceApi.characters().then((d) => setCharacters(d.characters)).catch(() => {})
    loadConversations()
  }, [loadConversations])

  // 接住「新话题」带来的第一条消息
  useEffect(() => {
    const st = location.state as { firstMessage?: string } | null
    if (st?.firstMessage) {
      pendingFirstRef.current = st.firstMessage
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  // toast 自动消失（卸载清理）
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const sendTo = useCallback(
    async (conv: Conversation, content: string, docIds: string[] = []) => {
      if (!content) return
      if (streaming) {
        // 上一段还在流式输出：不能静默丢弃——挂回 pendingFirst，流式结束后自动补发
        pendingFirstRef.current ??= content
        setToast('上一段还没说完，说完就替你发出去')
        return
      }
      setError('')
      const optimistic: ChatMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        character_id: null,
        kind: null,
        content,
        created_at: new Date().toISOString(),
      }
      setMessages((m) => [...m, optimistic])
      setStreaming(true)
      setStreamBubbles([])
      const ctrl = new AbortController()
      abortRef.current = ctrl

      // delta 按 50ms 节流合批：字符先进缓冲区，到点一次性 flush，减少 setState 次数
      let deltaBuf = ''
      let lastSpeaker: StreamBubble = {
        character: 'crina',
        name: charMap.get('crina')?.name ?? 'crina',
        color: charMap.get('crina')?.color ?? '#8A8FC4',
        avatarUrl: charMap.get('crina')?.avatar_url ?? '',
        text: '',
      }
      const flushDelta = () => {
        if (!deltaBuf) return
        const text = deltaBuf
        deltaBuf = ''
        setStreamBubbles((b) => {
          if (b.length === 0) return [{ ...lastSpeaker, text }]
          const next = [...b]
          next[next.length - 1] = { ...next[next.length - 1], text: next[next.length - 1].text + text }
          return next
        })
      }
      const flushTimer = setInterval(flushDelta, 50)

      await streamChatMessage(
        conv.id,
        content,
        (ev) => {
          if (ev.type === 'speaker') {
            flushDelta()
            lastSpeaker = {
              character: ev.character,
              name: ev.name,
              color: ev.color,
              avatarUrl: ev.avatar_url,
              text: '',
            }
            setStreamBubbles((b) => [...b, { ...lastSpeaker }])
          } else if (ev.type === 'delta') {
            deltaBuf += ev.text
          } else if (ev.type === 'error') {
            setError(ev.message)
          }
        },
        ctrl.signal,
        docIds,
      ).catch((e) => {
        if (!ctrl.signal.aborted && e instanceof Error && e.name !== 'AbortError') {
          setError(e instanceof ApiError ? e.message : '话说到一半断了，再发一次试试？')
        }
      })
      clearInterval(flushTimer)
      flushDelta()

      // 竞态防护：流被切换会话打断时，不把半截气泡固化进新会话
      if (ctrl.signal.aborted || abortRef.current !== ctrl) {
        setStreamBubbles([])
        return
      }

      // 流正常结束：把气泡固化进消息列表，并刷新会话列表
      setStreamBubbles((bubbles) => {
        const fixed: ChatMessage[] = bubbles
          .filter((b) => b.text.trim())
          .map((b, i) => ({
            id: `stream-${Date.now()}-${i}`,
            role: 'character' as const,
            character_id: b.character,
            kind: null,
            content: b.text,
            created_at: new Date().toISOString(),
          }))
        setMessages((m) => [...m, ...fixed])
        return []
      })
      setStreaming(false)
      loadConversations()
    },
    [charMap, loadConversations, streaming],
  )

  useEffect(() => {
    if (!convId) {
      setActive(null)
      setMessages([])
      return
    }
    // 陈旧请求防护：快速连点会话时，后到的旧响应不得覆盖新会话
    let stale = false
    abortRef.current?.abort()
    setStreamBubbles([])
    setStreaming(false)
    pinnedRef.current = true
    chatApi
      .detail(convId)
      .then((d) => {
        if (stale) return
        setActive(d)
        setMessages(d.messages)
        if (pendingFirstRef.current) {
          const first = pendingFirstRef.current
          pendingFirstRef.current = null
          void sendTo(d, first)
        }
      })
      .catch((e) => {
        if (stale) return
        if (e instanceof ApiError && e.status === 404) {
          navigate('/chat', { replace: true })
        } else {
          setError('网络打了个盹，刷新试试')
        }
      })
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useEffect(() => {
    // 仅当用户本来贴着底部时才跟滚；流式刷新用 instant 避免动画堆积
    if (!pinnedRef.current) return
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [messages, streamBubbles])

  const showToast = (text: string) => {
    setToast(text)
  }

  /** 问候输入框：开新会话并带上第一句话 */
  const startNewConversation = async () => {
    const content = newDraft.trim()
    if (!content || creating) return
    setCreating(true)
    setError('')
    try {
      const conv = await chatApi.create(newChar, newMode)
      setNewDraft('')
      loadConversations()
      navigate(`/chat/${conv.id}`, { state: { firstMessage: content } })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '没能敲开这扇门，再试试？')
    } finally {
      setCreating(false)
    }
  }

  const send = () => {
    const content = draft.trim()
    if (!content || !active || streaming) return
    pendingProposalRef.current = detectWorkIntent(content) ? content : null
    setProposal('')
    setDraft('')
    const docIds = attached.map((d) => d.id)
    setAttached([])
    void sendTo(active, content, docIds)
  }

  const openPicker = () => {
    setPickerOpen((v) => !v)
    if (!pickerOpen && docs.length === 0) {
      docsApi.list().then((d) => setDocs(d.docs)).catch(() => {})
    }
  }

  // 流式说完后：补发被挡住的首条消息；若刚才那条像件活儿，递上「钉到委托板」提议卡
  useEffect(() => {
    if (streaming) return
    if (pendingFirstRef.current && active) {
      const first = pendingFirstRef.current
      pendingFirstRef.current = null
      void sendTo(active, first)
      return
    }
    if (pendingProposalRef.current) {
      setProposal(pendingProposalRef.current)
      pendingProposalRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming])

  /** 常驻「去书桌」：带着当前输入或最近一句话去委托板 */
  const goDesk = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    const text = (draft.trim() || lastUser).slice(0, 8000)
    navigate(text ? `/board?draft=${encodeURIComponent(text)}` : '/board')
  }

  const changeMode = async (mode: ChatMode) => {
    if (!active) return
    try {
      const updated = await chatApi.setMode(active.id, mode)
      setActive((a) => (a ? { ...a, mode: updated.mode } : a))
      loadConversations()
    } catch {
      setError('模式没切换成功，再点一下？')
    }
  }

  const extractToArchive = async () => {
    if (!active || extracting) return
    setExtracting(true)
    try {
      const { title } = await archiveApi.extractWiki(active.id)
      showToast(`已经收进档案馆啦：《${title}》`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '没收进去，等下再试？')
    } finally {
      setExtracting(false)
    }
  }

  const removeConversation = async (id: string) => {
    try {
      await chatApi.remove(id)
      loadConversations()
      if (id === convId) navigate('/chat')
    } catch {
      setError('没删掉，再试一次？')
    }
  }

  const activeChar = active ? charMap.get(active.character_id) : undefined
  const { groups, emind } = groupConversations(conversations)
  const [emindOpen, setEmindOpen] = useState(false)

  const renderConvItem = (c: Conversation) => {
    const ch = charMap.get(c.character_id)
    return (
      <div
        key={c.id}
        className={`group flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
          c.id === convId ? 'bg-crina/10' : 'hover:bg-cream'
        }`}
        onClick={() => navigate(`/chat/${c.id}`)}
      >
        <CharacterAvatar
          name={ch?.name ?? c.character_id}
          color={ch?.color}
          avatarUrl={ch?.avatar_url || null}
          size={34}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">
            {displayTitle(c, `${ch?.name ?? c.character_id} 的小桌`)}
          </div>
          <div className="text-xs text-ink-soft truncate">
            {c.last_message ??
              `${MODES.find((m) => m.id === c.mode)?.label ?? c.mode} · ${relativeTime(c.updated_at)}`}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            void removeConversation(c.id)
          }}
          className="md:opacity-0 md:group-hover:opacity-100 p-1.5 rounded-full text-ink-soft hover:text-anfeng hover:bg-anfeng/10 transition-all shrink-0"
          aria-label="删除会话"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="md:flex md:gap-5 md:h-[calc(100dvh-8.5rem)]">
      <Toast text={toast} onClose={() => setToast('')} />

      {/* 左侧栏：新话题 + 分组会话列表 */}
      <aside
        className={`md:w-80 md:shrink-0 md:flex md:flex-col bg-paper rounded-2xl shadow-card border border-warm-line overflow-hidden ${
          convId ? 'hidden md:flex' : 'flex flex-col'
        } md:h-auto`}
      >
        <div className="p-3.5 border-b border-warm-line">
          <button
            onClick={() => navigate('/chat')}
            className="btn-press w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-crina text-white shadow-sm hover:bg-crina-deep"
          >
            <Plus className="w-4 h-4" />
            新话题
          </button>
        </div>
        <div className="flex-1 overflow-y-auto md:max-h-none max-h-64">
          {conversations.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-ink-soft leading-relaxed">
              还没有聊过天。
              <br />
              在上面写下第一句话，就算开张啦。
            </p>
          )}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-4 pt-3 pb-1 text-[11px] text-ink-soft/70 tracking-wide">{g.label}</div>
              {g.items.map((c) => renderConvItem(c))}
            </div>
          ))}

          {/* 旧家搬运（emind）折叠组 */}
          {emind.length > 0 && (
            <div className="mt-2 border-t border-warm-line/70">
              <button
                onClick={() => setEmindOpen((v) => !v)}
                className="w-full flex items-center gap-2 px-4 py-3 text-xs text-ink-soft hover:text-ink transition-colors"
              >
                <Package className="w-3.5 h-3.5 text-qiule" />
                旧家搬运（emind）
                <span className="px-1.5 py-0.5 rounded-full bg-qiule/15 text-qiule text-[10px]">
                  {emind.length}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 ml-auto transition-transform ${emindOpen ? 'rotate-180' : ''}`}
                />
              </button>
              <AnimatePresence initial={false}>
                {emindOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    {emind.map((c) => renderConvItem(c))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
          <div className="h-2" />
        </div>
      </aside>

      {/* 主区域 */}
      <section
        className={`flex-1 md:flex md:flex-col bg-paper rounded-2xl shadow-card border border-warm-line overflow-hidden mt-4 md:mt-0 ${
          convId ? 'flex flex-col' : 'hidden md:flex'
        } h-[calc(100dvh-11rem)] md:h-auto`}
      >
        {!active ? (
          <GreetingView
            characters={characters}
            charMap={charMap}
            newChar={newChar}
            setNewChar={setNewChar}
            newMode={newMode}
            setNewMode={setNewMode}
            draft={newDraft}
            setDraft={setNewDraft}
            creating={creating}
            error={convId ? '' : error}
            onSend={startNewConversation}
          />
        ) : (
          <>
            {/* 聊天头：居民 + 探讨下拉 + 收进档案馆 */}
            <div className="p-3 border-b border-warm-line">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => navigate('/chat')}
                  className="md:hidden p-1.5 rounded-full hover:bg-cream"
                  aria-label="返回会话列表"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <CharacterAvatar
                  name={activeChar?.name ?? active.character_id}
                  color={activeChar?.color}
                  avatarUrl={activeChar?.avatar_url || null}
                  size={34}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {active.title || `和 ${activeChar?.name ?? active.character_id} 的悄悄话`}
                  </div>
                </div>
                <ModeDropdown value={active.mode ?? 'auto'} onChange={changeMode} />
                <FocusMode character={activeChar} />
                <button
                  onClick={extractToArchive}
                  disabled={extracting || messages.length === 0}
                  title="把这场探讨的精华萃取成一页，收进档案馆"
                  className="btn-press shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs bg-baixu/12 text-baixu hover:bg-baixu/20 disabled:opacity-40"
                >
                  {extracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Archive className="w-3 h-3" />}
                  <span className="hidden sm:inline">{extracting ? '萃取中…' : '收进档案馆'}</span>
                </button>
              </div>
            </div>

            {/* 消息流 */}
            <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && streamBubbles.length === 0 && (
                <p className="text-center text-sm text-ink-soft py-10">桌上还空着，说第一句话吧。</p>
              )}
              {messages.map((m) =>
                m.role === 'user' ? (
                  <UserBubble key={m.id} content={m.content} />
                ) : (
                  <CharacterBubble
                    key={m.id}
                    characterId={m.character_id ?? 'crina'}
                    content={m.content}
                    charMap={charMap}
                  />
                ),
              )}
              {streamBubbles.map((b, i) => (
                <motion.div key={`s-${i}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  <div className="flex gap-2.5">
                    <CharacterAvatar name={b.name} color={b.color} avatarUrl={b.avatarUrl || null} size={32} />
                    <div className="max-w-[80%]">
                      <div className="text-xs mb-1" style={{ color: b.color }}>
                        {b.name}
                      </div>
                      <div
                        className="bg-cream rounded-2xl rounded-tl-md px-4 py-2.5 text-[15px] leading-relaxed border border-warm-line/70 typing-caret"
                        style={{ borderLeftColor: b.color, borderLeftWidth: 2 }}
                      >
                        {b.text ? <Markdown content={b.text} streaming /> : '…'}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
              {streaming && streamBubbles.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-ink-soft">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  居民正在想……
                </div>
              )}
              {error && <p className="text-center text-sm text-anfeng">{error}</p>}
              <div ref={bottomRef} />
            </div>

            {/* 输入框 + 免责声明 */}
            <div className="p-3 border-t border-warm-line">
              {/* crina 智能提议：这像件活儿 → 一键钉到委托板 */}
              <AnimatePresence>
                {proposal && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: 8, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-qiule/30 bg-qiule/10 backdrop-blur-md px-3.5 py-2.5">
                      <Hammer className="w-4 h-4 text-qiule shrink-0" />
                      <p className="flex-1 min-w-0 text-xs text-ink-soft leading-relaxed">
                        这听起来像件活儿——要钉到委托板，让 crina 正儿八经施工吗？
                      </p>
                      <button
                        onClick={() => {
                          navigate(`/board?draft=${encodeURIComponent(proposal)}`)
                          setProposal('')
                        }}
                        className="btn-press shrink-0 text-xs px-3 py-1.5 rounded-lg bg-crina text-white hover:bg-crina-deep"
                      >
                        钉到委托板
                      </button>
                      <button
                        onClick={() => setProposal('')}
                        aria-label="忽略"
                        className="btn-press shrink-0 p-1.5 rounded-lg text-ink-soft/60 hover:text-ink"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {/* 附带文档 chips */}
              {attached.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {attached.map((d) => (
                    <span
                      key={d.id}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-xianmo/10 text-xianmo"
                    >
                      <Paperclip className="w-3 h-3" />
                      {d.filename}
                      <button
                        onClick={() => setAttached((a) => a.filter((x) => x.id !== d.id))}
                        aria-label={`取下 ${d.filename}`}
                        className="hover:text-anfeng"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                {/* 引用文档 */}
                <div className="relative shrink-0">
                  <button
                    onClick={openPicker}
                    title="附上文档（先去委托板上传）"
                    aria-label="附上文档"
                    className={`btn-press p-3 rounded-full border shrink-0 ${
                      pickerOpen || attached.length > 0
                        ? 'border-xianmo/50 text-xianmo bg-xianmo/8'
                        : 'border-warm-line text-ink-soft hover:text-crina-deep hover:border-crina/50'
                    }`}
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <AnimatePresence>
                    {pickerOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                        <motion.div
                          initial={{ opacity: 0, y: 6, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 6, scale: 0.97 }}
                          transition={{ duration: 0.15 }}
                          className="absolute left-0 bottom-full mb-2 z-50 w-72 max-h-64 overflow-y-auto bg-paper/90 backdrop-blur-md rounded-2xl shadow-float border border-warm-line p-1.5"
                        >
                          {docs.length === 0 && (
                            <p className="px-3 py-4 text-xs text-ink-soft text-center leading-relaxed">
                              还没有文档——去委托板底部的「我的文档」上传 PDF/DOCX/图片，
                              就能在这里附给居民看啦。
                            </p>
                          )}
                          {docs.map((d) => {
                            const on = attached.some((x) => x.id === d.id)
                            return (
                              <button
                                key={d.id}
                                onClick={() =>
                                  setAttached((a) =>
                                    on ? a.filter((x) => x.id !== d.id) : a.length >= 3 ? a : [...a, d],
                                  )
                                }
                                className={`w-full text-left px-3 py-2 rounded-xl transition-colors ${
                                  on ? 'bg-xianmo/10' : 'hover:bg-cream'
                                }`}
                              >
                                <span className={`text-sm ${on ? 'text-xianmo font-medium' : ''}`}>
                                  {d.filename}
                                </span>
                                <span className="block text-[11px] text-ink-soft mt-0.5 truncate">
                                  {d.chars > 0 ? `${d.chars} 字 · ${d.preview ?? ''}` : '没读出文字（可能是扫描件）'}
                                </span>
                              </button>
                            )
                          })}
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
                <button
                  onClick={goDesk}
                  title="去书桌：带着这句话去委托板"
                  aria-label="去书桌"
                  className="btn-press p-3 rounded-full border border-warm-line text-ink-soft hover:text-crina-deep hover:border-crina/50 shrink-0"
                >
                  <NotebookPen className="w-4 h-4" />
                </button>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      send()
                    }
                  }}
                  placeholder={streaming ? '居民还在说话，等一等…' : '说点什么吧…（Enter 发送）'}
                  rows={1}
                  maxLength={4000}
                  disabled={streaming}
                  className="flex-1 resize-none bg-cream rounded-2xl px-4 py-2.5 text-[15px] outline-none border border-warm-line focus:border-crina/50 disabled:opacity-60 max-h-32"
                />
                <button
                  onClick={send}
                  disabled={!draft.trim() || streaming}
                  className="btn-press p-3 rounded-full bg-crina text-white disabled:opacity-40 hover:bg-crina-deep shrink-0"
                  aria-label="发送"
                >
                  <SendHorizonal className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-2 text-center text-[11px] text-ink-soft/60">内容由 AI 生成，请注意甄别</p>
            </div>
          </>
        )}
      </section>

      {/* 移动端：未选中会话时，问候视图在列表下方单独成区 */}
      {!convId && (
        <div className="md:hidden mt-4 bg-paper rounded-2xl shadow-card border border-warm-line overflow-hidden">
          <GreetingView
            characters={characters}
            charMap={charMap}
            newChar={newChar}
            setNewChar={setNewChar}
            newMode={newMode}
            setNewMode={setNewMode}
            draft={newDraft}
            setDraft={setNewDraft}
            creating={creating}
            error={error}
            onSend={startNewConversation}
          />
        </div>
      )}
    </div>
  )
}

/** 未选中会话时的主区域：问候 + 大输入框 + 灵感 chips */
function GreetingView({
  characters,
  newChar,
  setNewChar,
  newMode,
  setNewMode,
  draft,
  setDraft,
  creating,
  error,
  onSend,
}: {
  characters: Character[]
  charMap: Map<string, Character>
  newChar: string
  setNewChar: (id: string) => void
  newMode: ChatMode
  setNewMode: (m: ChatMode) => void
  draft: string
  setDraft: (s: string) => void
  creating: boolean
  error: string
  onSend: () => void
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 md:py-8">
      <motion.h2
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="font-title text-2xl md:text-3xl text-center"
      >
        {chatGreeting()}
      </motion.h2>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.08 }}
        className="mt-6 w-full max-w-xl bg-cream rounded-3xl border border-warm-line focus-within:border-crina/50 shadow-sm p-3.5"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              onSend()
            }
          }}
          placeholder="写下第一句话，新话题就开始了…"
          rows={3}
          maxLength={4000}
          className="w-full resize-none bg-transparent outline-none text-[15px] leading-relaxed placeholder:text-ink-soft/60"
        />
        <div className="flex items-center gap-2 pt-2 border-t border-warm-line/70">
          {/* 选居民 */}
          <div className="flex items-center gap-1 overflow-x-auto">
            {characters.map((c) => (
              <button
                key={c.id}
                onClick={() => setNewChar(c.id)}
                title={c.name}
                className={`btn-press rounded-full transition-all shrink-0 ${
                  newChar === c.id ? 'ring-2 ring-crina ring-offset-1 ring-offset-cream' : 'opacity-60 hover:opacity-100'
                }`}
              >
                <CharacterAvatar name={c.name} color={c.color} avatarUrl={c.avatar_url || null} size={26} />
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <ModeDropdown value={newMode} onChange={setNewMode} up />
            <button
              onClick={onSend}
              disabled={!draft.trim() || creating}
              className="btn-press p-2.5 rounded-full bg-crina text-white disabled:opacity-40 hover:bg-crina-deep"
              aria-label="开始新话题"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizonal className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </motion.div>

      {/* 灵感 chips */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.16 }}
        className="mt-4 flex flex-wrap justify-center gap-2 max-w-xl"
      >
        {INSPIRATIONS.map((s) => (
          <button
            key={s}
            onClick={() => setDraft(s)}
            className="btn-press inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-paper border border-warm-line text-xs text-ink-soft hover:border-crina/40 hover:text-ink shadow-sm"
          >
            <Compass className="w-3 h-3 text-crina" />
            {s}
          </button>
        ))}
      </motion.div>

      {error && <p className="mt-3 text-sm text-anfeng">{error}</p>}
      <p className="mt-6 text-[11px] text-ink-soft/60">内容由 AI 生成，请注意甄别</p>
    </div>
  )
}

/** 「探讨 ▾」下拉：带说明的探讨模式菜单 */
function ModeDropdown({
  value,
  onChange,
  up = false,
}: {
  value: ChatMode
  onChange: (m: ChatMode) => void
  up?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = MODES.find((m) => m.id === value) ?? MODES[0]
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn-press inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs bg-crina/12 text-crina-deep hover:bg-crina/20"
      >
        探讨 · {current.label}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: up ? 6 : -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: up ? 6 : -6, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className={`absolute right-0 z-50 w-64 bg-paper/85 backdrop-blur-md rounded-2xl shadow-float border border-warm-line p-1.5 ${
                up ? 'bottom-full mb-2' : 'top-full mt-2'
              }`}
            >
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onChange(m.id)
                    setOpen(false)
                  }}
                  className={`w-full text-left px-3 py-2 rounded-xl transition-colors ${
                    m.id === value ? 'bg-crina/10' : 'hover:bg-cream'
                  }`}
                >
                  <span className={`text-sm ${m.id === value ? 'text-crina-deep font-medium' : ''}`}>
                    {m.label}
                  </span>
                  <span className="block text-xs text-ink-soft mt-0.5">{m.hint}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

const UserBubble = memo(function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-crina text-white rounded-2xl rounded-tr-md px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap shadow-sm">
        {content}
      </div>
    </div>
  )
})

const CharacterBubble = memo(function CharacterBubble({
  characterId,
  content,
  charMap,
}: {
  characterId: string
  content: string
  charMap: Map<string, Character>
}) {
  // memo 包裹：历史气泡不随流式 delta 重渲染
  const c = charMap.get(characterId)
  const name = c?.name ?? characterId
  const color = c?.color ?? '#8A8FC4'
  return (
    <div className="flex gap-2.5">
      <CharacterAvatar name={name} color={color} avatarUrl={c?.avatar_url || null} size={32} />
      <div className="max-w-[80%]">
        <div className="text-xs mb-1 flex items-center gap-2" style={{ color }}>
          {name}
        </div>
        <div
          className="bg-cream rounded-2xl rounded-tl-md px-4 py-2.5 text-[15px] leading-relaxed border border-warm-line/70"
          style={{ borderLeftColor: color, borderLeftWidth: 2 }}
        >
          <Markdown content={content} />
        </div>
        <TtsButton text={content} characterId={characterId} />
      </div>
    </div>
  )
})

function TtsButton({ text, characterId }: { text: string; characterId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)

  // 卸载清理：暂停播放并释放对象 URL
  useEffect(
    () => () => {
      audioRef.current?.pause()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  const play = async () => {
    if (state !== 'idle') return
    setState('loading')
    try {
      const blob = await fetchTtsAudio(text, characterId)
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      urlRef.current = url
      const release = () => {
        setState('idle')
        if (urlRef.current === url) urlRef.current = null
        URL.revokeObjectURL(url)
      }
      audio.onended = release
      audio.onerror = release
      setState('playing')
      await audio.play()
    } catch {
      setState('idle')
    }
  }

  return (
    <button
      onClick={play}
      disabled={state !== 'idle'}
      className="mt-1 inline-flex items-center gap-1 text-xs text-ink-soft/70 hover:text-crina-deep transition-colors disabled:opacity-60"
      aria-label="朗读这条消息"
    >
      {state === 'loading' ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Volume2 className={`w-3.5 h-3.5 ${state === 'playing' ? 'text-crina-deep animate-pulse' : ''}`} />
      )}
      {state === 'loading' ? '在录音了…' : state === 'playing' ? '播放中' : '听 ta 说'}
    </button>
  )
}

/** 一起专注：25 分钟番茄钟，居民安静陪着（前端仪式，不打扰对话） */
function FocusMode({ character }: { character?: Character }) {
  const FOCUS_MINUTES = 25
  const [endAt, setEndAt] = useState<number | null>(null)
  const [leftSec, setLeftSec] = useState(0)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    if (!endAt) return
    const tick = () => {
      const left = Math.max(0, Math.round((endAt - Date.now()) / 1000))
      setLeftSec(left)
      if (left <= 0) {
        setEndAt(null)
        setFinished(true)
      }
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [endAt])

  useEffect(() => {
    if (!finished) return
    const t = setTimeout(() => setFinished(false), 20000)
    return () => clearTimeout(t)
  }, [finished])

  const mm = String(Math.floor(leftSec / 60)).padStart(2, '0')
  const ss = String(leftSec % 60).padStart(2, '0')
  const name = character?.name ?? 'crina'

  return (
    <>
      <button
        onClick={() => {
          setFinished(false)
          setEndAt(Date.now() + FOCUS_MINUTES * 60_000)
        }}
        disabled={endAt !== null}
        title={`和 ${name} 一起专注 ${FOCUS_MINUTES} 分钟`}
        className="btn-press shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs bg-tuanman/12 text-tuanman hover:bg-tuanman/20 disabled:opacity-40"
      >
        <Timer className="w-3 h-3" />
        <span className="hidden sm:inline">一起专注</span>
      </button>

      <AnimatePresence>
        {endAt !== null && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-5 right-5 z-40 flex items-center gap-3 rounded-2xl bg-paper/90 backdrop-blur border border-warm-line shadow-float px-4 py-3"
          >
            <CharacterAvatar
              name={name}
              color={character?.color}
              avatarUrl={character?.avatar_url || null}
              size={32}
            />
            <div>
              <div className="font-mono text-lg leading-none tabular-nums">
                {mm}:{ss}
              </div>
              <div className="mt-1 text-[11px] text-ink-soft">{name} 在安静陪你，别刷手机哦</div>
            </div>
            <button
              onClick={() => setEndAt(null)}
              className="btn-press text-xs px-2.5 py-1.5 rounded-lg border border-warm-line text-ink-soft hover:text-anfeng"
            >
              提前收工
            </button>
          </motion.div>
        )}
        {finished && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            className="fixed bottom-5 right-5 z-40 flex items-center gap-3 rounded-2xl bg-paper/95 backdrop-blur border border-tuanman/30 shadow-float px-4 py-3"
          >
            <CharacterAvatar
              name={name}
              color={character?.color}
              avatarUrl={character?.avatar_url || null}
              size={32}
            />
            <div className="text-sm text-ink leading-relaxed">
              {FOCUS_MINUTES} 分钟到啦——{name} 为你鼓掌！
              <div className="text-[11px] text-ink-soft">起来倒杯水，看看窗外再回来。</div>
            </div>
            <button
              onClick={() => setFinished(false)}
              aria-label="收下鼓励"
              className="btn-press p-1.5 rounded-lg text-ink-soft/60 hover:text-ink"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
