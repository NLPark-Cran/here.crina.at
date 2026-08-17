import { Link } from 'react-router'
import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAuth } from '../store/auth'

/** 未登录时的温柔拦截：说明这里是什么，引导去登录 */
export function AuthGate({ roomName, children }: { roomName: string; children: ReactNode }) {
  const { user } = useAuth()

  if (user === undefined) {
    return (
      <div className="flex justify-center py-20 text-ink-soft text-sm">
        正在确认门有没有锁……
      </div>
    )
  }
  if (user === null) {
    return (
      <div className="max-w-sm mx-auto mt-16 bg-paper rounded-2xl shadow-card border border-warm-line p-8 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-crina/10 flex items-center justify-center mb-4">
          <Lock className="w-7 h-7 text-crina" />
        </div>
        <h2 className="font-title text-xl">这里是{roomName}</h2>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed">
          只有进了门的朋友才能进来哦。先去门厅敲个门， crina 会来迎接你的。
        </p>
        <Link
          to="/login"
          className="btn-press inline-block mt-6 px-6 py-2.5 rounded-full bg-crina text-white text-sm shadow-sm hover:bg-crina-deep"
        >
          去敲门
        </Link>
      </div>
    )
  }
  return <>{children}</>
}
