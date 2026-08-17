import { motion } from 'motion/react'
import { DoorOpen } from 'lucide-react'
import { Navigate } from 'react-router'
import { useAuth } from '../store/auth'

export function LoginPage() {
  const { user } = useAuth()

  if (user) return <Navigate to="/" replace />

  return (
    <div className="flex flex-col items-center justify-center pt-14 md:pt-24 text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-sm w-full bg-paper rounded-3xl shadow-float border border-warm-line p-8"
      >
        <motion.div
          animate={{ rotate: [0, -4, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-crina to-crina-deep flex items-center justify-center shadow-float"
        >
          <DoorOpen className="w-8 h-8 text-white" />
        </motion.div>
        <h1 className="font-title text-2xl mt-5">敲敲门，进来坐</h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed">
          镜听空间是 crina 和居民们的小屋。
          <br />
          用观猹账号登录，门就开了。
        </p>
        <a
          href="/api/auth/watcha/login"
          className="btn-press mt-7 block w-full py-3 rounded-full bg-crina text-white shadow-float hover:bg-crina-deep"
        >
          用观猹账号登录
        </a>
        <p className="mt-4 text-xs text-ink-soft/80 leading-relaxed">
          登录只用来认出你是谁；你的资料不会被拿去做别的事。
          <br />
          没有账号的话，登录页上会引导你注册一个。
        </p>
      </motion.div>
    </div>
  )
}
