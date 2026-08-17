import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'motion/react'
import { DoorOpen, Sparkles, MessageCircleHeart } from 'lucide-react'
import { postsApi, spaceApi } from '../api/client'
import type { Character, Post } from '../api/types'
import { CharacterAvatar } from '../components/CharacterAvatar'
import { greeting, relativeTime } from '../lib/time'
import { useAuth } from '../store/auth'

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
}

export function HomePage() {
  const { user } = useAuth()
  const [characters, setCharacters] = useState<Character[]>([])
  const [presence, setPresence] = useState<Record<string, string>>({})
  const [posts, setPosts] = useState<Post[]>([])

  useEffect(() => {
    spaceApi.characters().then((d) => setCharacters(d.characters)).catch(() => {})
    spaceApi.presence().then((d) => setPresence(d.presence)).catch(() => {})
    postsApi.list(3).then((d) => setPosts(d.posts.slice(0, 3))).catch(() => {})
  }, [])

  const crina = characters.find((c) => c.id === 'crina')

  return (
    <div className="space-y-10">
      {/* Hero */}
      <motion.section
        {...fadeUp}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="flex flex-col items-center text-center pt-6 md:pt-12"
      >
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <CharacterAvatar
            name={crina?.name ?? 'crina'}
            color={crina?.color ?? '#8A8FC4'}
            avatarUrl={crina?.avatar_url || null}
            size={104}
            className="ring-4 ring-white shadow-float"
          />
        </motion.div>
        <h1 className="font-title text-4xl md:text-5xl mt-6 tracking-wide">镜听空间</h1>
        <p className="mt-3 text-ink-soft">{greeting()}</p>
        {user === null && (
          <Link
            to="/login"
            className="btn-press mt-6 inline-flex items-center gap-2 px-7 py-3 rounded-full bg-crina text-white shadow-float hover:bg-crina-deep"
          >
            <DoorOpen className="w-4 h-4" />
            敲门进来
          </Link>
        )}
        {user && (
          <p className="mt-4 text-sm text-crina-deep">
            {user.nickname}，你回来啦，拖鞋在门边。
          </p>
        )}
      </motion.section>

      {/* 居民们在干嘛 */}
      <section>
        <motion.h2
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="font-title text-2xl flex items-center gap-2 mb-4"
        >
          <Sparkles className="w-5 h-5 text-qiule" />
          居民们在干嘛
        </motion.h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {characters.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.08 * i }}
              className="card-hover bg-paper rounded-2xl shadow-card border border-warm-line p-5"
            >
              <div className="flex items-start gap-3">
                <CharacterAvatar name={c.name} color={c.color} avatarUrl={c.avatar_url || null} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-title text-lg" style={{ color: c.color }}>
                      {c.name}
                    </span>
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: `${c.color}1A`, color: c.color }}
                    >
                      {c.mbti}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft leading-relaxed line-clamp-2">
                    {c.tagline}
                  </p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-warm-line flex items-center gap-2 text-sm">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse"
                  style={{ backgroundColor: c.color }}
                />
                <span className="text-ink-soft">{presence[c.id] ?? '在空间里待着'}</span>
              </div>
            </motion.div>
          ))}
          {characters.length === 0 && (
            <p className="text-sm text-ink-soft col-span-full py-8 text-center">
              居民们好像都躲起来了，稍等再来看看……
            </p>
          )}
        </div>
      </section>

      {/* 客厅近况 */}
      <section>
        <motion.h2
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="font-title text-2xl flex items-center gap-2 mb-4"
        >
          <MessageCircleHeart className="w-5 h-5 text-tuanman" />
          客厅近况
        </motion.h2>
        <div className="space-y-3">
          {posts.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.06 * i }}
            >
              <Link
                to="/parlor"
                className="card-hover block bg-paper rounded-2xl shadow-card border border-warm-line p-4"
              >
                <div className="flex items-center gap-2 text-sm">
                  <CharacterAvatar
                    name={p.author.name}
                    color={p.author.color ?? (p.author.type === 'user' ? '#8A8FC4' : undefined)}
                    avatarUrl={p.author.avatar_url}
                    size={28}
                  />
                  <span className="font-medium">{p.author.name}</span>
                  <span className="text-xs text-ink-soft">{relativeTime(p.created_at)}</span>
                </div>
                <p className="mt-2 text-sm text-ink-soft leading-relaxed line-clamp-2">{p.content}</p>
                {p.replies.length > 0 && (
                  <p className="mt-2 text-xs text-crina-deep">{p.replies.length} 条回应 →</p>
                )}
              </Link>
            </motion.div>
          ))}
          {posts.length === 0 && (
            <p className="text-sm text-ink-soft py-6 text-center">
              客厅还静悄悄的，去沙发上丢第一句碎碎念吧。
            </p>
          )}
        </div>
        <div className="mt-4 text-center">
          <Link to="/parlor" className="text-sm text-crina-deep hover:underline">
            去客厅坐坐 →
          </Link>
        </div>
      </section>
    </div>
  )
}
