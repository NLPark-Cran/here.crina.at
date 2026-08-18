import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'motion/react'
import { BedDouble, MoonStar } from 'lucide-react'
import { chatApi, spaceApi } from '../api/client'
import { useAuth } from '../store/auth'

/** 卧室：镜听的房间。深夜留灯，可以说晚安 */
export function BedroomPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [crinaStatus, setCrinaStatus] = useState('')
  const [going, setGoing] = useState(false)
  const hour = new Date().getHours()
  const lateNight = hour >= 22 || hour < 6

  useEffect(() => {
    spaceApi.presence().then((d) => setCrinaStatus(d.presence['crina'] ?? '')).catch(() => {})
  }, [])

  const sayGoodnight = async () => {
    if (going) return
    setGoing(true)
    try {
      const conv = await chatApi.create('crina', 'auto')
      navigate(`/chat/${conv.id}`)
    } catch {
      navigate('/chat')
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative rounded-2xl overflow-hidden shadow-card border border-warm-line"
      >
        <img
          src="/assets/corner_bedroom.webp"
          alt="卧室氛围角"
          className="w-full aspect-[21/9] object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
          <h1 className="font-title text-3xl flex items-center gap-2">
            <BedDouble className="w-7 h-7" />
            卧室
          </h1>
          <p className="mt-1.5 text-sm text-white/85">
            {lateNight ? '灯为你留着。被角有人掖过了。' : '卧室静悄悄的，被子晒得有太阳的味道。'}
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="mt-5 bg-paper rounded-2xl shadow-card border border-warm-line p-6 text-center"
      >
        {crinaStatus && (
          <p className="text-sm text-ink-soft">
            crina 此刻：{crinaStatus}
          </p>
        )}
        <p className="mt-1 text-sm text-ink-soft leading-relaxed">
          {lateNight
            ? '夜这么深了，要不要去说一声晚安？'
            : '这是你的房间——你不在的时候，居民们会替你把它收拾整齐。'}
        </p>
        {user ? (
          <button
            onClick={() => void sayGoodnight()}
            disabled={going}
            className="btn-press mt-4 inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-xianmo text-white text-sm shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            <MoonStar className="w-4 h-4" />
            {going ? '去找 crina…' : lateNight ? '跟 crina 说晚安' : '去和 crina 待一会儿'}
          </button>
        ) : (
          user === null && (
            <p className="mt-4 text-sm text-ink-soft">
              <a href="/login" className="text-crina-deep hover:underline">敲个门</a>进来，卧室才认你。
            </p>
          )
        )}
      </motion.div>
    </div>
  )
}
