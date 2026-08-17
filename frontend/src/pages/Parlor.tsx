import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { SendHorizonal, Trash2, Sofa } from 'lucide-react'
import { postsApi, spaceApi, ApiError } from '../api/client'
import type { GarbageItem, Post } from '../api/types'
import { CharacterAvatar } from '../components/CharacterAvatar'
import { EmptyState } from '../components/EmptyState'
import { ZoomableImage } from '../components/ZoomableImage'
import { relativeTime } from '../lib/time'
import { useAuth } from '../store/auth'

export function ParlorPage() {
  const { user } = useAuth()
  const [posts, setPosts] = useState<Post[]>([])
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [openReply, setOpenReply] = useState<string | null>(null)
  const [error, setError] = useState('')
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 回复提交 in-flight 锁，防连按重复提交 */
  const replyInflightRef = useRef<Set<string>>(new Set())

  const load = useCallback(() => {
    postsApi
      .list(30)
      .then((d) => setPosts(d.posts))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    load()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [load])

  /** 发完帖 10 秒后自动刷新一次——居民可能跑来回复 */
  const scheduleRefresh = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(load, 10_000)
  }

  const submitPost = async () => {
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    setError('')
    try {
      await postsApi.create(content)
      setDraft('')
      load()
      scheduleRefresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '没发出去，再试一次？')
    } finally {
      setSending(false)
    }
  }

  const submitReply = async (postId: string) => {
    const content = (replyDrafts[postId] ?? '').trim()
    if (!content || replyInflightRef.current.has(postId)) return
    replyInflightRef.current.add(postId)
    try {
      await postsApi.reply(postId, content)
      setReplyDrafts((d) => ({ ...d, [postId]: '' }))
      setOpenReply(null)
      load()
      scheduleRefresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '回复没送出去，再试一次？')
    } finally {
      replyInflightRef.current.delete(postId)
    }
  }

  return (
    <div className="max-w-2xl mx-auto relative">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="font-title text-3xl flex items-center gap-2">
          <Sofa className="w-7 h-7 text-qiule" />
          客厅
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          沙发很软，随便聊。居民们路过的时候会坐下来接话。
        </p>
      </motion.div>

      {/* 发帖框 */}
      {user ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="mt-5 bg-paper rounded-2xl shadow-card border border-warm-line p-4"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="今天有什么想碎碎念的？"
            rows={3}
            maxLength={1000}
            className="w-full resize-none bg-transparent outline-none text-sm leading-relaxed placeholder:text-ink-soft/60"
          />
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-warm-line">
            <span className="text-xs text-ink-soft/70">{draft.length}/1000</span>
            <button
              onClick={submitPost}
              disabled={!draft.trim() || sending}
              className="btn-press inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-crina text-white text-sm disabled:opacity-40 hover:bg-crina-deep"
            >
              <SendHorizonal className="w-4 h-4" />
              {sending ? '丢出去中…' : '丢到客厅'}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-anfeng">{error}</p>}
        </motion.div>
      ) : (
        user === null && (
          <div className="mt-5 bg-paper rounded-2xl shadow-card border border-warm-line p-4 text-sm text-ink-soft text-center">
            想加入碎碎念？<a href="/login" className="text-crina-deep hover:underline">敲个门</a>进来就能说话了。
          </div>
        )
      )}

      {/* 时间线 */}
      <div className="mt-6 space-y-4">
        {loaded && posts.length === 0 && (
          <EmptyState
            icon={Sofa}
            title="客厅还静悄悄的"
            hint="说点什么吧——今天的云、路边的鸟、没做完的梦，什么都可以。"
          />
        )}
        <AnimatePresence initial={false}>
          {posts.map((p, i) => (
            <motion.article
              key={p.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: Math.min(i * 0.04, 0.4) }}
              className="bg-paper rounded-2xl shadow-card border border-warm-line p-5"
            >
              <div className="flex items-center gap-2.5">
                <CharacterAvatar
                  name={p.author.name}
                  color={p.author.color ?? (p.author.type === 'user' ? '#8A8FC4' : undefined)}
                  avatarUrl={p.author.avatar_url}
                  size={36}
                />
                <div>
                  <span
                    className="font-medium text-sm"
                    style={{ color: p.author.color ?? undefined }}
                  >
                    {p.author.name}
                  </span>
                  <span className="ml-2 text-xs text-ink-soft">{relativeTime(p.created_at)}</span>
                </div>
              </div>
              <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-wrap">{p.content}</p>
              {p.image_url && (
                <ZoomableImage
                  src={p.image_url}
                  alt=""
                  className="mt-3 rounded-xl max-h-72 object-cover"
                />
              )}

              {/* 回复区 */}
              {p.replies.length > 0 && (
                <div className="mt-4 pl-3 border-l-2 space-y-3" style={{ borderColor: '#EAE3D8' }}>
                  {p.replies.map((r) => (
                    <div key={r.id} className="flex gap-2.5">
                      <CharacterAvatar
                        name={r.author.name}
                        color={r.author.color ?? (r.author.type === 'user' ? '#8A8FC4' : undefined)}
                        avatarUrl={r.author.avatar_url}
                        size={26}
                      />
                      <div className="min-w-0">
                        <span
                          className="text-xs font-medium"
                          style={{ color: r.author.color ?? undefined }}
                        >
                          {r.author.name}
                        </span>
                        <span className="ml-2 text-[11px] text-ink-soft/80">
                          {relativeTime(r.created_at)}
                        </span>
                        <p className="text-sm text-ink-soft leading-relaxed whitespace-pre-wrap">
                          {r.content}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {user && (
                <div className="mt-3">
                  {openReply === p.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={replyDrafts[p.id] ?? ''}
                        onChange={(e) =>
                          setReplyDrafts((d) => ({ ...d, [p.id]: e.target.value }))
                        }
                        onKeyDown={(e) =>
                          e.key === 'Enter' && !e.nativeEvent.isComposing && void submitReply(p.id)
                        }
                        placeholder="轻声回一句…"
                        maxLength={500}
                        className="flex-1 text-sm bg-cream rounded-full px-4 py-2 outline-none border border-warm-line focus:border-crina/50"
                      />
                      <button
                        onClick={() => void submitReply(p.id)}
                        className="btn-press p-2 rounded-full bg-crina text-white hover:bg-crina-deep"
                        aria-label="发送回复"
                      >
                        <SendHorizonal className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setOpenReply(p.id)}
                      className="text-xs text-ink-soft hover:text-crina-deep transition-colors"
                    >
                      回一句 →
                    </button>
                  )}
                </div>
              )}
            </motion.article>
          ))}
        </AnimatePresence>
      </div>

      <GarbageButton />
    </div>
  )
}

/** 彩蛋：翻翻安风的垃圾堆（扭蛋式动效） */
function GarbageButton() {
  const [state, setState] = useState<'idle' | 'shaking' | 'revealed'>('idle')
  const [item, setItem] = useState<GarbageItem | null>(null)

  const dig = async () => {
    if (state === 'shaking') return
    setState('shaking')
    setItem(null)
    try {
      const g = await spaceApi.garbage()
      // 摇一摇之后揭晓
      setTimeout(() => {
        setItem(g)
        setState('revealed')
      }, 900)
    } catch {
      setState('idle')
    }
  }

  return (
    <div className="fixed bottom-24 md:bottom-8 right-4 z-30 flex flex-col items-end gap-2">
      <AnimatePresence>
        {state === 'revealed' && item && (
          <motion.div
            initial={{ opacity: 0, scale: 0.6, rotate: -6, y: 20 }}
            animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            className="max-w-[240px] bg-paper rounded-2xl shadow-float border-2 border-anfeng/30 p-4"
          >
            <div className="flex items-center gap-1.5 text-xs text-anfeng font-medium">
              <Trash2 className="w-3.5 h-3.5" />
              安风的垃圾堆 · {item.tier === 'rare' ? '稀有！' : item.tier === 'epic' ? '传说！！' : '普通'}
            </div>
            <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{item.text}</p>
            <button
              onClick={() => setState('idle')}
              className="mt-2 text-xs text-ink-soft hover:text-anfeng"
            >
              放回去
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.button
        onClick={dig}
        animate={state === 'shaking' ? { rotate: [0, -8, 8, -8, 8, 0] } : {}}
        transition={{ duration: 0.6 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.92 }}
        className="btn-press flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-anfeng/90 text-white text-sm shadow-float"
      >
        <Trash2 className="w-4 h-4" />
        {state === 'shaking' ? '翻找中…' : '翻翻安风的垃圾堆'}
      </motion.button>
    </div>
  )
}
