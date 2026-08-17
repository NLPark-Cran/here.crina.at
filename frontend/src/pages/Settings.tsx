import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import {
  BatteryCharging,
  Bell,
  CalendarDays,
  DoorOpen,
  HardDriveDownload,
  KeyRound,
  Loader2,
  LogOut,
  PlugZap,
  Unplug,
  UserRound,
} from 'lucide-react'
import { authApi, byokApi, importApi, ApiError } from '../api/client'
import type { EmindStatus, User } from '../api/types'
import { AuthGate } from '../components/AuthGate'
import { CharacterAvatar } from '../components/CharacterAvatar'
import { useAuth } from '../store/auth'

export function SettingsPage() {
  return (
    <AuthGate roomName="设置">
      <SettingsInner />
    </AuthGate>
  )
}

function SettingsInner() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [me, setMe] = useState<User | null>(user ?? null)
  const [toast, setToast] = useState('')
  const [notifyLetter, setNotifyLetter] = useState(true)
  const [notifyEvent, setNotifyEvent] = useState(true)
  const [notifyHint, setNotifyHint] = useState('')

  useEffect(() => {
    authApi.me().then(setMe).catch(() => {})
  }, [])

  // OAuth 回来后的成功提示
  useEffect(() => {
    if (searchParams.get('byok') === 'ok') {
      setToast('词元蓄电池接好啦！干活聊天都用你自己的词元。')
      setSearchParams({}, { replace: true })
    } else if (searchParams.get('google') === 'ok') {
      setToast('Google 连好啦！日历和云文档都通上了。')
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const toggle = (which: 'letter' | 'event') => {
    if (which === 'letter') setNotifyLetter((v) => !v)
    else setNotifyEvent((v) => !v)
    setNotifyHint('先记住你的选择啦，通知功能接通后就生效')
    setTimeout(() => setNotifyHint(''), 3000)
  }

  const doLogout = async () => {
    await logout()
    navigate('/')
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      {/* toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[calc(100%-2rem)] bg-paper rounded-2xl shadow-float border border-baixu/30 px-5 py-3.5 text-sm text-center"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.h1
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="font-title text-3xl"
      >
        设置
      </motion.h1>

      {/* 个人信息 */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.06 }}
        className="bg-paper rounded-2xl shadow-card border border-warm-line p-5"
      >
        <h2 className="font-title text-lg flex items-center gap-2 mb-4">
          <UserRound className="w-5 h-5 text-crina" />
          你是谁
        </h2>
        {me ? (
          <div className="flex items-center gap-4">
            <CharacterAvatar name={me.nickname} color="#8A8FC4" avatarUrl={me.avatar_url} size={56} />
            <div>
              <div className="font-medium text-lg flex items-center gap-2">
                {me.nickname}
                {me.is_owner && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-qiule/15 text-qiule">小屋主人</span>
                )}
              </div>
              <div className="mt-1 text-sm text-ink-soft">
                和居民们的关系：{me.relation_tier || '新朋友'}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">正在翻名册……</p>
        )}
      </motion.section>

      {/* 观猹账号 */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.09 }}
        className="bg-paper rounded-2xl shadow-card border border-warm-line p-5"
      >
        <h2 className="font-title text-lg flex items-center gap-2 mb-2">
          <KeyRound className="w-5 h-5 text-guagua" />
          观猹账号
        </h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          已通过观猹账号登录，这扇门认得你。换设备也一样，敲门就能进。
        </p>
        <div className="mt-3 inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-baixu/12 text-baixu">
          <span className="w-1.5 h-1.5 rounded-full bg-baixu" />
          连接正常
        </div>
      </motion.section>

      <ByokCard />
      <GoogleCard />
      <EmindCard />

      {/* 通知偏好 */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.18 }}
        className="bg-paper rounded-2xl shadow-card border border-warm-line p-5"
      >
        <h2 className="font-title text-lg flex items-center gap-2 mb-4">
          <Bell className="w-5 h-5 text-tuanman" />
          想被怎么提醒
        </h2>
        <div className="space-y-3">
          <ToggleRow
            label="有回信时告诉我"
            desc="信箱收到居民回信时戳你一下"
            on={notifyLetter}
            onToggle={() => toggle('letter')}
          />
          <ToggleRow
            label="日历到点提醒我"
            desc="事件快到时间时提醒你"
            on={notifyEvent}
            onToggle={() => toggle('event')}
          />
        </div>
        {notifyHint && <p className="mt-3 text-xs text-baixu">{notifyHint}</p>}
      </motion.section>

      {/* 退出 */}
      <motion.button
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.22 }}
        onClick={doLogout}
        className="btn-press w-full bg-paper rounded-2xl shadow-card border border-warm-line p-4 flex items-center justify-center gap-2 text-anfeng hover:bg-anfeng/5"
      >
        <LogOut className="w-4 h-4" />
        先回去了（退出登录）
      </motion.button>
      <p className="text-center text-xs text-ink-soft/70 flex items-center justify-center gap-1 pb-4">
        <DoorOpen className="w-3.5 h-3.5" />
        门不锁，随时回来。
      </p>
    </div>
  )
}

/** 词元蓄电池（TokenDance BYOK） */
function ByokCard() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    byokApi.status().then((s) => setConnected(s.connected)).catch(() => {})
  }, [])

  const disconnect = async () => {
    setBusy(true)
    setError('')
    try {
      await byokApi.disconnect()
      setConnected(false)
      setConfirming(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '没拔掉，再试一次？')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.12 }}
      className="bg-gradient-to-br from-crina/10 to-baixu/10 rounded-2xl border border-crina/20 p-5"
    >
      <h2 className="font-title text-lg flex items-center gap-2 mb-2">
        <BatteryCharging className="w-5 h-5 text-crina-deep" />
        词元蓄电池
      </h2>
      {connected === null ? (
        <p className="text-sm text-ink-soft">正在看电池仓……</p>
      ) : connected ? (
        <>
          <p className="text-sm text-ink-soft leading-relaxed">
            已接上你自己的 TokenDance 蓄电池，干活聊天都用自己的词元，不限量。
          </p>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-baixu/15 text-baixu">
              <PlugZap className="w-3.5 h-3.5" />
              已接上 · 电量自己说了算
            </span>
            {confirming ? (
              <span className="inline-flex items-center gap-2 text-xs">
                <span className="text-ink-soft">确定要拔掉吗？之后就用回小屋的公用电量啦。</span>
                <button
                  onClick={disconnect}
                  disabled={busy}
                  className="btn-press px-3 py-1 rounded-full bg-anfeng text-white disabled:opacity-50"
                >
                  {busy ? '拔电池中…' : '确定拔掉'}
                </button>
                <button onClick={() => setConfirming(false)} className="text-ink-soft hover:text-ink">
                  先不拔
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="btn-press inline-flex items-center gap-1 text-xs text-ink-soft hover:text-anfeng"
              >
                <Unplug className="w-3.5 h-3.5" />
                拔掉
              </button>
            )}
          </div>
          {error && <p className="mt-2 text-xs text-anfeng">{error}</p>}
        </>
      ) : (
        <>
          <p className="text-sm text-ink-soft leading-relaxed">
            聊天、语音、干活都会用到「词元」。小屋每天备了一份公用的电量；
            接上你自己的 TokenDance 蓄电池（BYOK），想用多少用多少。
          </p>
          <a
            href="/api/byok/connect"
            className="btn-press mt-4 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-crina text-white text-sm hover:bg-crina-deep shadow-sm"
          >
            <PlugZap className="w-4 h-4" />
            接上蓄电池
          </a>
        </>
      )}
    </motion.section>
  )
}

/** Google 连接 */
function GoogleCard() {
  const [status, setStatus] = useState<{ connected: boolean; available: boolean } | null>(null)

  useEffect(() => {
    byokApi.googleStatus().then(setStatus).catch(() => {})
  }, [])

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.14 }}
      className="bg-paper rounded-2xl shadow-card border border-warm-line p-5"
    >
      <h2 className="font-title text-lg flex items-center gap-2 mb-2">
        <CalendarDays className="w-5 h-5 text-xianmo" />
        Google 连接
      </h2>
      {status === null ? (
        <p className="text-sm text-ink-soft">正在敲门问……</p>
      ) : !status.available ? (
        <p className="text-sm text-ink-soft leading-relaxed">
          以后连上 Google，crina 就能直接帮你读写云文档、管日历。站主还没开通，敬请期待。
        </p>
      ) : status.connected ? (
        <>
          <p className="text-sm text-ink-soft leading-relaxed">
            已经连上啦——委托 crina 读写 Google 文档、安排日历都可以直接上手。
          </p>
          <span className="mt-3 inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-baixu/12 text-baixu">
            <span className="w-1.5 h-1.5 rounded-full bg-baixu" />
            已连接
          </span>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-soft leading-relaxed">
            连上 Google 账号后，crina 可以帮你读写云文档、把日历事件直接排进 Google 日历。
          </p>
          <a
            href="/api/byok/google/connect"
            className="btn-press mt-4 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-xianmo text-white text-sm hover:opacity-90 shadow-sm"
          >
            <PlugZap className="w-4 h-4" />
            连接 Google
          </a>
        </>
      )}
    </motion.section>
  )
}

/** 从 emind 搬家 */
function EmindCard() {
  const [status, setStatus] = useState<EmindStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    importApi.emindStatus().then(setStatus).catch(() => {})
  }, [])

  const start = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await importApi.emindImport()
      setResult(res.message || `搬好啦：${res.imported.conversations} 段对话、${res.imported.memories} 条记忆。`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '搬到一半卡住了，稍后再试？')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.16 }}
      className="bg-paper rounded-2xl shadow-card border border-warm-line p-5"
    >
      <h2 className="font-title text-lg flex items-center gap-2 mb-2">
        <HardDriveDownload className="w-5 h-5 text-qiule" />
        从 emind 搬家
      </h2>
      {status === null ? (
        <p className="text-sm text-ink-soft">正在给旧家打电话……</p>
      ) : result ? (
        <>
          <p className="text-sm text-ink-soft leading-relaxed">{result}</p>
          <Link to="/archive" className="mt-3 inline-block text-sm text-crina-deep hover:underline">
            去档案馆看看搬来的记忆 →
          </Link>
        </>
      ) : status.available ? (
        <>
          <p className="text-sm text-ink-soft leading-relaxed">
            在旧家 emind 找到了「{status.emind_name}」的行李：
            {status.conversations ?? 0} 段对话、{status.messages ?? 0} 条消息、{status.memories ?? 0} 条记忆。
            搬过来，crina 会替旧家继续记得你。
          </p>
          <button
            onClick={start}
            disabled={busy}
            className="btn-press mt-4 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-qiule text-white text-sm hover:opacity-90 shadow-sm disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDriveDownload className="w-4 h-4" />}
            {busy ? '搬家中，别关门…' : '开始搬家'}
          </button>
          {error && <p className="mt-2 text-xs text-anfeng">{error}</p>}
        </>
      ) : (
        <p className="text-sm text-ink-soft leading-relaxed">
          {status.reason ?? '旧家那边暂时没什么可搬的。'}
        </p>
      )}
    </motion.section>
  )
}

function ToggleRow({
  label,
  desc,
  on,
  onToggle,
}: {
  label: string
  desc: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <button onClick={onToggle} className="w-full flex items-center gap-3 text-left">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-ink-soft mt-0.5">{desc}</div>
      </div>
      <div
        className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 ${
          on ? 'bg-crina' : 'bg-warm-line'
        }`}
      >
        <motion.div
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          className={`w-5 h-5 rounded-full bg-white shadow-sm ${on ? 'ml-auto' : ''}`}
        />
      </div>
    </button>
  )
}
