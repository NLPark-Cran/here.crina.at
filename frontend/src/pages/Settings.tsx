import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import {
  BatteryCharging,
  CalendarDays,
  DoorOpen,
  Globe,
  HardDriveDownload,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  MailCheck,
  MessageCircleMore,
  PlugZap,
  Unplug,
  UserRound,
} from 'lucide-react'
import { authApi, byokApi, importApi, settingsApi, ApiError } from '../api/client'
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

  const doLogout = async () => {
    await logout()
    navigate('/')
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[calc(100%-2rem)] bg-paper/85 backdrop-blur-md rounded-2xl shadow-float border border-baixu/30 px-5 py-3.5 text-sm text-center"
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
        <p className="mt-2 text-xs text-ink-soft/80 leading-relaxed">
          头像和昵称在{" "}
          <a href="https://watcha.cn/" target="_blank" rel="noreferrer" className="text-crina-deep underline underline-offset-2">
            观猹（watcha.cn）
          </a>{" "}
          那边改，改完这里会跟着变。
        </p>
        <div className="mt-3 inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-baixu/12 text-baixu">
          <span className="w-1.5 h-1.5 rounded-full bg-baixu" />
          连接正常
        </div>
      </motion.section>

      <EmailCard />
      <ByokCard />
      <GoogleCard />
      <EmindCard />

      {/* 通知偏好（真实生效的开关在「邮箱绑定」卡里） */}
      <TimezoneCard />

      <HandleCard />

      <AsideCard />

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

/** 房间地址：/@handle 公开小窝的唯一标识 */
function HandleCard() {
  const [handle, setHandle] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    authApi.me().then((m) => {
      setHandle(m.handle ?? null)
      setDraft(m.handle ?? '')
    }).catch(() => {})
  }, [])

  const save = async () => {
    const h = draft.trim().toLowerCase()
    if (!h || saving) return
    setSaving(true)
    setMsg(null)
    try {
      const r = await settingsApi.setHandle(h)
      setHandle(r.handle)
      setDraft(r.handle)
      setMsg({ ok: true, text: '门牌换好啦' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : '没换成，再试一次？' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="bg-paper rounded-2xl shadow-card border border-warm-line p-5"
    >
      <h2 className="font-title text-lg flex items-center gap-2">
        <DoorOpen className="w-5 h-5 text-qiule" />
        你的房间门牌
      </h2>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">
        朋友们能用这个地址路过你的小房间，看看你公开的文章。
      </p>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 flex items-center bg-cream/60 rounded-xl border border-warm-line px-3 py-2 focus-within:border-crina/50">
          <span className="text-xs text-ink-soft/70 shrink-0">here.crina.at/@</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase())}
            maxLength={32}
            placeholder="3-32 位小写字母数字"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm"
          />
        </div>
        <button
          onClick={() => void save()}
          disabled={!draft.trim() || draft.trim() === (handle ?? '') || saving}
          className="btn-press px-4 py-2 rounded-full bg-crina text-white text-sm disabled:opacity-40 hover:bg-crina-deep"
        >
          {saving ? '换牌中…' : '换门牌'}
        </button>
      </div>
      {msg && (
        <p className={`mt-2 text-xs ${msg.ok ? 'text-qiule' : 'text-anfeng'}`}>{msg.text}</p>
      )}
      {handle && (
        <p className="mt-2 text-xs text-ink-soft/70">
          现在你的房间在{' '}
          <Link to={`/@${handle}`} className="text-crina-deep hover:underline">
            here.crina.at/@{handle}
          </Link>
        </p>
      )}
    </motion.section>
  )
}

/** 居民的小声嘀咕（蛐蛐）总开关：本机设置，存 localStorage，私聊页挂载时读取 */
function AsideCard() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem('crina_aside_enabled') !== '0'
    } catch {
      return true
    }
  })

  const toggle = () => {
    const next = !on
    setOn(next)
    try {
      localStorage.setItem('crina_aside_enabled', next ? '1' : '0')
    } catch {
      /* 隐私模式写不进去就算了 */
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.21 }}
      className="bg-paper rounded-2xl shadow-card border border-warm-line p-5"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-title text-lg flex items-center gap-2">
            <MessageCircleMore className="w-5 h-5 text-xianmo" />
            居民的小声嘀咕
          </h2>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">
            私聊时，居民会在正文下面附一句只说给自己听的内心独白。关掉就只留正文。
          </p>
        </div>
        <button
          onClick={toggle}
          role="switch"
          aria-checked={on}
          className={`btn-press shrink-0 w-11 h-6 rounded-full transition-colors relative ${
            on ? 'bg-crina' : 'bg-warm-line'
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
              on ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>
    </motion.section>
  )
}

/** 邮箱绑定：观猹没绑邮箱的用户也能收信 */
function EmailCard() {
  const [me, setMe] = useState<User | null>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'input' | 'code'>('input')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [notifyOn, setNotifyOn] = useState(false)

  useEffect(() => {
    authApi.me().then((u) => {
      setMe(u)
      setNotifyOn(Boolean(u.notify_email))
    }).catch(() => {})
  }, [])

  const sendCode = async () => {
    if (!email.trim() || busy) return
    setBusy(true)
    setError('')
    setMsg('')
    try {
      const res = await settingsApi.sendEmailCode(email.trim())
      setMsg(res.message)
      setStep('code')
    } catch (e) {
      // 429：一分钟一封；400：格式不对
      setError(e instanceof ApiError ? e.message : '验证码没飞出去，再试一次？')
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!code.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await settingsApi.verifyEmail(email.trim(), code.trim())
      setMsg(res.message || '绑定好啦，以后的信都寄到这里')
      setMe((m) => (m ? { ...m, email: res.email } : m))
      setStep('input')
      setCode('')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '验证没过，再看看？')
    } finally {
      setBusy(false)
    }
  }

  const toggleNotify = async () => {
    const next = !notifyOn
    setNotifyOn(next)
    try {
      await settingsApi.setNotify(next)
    } catch {
      setNotifyOn(!next)
      setError('没改成，再试一次？')
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.11 }}
      className="bg-paper rounded-2xl shadow-card border border-warm-line p-5"
    >
      <h2 className="font-title text-lg flex items-center gap-2 mb-2">
        <Mail className="w-5 h-5 text-qiule" />
        邮箱绑定
      </h2>
      {me === null ? (
        <p className="text-sm text-ink-soft">正在翻名册……</p>
      ) : me.email ? (
        <>
          <p className="text-sm text-ink-soft leading-relaxed">
            信会寄到 <span className="font-medium text-ink">{me.email}</span>
          </p>
          <div className="mt-3">
            <ToggleRow
              label="接收邮件问候与提醒"
              desc="crina 的早安晚安、日程提醒，会轻轻落进你的邮箱"
              on={notifyOn}
              onToggle={toggleNotify}
            />
          </div>
          {msg && <p className="mt-3 text-xs text-baixu">{msg}</p>}
        </>
      ) : (
        <>
          <p className="text-sm text-ink-soft leading-relaxed">
            绑个邮箱，crina 的早安晚安和日程提醒就能寄到你手上。
          </p>
          <div className="mt-3 space-y-2.5">
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="你的邮箱"
                disabled={step === 'code'}
                className="flex-1 min-w-0 bg-cream rounded-xl px-4 py-2.5 text-sm outline-none border border-warm-line focus:border-crina/50 disabled:opacity-60"
              />
              <button
                onClick={sendCode}
                disabled={!email.trim() || busy}
                className="btn-press shrink-0 px-4 py-2.5 rounded-xl bg-crina text-white text-sm disabled:opacity-40 hover:bg-crina-deep inline-flex items-center gap-1.5"
              >
                {busy && step === 'input' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {step === 'code' ? '重寄验证码' : '寄验证码'}
              </button>
            </div>
            {step === 'code' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="flex gap-2 overflow-hidden"
              >
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6 位验证码"
                  inputMode="numeric"
                  autoFocus
                  className="flex-1 min-w-0 bg-cream rounded-xl px-4 py-2.5 text-sm tracking-[0.3em] outline-none border border-warm-line focus:border-crina/50"
                />
                <button
                  onClick={verify}
                  disabled={code.length !== 6 || busy}
                  className="btn-press shrink-0 px-4 py-2.5 rounded-xl bg-baixu text-white text-sm disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MailCheck className="w-4 h-4" />}
                  绑定
                </button>
              </motion.div>
            )}
            {msg && <p className="text-xs text-baixu">{msg}</p>}
            {error && <p className="text-xs text-anfeng">{error}</p>}
          </div>
        </>
      )}
    </motion.section>
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

/** 时区设置：早安晚安信与事件提醒按用户当地时间触发 */
function TimezoneCard() {
  const [tz, setTz] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(new Date())
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  const zones: string[] =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : ['Asia/Shanghai', 'Asia/Tokyo', 'Europe/London', 'America/New_York']

  useEffect(() => {
    authApi.me().then((u) => setTz(u.timezone || browserTz)).catch(() => setTz(browserTz))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(''), 3000)
    return () => clearTimeout(t)
  }, [saved])

  const localTime = tz
    ? now.toLocaleTimeString('zh-CN', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
    : ''

  const save = async (next: string) => {
    if (busy || !next) return
    setBusy(true)
    try {
      await settingsApi.setTimezone(next)
      setTz(next)
      setSaved('记住啦，以后的信都按你的时间来')
    } catch {
      setSaved('没存上，再试一下？')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="bg-paper rounded-2xl shadow-card border border-warm-line p-5"
    >
      <h2 className="font-title text-lg flex items-center gap-2 mb-1">
        <Globe className="w-5 h-5 text-xuanmo" />
        你住在哪里时间里
      </h2>
      <p className="text-xs text-ink-soft/80 mb-4">
        早安晚安信和日程提醒，都会按你当地的时间抵达。
      </p>
      <div className="flex items-center gap-2">
        <select
          value={tz}
          disabled={busy}
          onChange={(e) => save(e.target.value)}
          className="flex-1 min-w-0 bg-cream/60 border border-warm-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-crina/50"
        >
          {tz && !zones.includes(tz) && <option value={tz}>{tz}</option>}
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        {tz !== browserTz && (
          <button
            onClick={() => save(browserTz)}
            disabled={busy}
            className="btn-press shrink-0 text-xs px-3 py-2.5 rounded-xl border border-warm-line text-ink-soft hover:bg-cream/60"
          >
            跟随浏览器
          </button>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-ink-soft/70">
        <span>{tz ? `你那里现在 ${localTime}` : ''}</span>
        {saved && <span className="text-baixu">{saved}</span>}
      </div>
    </motion.section>
  )
}
