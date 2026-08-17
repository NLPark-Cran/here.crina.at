import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  ArrowLeft,
  Loader2,
  MessagesSquare,
  Plus,
  SendHorizonal,
  Trash2,
  Volume2,
} from 'lucide-react'
import { archiveApi, ApiError, chatApi, fetchTtsAudio, spaceApi, streamChatMessage } from '../api/client'
import type { Character, ChatMessage, ChatMode, Conversation } from '../api/types'
import { AuthGate } from '../components/AuthGate'
import { CharacterAvatar } from '../components/CharacterAvatar'
import { EmptyState } from '../components/EmptyState'
import { relativeTime } from '../lib/time'

const MODES: { id: ChatMode; label: string; hint: string }[] = [
  { id: 'auto', label: '自动', hint: '让居民自己判断：该闲聊就闲聊，该认真就认真' },
  { id: 'brainstorm', label: '脑暴', hint: '多位居民围成圆桌，一起碰撞想法' },
  { id: 'guide', label: '梳理', hint: '帮你把乱糟糟的思路捋成一条线' },
  { id: 'probe', label: '追问', hint: '一步步逼近问题的本质，可能有点扎心' },
  { id: 'extract', label: '萃取', hint: '聊完把这场探讨的精华沉淀进档案馆' },
  { id: 'off', label: '禁用', hint: '关掉探讨，就单纯地聊聊天' },
]

/** 流式渲染中的气泡 */
interface StreamBubble {
  character: string
  name: string
  color: string
  avatarUrl: string
  text: string
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
  const [characters, setCharacters] = useState<Character[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [active, setActive] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamBubbles, setStreamBubbles] = useState<StreamBubble[]>([])
  const [streaming, setStreaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [toast, setToast] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

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

  useEffect(() => {
    if (!convId) {
      setActive(null)
      setMessages([])
      return
    }
    abortRef.current?.abort()
    setStreamBubbles([])
    setStreaming(false)
    chatApi
      .detail(convId)
      .then((d) => {
        setActive(d)
        setMessages(d.messages)
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) navigate('/chat', { replace: true })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBubbles])

  const startConversation = async (characterId: string) => {
    try {
      const conv = await chatApi.create(characterId, 'auto')
      setPickerOpen(false)
      loadConversations()
      navigate(`/chat/${conv.id}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '没能敲开这扇门，再试试？')
    }
  }

  const send = async () => {
    const content = draft.trim()
    if (!content || !active || streaming) return
    setDraft('')
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

    await streamChatMessage(
      active.id,
      content,
      (ev) => {
        if (ev.type === 'speaker') {
          setStreamBubbles((b) => [
            ...b,
            {
              character: ev.character,
              name: ev.name,
              color: ev.color,
              avatarUrl: ev.avatar_url,
              text: '',
            },
          ])
        } else if (ev.type === 'delta') {
          setStreamBubbles((b) => {
            if (b.length === 0) {
              const c = charMap.get(ev.character)
              return [
                {
                  character: ev.character,
                  name: c?.name ?? ev.character,
                  color: c?.color ?? '#8A8FC4',
                  avatarUrl: c?.avatar_url ?? '',
                  text: ev.text,
                },
              ]
            }
            const next = [...b]
            next[next.length - 1] = { ...next[next.length - 1], text: next[next.length - 1].text + ev.text }
            return next
          })
        } else if (ev.type === 'error') {
          setError(ev.message)
        }
      },
      ctrl.signal,
    ).catch((e) => {
      if (e instanceof Error && e.name !== 'AbortError') {
        setError(e instanceof ApiError ? e.message : '话说到一半断了，再发一次试试？')
      }
    })

    // 流结束：把气泡固化进消息列表，并刷新会话标题
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
  }

  const extractToArchive = async () => {
    if (!active || extracting) return
    setExtracting(true)
    try {
      const { title } = await archiveApi.extractWiki(active.id)
      setToast(`已经收进档案馆啦：《${title}》`)
      setTimeout(() => setToast(''), 6000)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '没收进去，等下再试？')
    } finally {
      setExtracting(false)
    }
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
  const activeMode = MODES.find((m) => m.id === (active?.mode ?? 'auto'))

  return (
    <div className="md:flex md:gap-5 md:h-[calc(100dvh-8.5rem)]">
      {/* 收进档案馆 toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[calc(100%-2rem)] bg-paper rounded-2xl shadow-float border border-baixu/30 px-5 py-3.5 text-sm text-center"
          >
            {toast}
            <button
              onClick={() => navigate('/archive')}
              className="block mx-auto mt-1 text-xs text-crina-deep hover:underline"
            >
              去档案馆看看 →
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {/* 会话列表（移动端：无会话时显示） */}
      <aside
        className={`md:w-72 md:shrink-0 md:flex md:flex-col bg-paper rounded-2xl shadow-card border border-warm-line overflow-hidden ${
          convId ? 'hidden md:flex' : 'flex flex-col'
        } h-[calc(100dvh-11rem)] md:h-auto`}
      >
        <div className="p-4 border-b border-warm-line flex items-center justify-between">
          <h2 className="font-title text-lg">私聊间</h2>
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className="btn-press p-2 rounded-full bg-crina text-white hover:bg-crina-deep"
            aria-label="开始新会话"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <AnimatePresence>
          {pickerOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-warm-line"
            >
              <div className="p-3 grid grid-cols-4 gap-2">
                {characters.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => startConversation(c.id)}
                    className="btn-press flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-cream"
                  >
                    <CharacterAvatar name={c.name} color={c.color} avatarUrl={c.avatar_url || null} size={36} />
                    <span className="text-xs text-ink-soft">{c.name}</span>
                  </button>
                ))}
              </div>
              <p className="px-3 pb-3 text-xs text-ink-soft/80 text-center">点一位居民，去 ta 的小桌边坐下</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <EmptyState
              icon={MessagesSquare}
              title="还没有私聊过"
              hint="点右上角的 +，挑一位居民开始第一场悄悄话。"
            />
          )}
          {conversations.map((c) => {
            const ch = charMap.get(c.character_id)
            return (
              <div
                key={c.id}
                className={`group flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-warm-line/60 transition-colors ${
                  c.id === convId ? 'bg-crina/10' : 'hover:bg-cream'
                }`}
                onClick={() => navigate(`/chat/${c.id}`)}
              >
                <CharacterAvatar
                  name={ch?.name ?? c.character_id}
                  color={ch?.color}
                  avatarUrl={ch?.avatar_url || null}
                  size={38}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {c.title || `${ch?.name ?? c.character_id} 的小桌`}
                  </div>
                  <div className="text-xs text-ink-soft">
                    {MODES.find((m) => m.id === c.mode)?.label ?? c.mode} · {relativeTime(c.updated_at)}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void removeConversation(c.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full text-ink-soft hover:text-anfeng hover:bg-anfeng/10 transition-all"
                  aria-label="删除会话"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
      </aside>

      {/* 聊天窗（移动端：有会话时显示） */}
      <section
        className={`flex-1 md:flex md:flex-col bg-paper rounded-2xl shadow-card border border-warm-line overflow-hidden mt-4 md:mt-0 ${
          convId ? 'flex flex-col' : 'hidden md:flex'
        } h-[calc(100dvh-11rem)] md:h-auto`}
      >
        {!active ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={MessagesSquare}
              title="挑一场对话坐下"
              hint="左边选一场继续聊，或者点 + 开始新的悄悄话。"
            />
          </div>
        ) : (
          <>
            {/* 聊天头：居民 + 模式选择器 */}
            <div className="p-3 border-b border-warm-line space-y-2.5">
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
                  {activeMode && (
                    <div className="text-xs text-ink-soft truncate">{activeMode.hint}</div>
                  )}
                </div>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => changeMode(m.id)}
                    title={m.hint}
                    className={`btn-press shrink-0 px-3 py-1 rounded-full text-xs transition-colors ${
                      (active.mode ?? 'auto') === m.id
                        ? 'bg-crina text-white shadow-sm'
                        : 'bg-cream text-ink-soft hover:bg-crina/15'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
                <button
                  onClick={extractToArchive}
                  disabled={extracting || messages.length === 0}
                  title="把这场探讨的精华萃取成一页，收进档案馆"
                  className="btn-press shrink-0 ml-auto inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-baixu/12 text-baixu hover:bg-baixu/20 disabled:opacity-40"
                >
                  {extracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Archive className="w-3 h-3" />}
                  {extracting ? '萃取中…' : '收进档案馆'}
                </button>
              </div>
            </div>

            {/* 消息流 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && streamBubbles.length === 0 && (
                <p className="text-center text-sm text-ink-soft py-10">
                  桌上还空着，说第一句话吧。
                </p>
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
                        className="bg-cream rounded-2xl rounded-tl-md px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap border border-warm-line/70 typing-caret"
                        style={{ borderLeftColor: b.color, borderLeftWidth: 2 }}
                      >
                        {b.text || '…'}
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

            {/* 输入框 */}
            <div className="p-3 border-t border-warm-line flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void send()
                  }
                }}
                placeholder={streaming ? '居民还在说话，等一等…' : '说点什么吧…（Enter 发送）'}
                rows={1}
                maxLength={4000}
                disabled={streaming}
                className="flex-1 resize-none bg-cream rounded-2xl px-4 py-2.5 text-[15px] outline-none border border-warm-line focus:border-crina/50 disabled:opacity-60 max-h-32"
              />
              <button
                onClick={() => void send()}
                disabled={!draft.trim() || streaming}
                className="btn-press p-3 rounded-full bg-crina text-white disabled:opacity-40 hover:bg-crina-deep shrink-0"
                aria-label="发送"
              >
                <SendHorizonal className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-crina text-white rounded-2xl rounded-tr-md px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap shadow-sm">
        {content}
      </div>
    </div>
  )
}

function CharacterBubble({
  characterId,
  content,
  charMap,
}: {
  characterId: string
  content: string
  charMap: Map<string, Character>
}) {
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
          className="bg-cream rounded-2xl rounded-tl-md px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap border border-warm-line/70"
          style={{ borderLeftColor: color, borderLeftWidth: 2 }}
        >
          {content}
        </div>
        <TtsButton text={content} characterId={characterId} />
      </div>
    </div>
  )
}

function TtsButton({ text, characterId }: { text: string; characterId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const play = async () => {
    if (state !== 'idle') return
    setState('loading')
    try {
      const blob = await fetchTtsAudio(text, characterId)
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => {
        setState('idle')
        URL.revokeObjectURL(url)
      }
      audio.onerror = () => {
        setState('idle')
        URL.revokeObjectURL(url)
      }
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
