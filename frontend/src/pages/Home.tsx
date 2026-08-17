import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'motion/react'
import { DoorOpen, Sparkles, MessageCircleHeart } from 'lucide-react'
import { postsApi, probeImage, spaceApi } from '../api/client'
import type { Character, Post } from '../api/types'
import { CharacterAvatar } from '../components/CharacterAvatar'
import { WardrobeSection } from '../components/Wardrobe'
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
  const [hasHallHero, setHasHallHero] = useState(false)
  const [charsFailed, setCharsFailed] = useState(false)
  const [postsFailed, setPostsFailed] = useState(false)

  useEffect(() => {
    spaceApi
      .characters()
      .then((d) => setCharacters(d.characters))
      .catch(() => setCharsFailed(true))
    spaceApi.presence().then((d) => setPresence(d.presence)).catch(() => {})
    postsApi
      .list(3)
      .then((d) => setPosts(d.posts.slice(0, 3)))
      .catch(() => setPostsFailed(true))
    probeImage('/assets/hall_hero.webp').then(setHasHallHero)
  }, [])

  const crina = characters.find((c) => c.id === 'crina')

  return (
    <div className="space-y-10">
      {/* Hero */}
      <motion.section
        {...fadeUp}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative overflow-hidden rounded-3xl border border-warm-line/60 shadow-card"
      >
        {/* 门厅氛围背景（视频优先，图片兑底，低透明度 + 柔光叠加保证文字可读） */}
        {hasHallHero && (
          <>
            <video
              src="/assets/hall_ambience.mp4"
              poster="/assets/hall_hero.webp"
              preload="metadata"
              autoPlay
              muted
              loop
              playsInline
              aria-hidden
              onError={(e) => {
                // 视频缺失/加载失败时隐藏，由 poster 外的渐变背景免底，不露黑块
                e.currentTarget.style.display = 'none'
              }}
              className="absolute inset-0 w-full h-full object-cover opacity-25 mix-blend-soft-light pointer-events-none select-none"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-cream/40 via-cream/70 to-cream pointer-events-none" />
          </>
        )}
        <div className="relative flex flex-col md:flex-row items-center gap-6 md:gap-10 px-6 md:px-12 pt-8 md:pt-10 pb-8">
          <div className="flex-1 text-center md:text-left order-2 md:order-1">
            <h1 className="font-title text-4xl md:text-5xl tracking-wide">镜听空间</h1>
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
          </div>
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            className="order-1 md:order-2 shrink-0"
          >
            <img
              src="/assets/crina_full.webp"
              alt={crina?.name ?? 'crina'}
              className="h-56 md:h-72 w-auto object-contain drop-shadow-[0_12px_28px_rgba(138,143,196,0.35)]"
              onError={(e) => {
                // 立绘不可用时回退到圆形头像占位
                const el = e.currentTarget
                el.style.display = 'none'
                el.nextElementSibling?.classList.remove('hidden')
              }}
            />
            <div className="hidden">
              <CharacterAvatar
                name={crina?.name ?? 'crina'}
                color={crina?.color ?? '#8A8FC4'}
                avatarUrl={crina?.avatar_url || null}
                size={104}
                className="ring-4 ring-white shadow-float"
              />
            </div>
          </motion.div>
        </div>
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
              {charsFailed
                ? '没连上小屋——网络可能打了个盹，刷新试试。'
                : '居民们好像都躲起来了，稍等再来看看……'}
            </p>
          )}
        </div>
      </section>

      {/* crina 的衣橱与小金库 */}
      <WardrobeSection />

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
              {postsFailed
                ? '没连上客厅——网络可能打了个盹，刷新试试。'
                : '客厅还静悄悄的，去沙发上丢第一句碎碎念吧。'}
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
