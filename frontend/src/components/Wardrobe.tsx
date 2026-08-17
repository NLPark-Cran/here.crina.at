import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Coins, Shirt, Sparkles, Lamp, Loader2 } from 'lucide-react'
import { spaceApi, ApiError } from '../api/client'
import type { WardrobeData } from '../api/types'
import { relativeTime } from '../lib/time'
import { useAuth } from '../store/auth'
import { Toast } from './Toast'
import { ZoomableImage } from './ZoomableImage'

const FUND_AMOUNTS = [10, 50, 100, 200]

/** 门厅版块：crina 的衣橱与小金库 */
export function WardrobeSection() {
  const { user } = useAuth()
  const [data, setData] = useState<WardrobeData | null>(null)
  const [toast, setToast] = useState('')
  const [funding, setFunding] = useState(false)
  const [wishKind, setWishKind] = useState<'outfit' | 'decor'>('outfit')
  const [wishHint, setWishHint] = useState('')
  const [wishing, setWishing] = useState(false)
  const [wishError, setWishError] = useState('')
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(() => {
    spaceApi.wardrobe().then(setData).catch(() => {})
  }, [])

  useEffect(() => {
    load()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [load])

  const showToast = (text: string) => {
    setToast(text)
    setTimeout(() => setToast(''), 5000)
  }

  const fund = async (amount: number) => {
    if (funding) return
    setFunding(true)
    try {
      const res = await spaceApi.fundWardrobe(amount)
      showToast(res.message)
      load()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '没塞进去，再试一次？')
    } finally {
      setFunding(false)
    }
  }

  const wish = async () => {
    if (wishing) return
    setWishing(true)
    setWishError('')
    try {
      const res = await spaceApi.wishWardrobe(wishKind, wishHint.trim())
      showToast(res.message)
      setWishHint('')
      // crina 出门逛街（异步生图），60 秒后回来看看衣橱
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(load, 60_000)
    } catch (e) {
      setWishError(e instanceof ApiError ? e.message : '主意没传到，再说一次？')
    } finally {
      setWishing(false)
    }
  }

  if (!data) return null
  const wearing = data.items.find((i) => i.wearing && i.kind === 'outfit')
  const others = data.items.filter((i) => i !== wearing)

  return (
    <section>
      <Toast text={toast} onClose={() => setToast('')} />
      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.12 }}
        className="font-title text-2xl flex items-center gap-2 mb-4"
      >
        <Shirt className="w-5 h-5 text-crina" />
        crina 的衣橱与小金库
      </motion.h2>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {/* 左：小金库 + 当前穿搭 */}
        <div className="md:col-span-2 space-y-4">
          {/* 小金库 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.16 }}
            className="bg-paper rounded-2xl shadow-card border border-warm-line p-5"
          >
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              <Coins className="w-4 h-4 text-qiule" />
              小金库余额
            </div>
            <div className="mt-1 font-title text-3xl text-qiule">
              {data.balance}
              <span className="text-sm text-ink-soft ml-1.5">镜币</span>
            </div>
            {user && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-ink-soft">塞点零花钱：</span>
                {FUND_AMOUNTS.map((a) => (
                  <button
                    key={a}
                    onClick={() => fund(a)}
                    disabled={funding}
                    className="btn-press px-3 py-1 rounded-full bg-qiule/12 text-qiule text-xs hover:bg-qiule/20 disabled:opacity-50"
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
            {/* 最近流水 */}
            {data.ledger.length > 0 && (
              <div className="mt-4 pt-3 border-t border-warm-line space-y-1.5">
                {data.ledger.slice(0, 5).map((l, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-xs">
                    <span className={`shrink-0 font-medium ${l.delta >= 0 ? 'text-baixu' : 'text-anfeng'}`}>
                      {l.delta >= 0 ? `+${l.delta}` : l.delta}
                    </span>
                    <span className="text-ink-soft truncate flex-1">{l.reason}</span>
                    <span className="text-ink-soft/60 shrink-0">{relativeTime(l.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* 主人专属：给她出个主意 */}
          {user?.is_owner && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.2 }}
              className="bg-gradient-to-br from-crina/10 to-tuanman/10 rounded-2xl border border-crina/20 p-5"
            >
              <div className="font-title flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-crina-deep" />
                给她出个主意
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setWishKind('outfit')}
                  className={`btn-press flex-1 py-2 rounded-xl text-xs transition-colors ${
                    wishKind === 'outfit' ? 'bg-crina text-white shadow-sm' : 'bg-paper text-ink-soft border border-warm-line'
                  }`}
                >
                  装扮 · 88 镜币
                </button>
                <button
                  onClick={() => setWishKind('decor')}
                  className={`btn-press flex-1 py-2 rounded-xl text-xs transition-colors ${
                    wishKind === 'decor' ? 'bg-crina text-white shadow-sm' : 'bg-paper text-ink-soft border border-warm-line'
                  }`}
                >
                  摆件 · 45 镜币
                </button>
              </div>
              <input
                value={wishHint}
                onChange={(e) => setWishHint(e.target.value)}
                placeholder="一句话提示（比如：适合秋天观鸟的风衣）"
                maxLength={200}
                className="mt-2.5 w-full bg-paper rounded-xl px-3.5 py-2 text-sm outline-none border border-warm-line focus:border-crina/50"
              />
              <button
                onClick={wish}
                disabled={wishing}
                className="btn-press mt-2.5 w-full py-2 rounded-full bg-crina text-white text-sm hover:bg-crina-deep disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                {wishing && <Loader2 className="w-4 h-4 animate-spin" />}
                {wishing ? '转告中…' : '让她去买'}
              </button>
              {wishError && <p className="mt-2 text-xs text-anfeng">{wishError}</p>}
            </motion.div>
          )}
        </div>

        {/* 右：当前穿搭 + 物品网格 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.18 }}
          className="md:col-span-3 bg-paper rounded-2xl shadow-card border border-warm-line p-5"
        >
          {wearing ? (
            <div>
              <div className="text-xs text-ink-soft mb-2">今天穿的</div>
              <ZoomableImage
                src={wearing.image_url}
                alt={wearing.title}
                className="w-full max-h-72 object-cover rounded-xl"
              />
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="font-title text-lg">{wearing.title}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-crina/12 text-crina-deep">
                  {wearing.cost} 镜币
                </span>
              </div>
              {wearing.note && <p className="mt-1 text-sm text-ink-soft leading-relaxed">{wearing.note}</p>}
            </div>
          ) : (
            <p className="text-sm text-ink-soft py-6 text-center">
              衣橱还挂着最初的那件卫衣——攒够镜币，就能给她添置新行头了。
            </p>
          )}

          {others.length > 0 && (
            <div className="mt-4 pt-4 border-t border-warm-line">
              <div className="text-xs text-ink-soft mb-2">衣橱与小屋收藏</div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                {others.map((item) => (
                  <div key={item.id} className="group relative" title={`${item.title}${item.note ? ` · ${item.note}` : ''}`}>
                    <ZoomableImage
                      src={item.image_url}
                      alt={item.title}
                      className="w-full aspect-square object-cover rounded-lg"
                    />
                    <span className="absolute top-1 right-1 p-1 rounded-full bg-paper/85 text-ink-soft">
                      {item.kind === 'outfit' ? <Shirt className="w-3 h-3" /> : <Lamp className="w-3 h-3" />}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </section>
  )
}
