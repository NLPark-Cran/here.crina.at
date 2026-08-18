import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Mailbox as MailboxIcon, PenLine, SendHorizonal, X } from 'lucide-react'
import { ApiError, lettersApi, spaceApi } from '../api/client'
import type { Character, Letter } from '../api/types'
import { AuthGate } from '../components/AuthGate'
import { CharacterAvatar } from '../components/CharacterAvatar'
import { EmptyState } from '../components/EmptyState'
import { Markdown } from '../components/Markdown'
import { relativeTime } from '../lib/time'

export function MailboxPage() {
  return (
    <AuthGate roomName="信箱">
      <MailboxInner />
    </AuthGate>
  )
}

function MailboxInner() {
  const [letters, setLetters] = useState<Letter[]>([])
  const [loaded, setLoaded] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [characters, setCharacters] = useState<Character[]>([])
  const [toChar, setToChar] = useState('crina')
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')
  const [sending, setSending] = useState(false)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(() => {
    lettersApi
      .list()
      .then((d) => setLetters(d.letters))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    load()
    spaceApi.characters().then((d) => setCharacters(d.characters)).catch(() => {})
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [load])

  const openLetter = (letter: Letter) => {
    setOpenId(openId === letter.id ? null : letter.id)
    if (!letter.read) {
      lettersApi.read(letter.id).catch(() => {})
      setLetters((ls) => ls.map((l) => (l.id === letter.id ? { ...l, read: true } : l)))
    }
  }

  const send = async () => {
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    try {
      const res = await lettersApi.send(toChar, content)
      setNotice(res.message || '信已经寄出去啦，回信稍后就到')
      setDraft('')
      setWriting(false)
      // 回信稍后到，10 秒后刷新
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => {
        load()
        setNotice((n) => (n ? n + '。刷新看看有没有回信？' : ''))
      }, 10_000)
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : '信没寄出去，再试一次？')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-end justify-between"
      >
        <div>
          <h1 className="font-title text-3xl flex items-center gap-2">
            <MailboxIcon className="w-7 h-7 text-tuanman" />
            信箱
          </h1>
          <p className="mt-2 text-sm text-ink-soft">居民们的来信，都躺在门口的木信箱里。</p>
        </div>
        <button
          onClick={() => setWriting((v) => !v)}
          className="btn-press inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-crina text-white text-sm hover:bg-crina-deep shadow-sm"
        >
          <PenLine className="w-4 h-4" />
          写信
        </button>
      </motion.div>

      {notice && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 text-sm text-center text-baixu bg-baixu/10 rounded-xl py-2.5 px-4"
        >
          {notice}
        </motion.p>
      )}

      {/* 写信面板 */}
      <AnimatePresence>
        {writing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-5 bg-paper rounded-2xl shadow-card border border-warm-line p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="font-title">寄给：</span>
                <button onClick={() => setWriting(false)} className="p-1 rounded-full hover:bg-cream" aria-label="收起">
                  <X className="w-4 h-4 text-ink-soft" />
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {characters.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setToChar(c.id)}
                    className={`btn-press shrink-0 flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${
                      toChar === c.id ? 'bg-crina/12 ring-1 ring-crina/40' : 'hover:bg-cream'
                    }`}
                  >
                    <CharacterAvatar name={c.name} color={c.color} avatarUrl={c.avatar_url || null} size={36} />
                    <span className="text-xs text-ink-soft">{c.name}</span>
                  </button>
                ))}
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="慢慢写，手写信不着急…"
                rows={5}
                maxLength={2000}
                className="mt-2 w-full resize-none letter-paper rounded-xl px-4 py-3 text-[15px] leading-[31px] outline-none border border-warm-line focus:border-crina/50"
              />
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-ink-soft/70">{draft.length}/2000</span>
                <button
                  onClick={send}
                  disabled={!draft.trim() || sending}
                  className="btn-press inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-crina text-white text-sm disabled:opacity-40 hover:bg-crina-deep"
                >
                  <SendHorizonal className="w-4 h-4" />
                  {sending ? '塞进信箱中…' : '寄出'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 来信列表 */}
      <div className="mt-6 space-y-3">
        {loaded && letters.length === 0 && (
          <EmptyState
            icon={MailboxIcon}
            title="信箱里还空空的"
            hint="给某位居民写第一封信吧——ta 会把回信仔细折好，放进你的信箱。"
          />
        )}
        {letters.map((l, i) => {
          const open = openId === l.id
          return (
            <motion.div
              key={l.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: Math.min(i * 0.05, 0.4) }}
              className="bg-paper rounded-2xl shadow-card border border-warm-line overflow-hidden"
            >
              <button
                onClick={() => openLetter(l)}
                className="w-full flex items-center gap-3 p-4 text-left"
              >
                <CharacterAvatar name={l.character.name} color={l.character.color} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {!l.read && <span className="w-2 h-2 rounded-full bg-tuanman shrink-0" />}
                    <span className={`truncate ${l.read ? 'text-ink-soft' : 'font-medium'}`}>
                      {l.title || `${l.character.name} 的来信`}
                    </span>
                  </div>
                  <div className="text-xs text-ink-soft/80 mt-0.5">
                    {l.character.name} · {relativeTime(l.created_at)}
                  </div>
                </div>
                <span className="text-xs text-crina-deep shrink-0">{open ? '折起来' : '拆开'}</span>
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <div className="letter-paper mx-4 mb-4 rounded-xl border border-warm-line px-5 py-4">
                      <div className="text-[15px] leading-[31px] text-ink">
                        <Markdown content={l.content} />
                      </div>
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
