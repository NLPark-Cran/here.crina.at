import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { motion } from 'motion/react'
import { Bird, DoorOpen, Home, Newspaper } from 'lucide-react'
import { roomsApi, ApiError } from '../api/client'
import type { ArticleBrief, RoomProfile } from '../api/types'
import { CharacterAvatar } from '../components/CharacterAvatar'
import { relativeTime } from '../lib/time'
import { useAuth } from '../store/auth'

export function RoomPage() {
  const params = useParams()
  // /@xxx 走 App 的 * 兜底路由，handle 从通配值里剥出来（剥掉 @ 与末尾 /）
  const handle = params.handle ?? params['*']?.replace(/^@/, '').replace(/\/$/, '')
  const { user } = useAuth()
  const [room, setRoom] = useState<RoomProfile | null>(null)
  const [articles, setArticles] = useState<ArticleBrief[]>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!handle) return
    setLoaded(false)
    setError('')
    roomsApi
      .get(handle)
      .then((d) => {
        setRoom(d.room)
        setArticles(d.articles)
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '房间门打不开'))
      .finally(() => setLoaded(true))
  }, [handle])

  if (!loaded) {
    return <div className="py-20 text-center text-sm text-ink-soft">踮起脚往窗户里看…</div>
  }

  if (error || !room) {
    return (
      <div className="max-w-sm mx-auto mt-16 bg-paper rounded-2xl shadow-card border border-warm-line p-8 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-cream flex items-center justify-center mb-4">
          <DoorOpen className="w-7 h-7 text-ink-soft" />
        </div>
        <h2 className="font-title text-xl">{error || '这个房间还没有人住进来'}</h2>
        <p className="mt-3 text-sm text-ink-soft">也许地址写错了，也许 TA 还没搬来。</p>
        <Link to="/" className="inline-block mt-5 text-sm text-crina-deep hover:underline">
          回门厅 →
        </Link>
      </div>
    )
  }

  const isMine = user?.handle === room.handle

  return (
    <div className="max-w-3xl mx-auto">
      {/* 房主名片 */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-paper rounded-2xl shadow-card border border-warm-line p-6 flex items-center gap-4"
      >
        <CharacterAvatar name={room.nickname} avatarUrl={room.avatar_url} size={64} />
        <div className="min-w-0">
          <h1 className="font-title text-2xl flex items-center gap-2">
            <Home className="w-5 h-5 text-qiule" />
            {room.nickname}的房间
          </h1>
          <p className="mt-1 text-xs text-ink-soft">
            @{room.handle} · {room.relation_tier} · 住进来 {room.days} 天了
          </p>
        </div>
        {isMine && (
          <Link
            to="/settings"
            className="ml-auto shrink-0 text-xs text-ink-soft hover:text-crina-deep border border-warm-line rounded-full px-3 py-1.5"
          >
            布置房间 →
          </Link>
        )}
      </motion.div>

      {/* 文章架 */}
      <div className="mt-6">
        <h2 className="font-title text-lg flex items-center gap-2 text-ink">
          <Newspaper className="w-4.5 h-4.5 text-crina" />
          TA 的文章架
        </h2>
        {articles.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft/70 text-center py-10 bg-cream/40 rounded-2xl border border-dashed border-warm-line">
            架子还空着——等 TA 写了第一篇公开的文章，就会摆在这里。
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {articles.map((a, i) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: Math.min(i * 0.05, 0.4) }}
              >
                <Link
                  to={`/p/${a.id}`}
                  className="block bg-paper rounded-2xl shadow-card border border-warm-line p-5 hover:shadow-float transition-shadow"
                >
                  <div className="flex items-center gap-2">
                    {a.kind === 'birdnote' && <Bird className="w-4 h-4 text-qiule shrink-0" />}
                    <h3 className="font-title text-lg truncate">{a.title}</h3>
                  </div>
                  {a.summary && <p className="mt-1.5 text-sm text-ink-soft line-clamp-2">{a.summary}</p>}
                  <p className="mt-2 text-xs text-ink-soft/70">
                    {relativeTime(a.created_at)} · {a.views} 次阅读
                  </p>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* 未登录引导 */}
      {user === null && (
        <p className="mt-8 text-center text-sm text-ink-soft">
          想拥有自己的小房间？<a href="/login" className="text-crina-deep hover:underline">敲个门</a>搬进来吧。
        </p>
      )}
    </div>
  )
}
