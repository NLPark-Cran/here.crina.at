import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { motion, useScroll, useTransform } from 'motion/react'
import { DoorOpen, Sparkles, MessageCircleHeart } from 'lucide-react'
import { postsApi, probeImage, spaceApi } from '../api/client'
import type { Character, Post } from '../api/types'
import { CharacterAvatar } from '../components/CharacterAvatar'
import { HouseMap } from '../components/HouseMap'
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

  // 滚动视差：场景随滚动轻微放大、上移，前景（文字/立绘）飘得更快一点
  const heroRef = useRef<HTMLElement | null>(null)
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  })
  const sceneScale = useTransform(scrollYProgress, [0, 1], [1, 1.08])
  const sceneY = useTransform(scrollYProgress, [0, 1], ['0%', '10%'])
  const fgY = useTransform(scrollYProgress, [0, 1], ['0%', '26%'])

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
    <div>
      {/* Hero：步入小屋的整幅场景 */}
      <motion.section
        ref={heroRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="relative left-1/2 -translate-x-1/2 -mt-6 w-screen h-[78vh] min-h-[540px] overflow-hidden"
      >
        {/* 场景层：视频铺满 + 暖色 scrim（视差：随滚动轻微放大、上移） */}
        <motion.div style={{ scale: sceneScale, y: sceneY }} className="absolute inset-0">
          {hasHallHero ? (
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
                // 视频缺失/加载失败时隐藏，由暖色兑底渐变接管，不露黑块
                e.currentTarget.style.display = 'none'
              }}
              className="w-full h-full object-cover pointer-events-none select-none"
            />
          ) : (
            // 探测失败时的暖色兑底
            <div
              className="w-full h-full"
              style={{
                background:
                  'radial-gradient(60rem 40rem at 75% 30%, rgba(138,143,196,0.35), transparent 65%), radial-gradient(50rem 36rem at 15% 75%, rgba(201,154,91,0.28), transparent 65%), var(--color-cream)',
              }}
            />
          )}
          {/* scrim：底部与左侧轻压暖（克制，别把画面罩灰） */}
          <div className="absolute inset-0 bg-gradient-to-t from-cream via-cream/15 to-transparent pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-r from-cream/60 via-cream/15 to-transparent pointer-events-none" />
        </motion.div>

        {/* 左侧文字：垂直居中偏下 */}
        <motion.div
          style={{ y: fgY }}
          className="relative h-full max-w-5xl mx-auto px-6 flex items-end md:items-center"
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
            className="pb-24 md:pb-0 md:-mt-8 max-w-md"
          >
            <h1 className="font-title text-4xl md:text-6xl tracking-wide drop-shadow-[0_2px_12px_rgba(250,247,242,0.9)]">
              镜听空间
            </h1>
            <p className="mt-3 text-ink-soft md:text-lg">{greeting()}</p>
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
          </motion.div>
        </motion.div>

        {/* crina 透明立绘：站在场景右侧、底部对齐，像在门口迎接 */}
        <motion.div
          style={{ y: fgY }}
          className="absolute bottom-0 right-1 md:right-[6%] h-[40vh] md:h-[68vh] pointer-events-none"
        >
          {/* 脚下椭圆柔光 */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[78%] h-10 rounded-[50%] bg-crina/35 blur-2xl" />
          <motion.div
            animate={{ y: [0, -9, 0] }}
            transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
            className="relative h-full"
          >
            <img
              src="/assets/crina_full.webp?v=2"
              alt={crina?.name ?? 'crina'}
              className="h-full w-auto object-contain drop-shadow-[0_18px_32px_rgba(61,74,107,0.35)]"
              onError={(e) => {
                // 立绘不可用时回退到圆形头像占位
                const el = e.currentTarget
                el.style.display = 'none'
                el.nextElementSibling?.classList.remove('hidden')
              }}
            />
            <div className="hidden absolute bottom-4 left-1/2 -translate-x-1/2">
              <CharacterAvatar
                name={crina?.name ?? 'crina'}
                color={crina?.color ?? '#8A8FC4'}
                avatarUrl={crina?.avatar_url || null}
                size={104}
                className="ring-4 ring-white shadow-float"
              />
            </div>
          </motion.div>
        </motion.div>
      </motion.section>

      {/* 内容区：圆角卡片组从场景下缘滑进来，制造“往里走”的层次 */}
      <div className="relative z-10 -mt-14 rounded-t-3xl bg-cream border-t border-warm-line/70 shadow-[0_-16px_40px_rgba(90,80,60,0.10)] px-1 md:px-2 pt-8 space-y-10">
      {/* 小屋剖面地图 */}
      <HouseMap />

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
                    {c.status_text && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-cream border border-warm-line text-ink-soft">
                        {c.status_text}
                      </span>
                    )}
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
    </div>
  )
}
