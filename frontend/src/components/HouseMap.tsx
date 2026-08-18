import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Map } from 'lucide-react'
import { CharacterAvatar } from './CharacterAvatar'

/** 小屋剖面地图上的房间热点（坐标为百分比，依据剖面图校准） */
interface RoomSpot {
  id: string
  label: string
  desc: string
  path: string
  corner: string // 氛围角图
  /** 热点区域（百分比）：左 / 上 / 宽 / 高 */
  spot: { x: number; y: number; w: number; h: number }
}

/** 热点按 house_section.webp（2048x1152）实际房间布局校准：
 *  阁楼=档案馆 / 左下=客厅 / 右上=书房（私聊间） / 书桌=委托板 / 门边=信箱 / 右下=门厅 */
const ROOMS: RoomSpot[] = [
  {
    id: 'archive', label: '档案馆', desc: '卷宗与沉淀在阁楼安睡', path: '/archive',
    corner: '/assets/corner_archive.webp', spot: { x: 13, y: 17, w: 34, h: 35 },
  },
  {
    id: 'parlor', label: '客厅', desc: '沙发很软，随便聊', path: '/parlor',
    corner: '/assets/corner_parlor.webp', spot: { x: 7, y: 55, w: 42, h: 40 },
  },
  {
    id: 'study', label: '私聊间', desc: '和居民们的悄悄话书房', path: '/chat',
    corner: '/assets/corner_study.webp', spot: { x: 58, y: 24, w: 32, h: 17 },
  },
  {
    id: 'desk', label: '委托板', desc: '钉张小纸条，crina 来施工', path: '/board',
    corner: '/assets/corner_desk.webp', spot: { x: 62, y: 42, w: 24, h: 14 },
  },
  {
    id: 'mailbox', label: '信箱', desc: '居民们的来信躺在木信箱里', path: '/mailbox',
    corner: '/assets/corner_mailbox.webp', spot: { x: 55, y: 61, w: 9, h: 15 },
  },
  {
    id: 'hall', label: '门厅', desc: '回到小屋的第一眼', path: '/',
    corner: '/assets/corner_hall.webp', spot: { x: 65, y: 58, w: 28, h: 40 },
  },
]

/** 小屋剖面地图：看见每个房间，点一点就走过去 */
export function HouseMap() {
  const navigate = useNavigate()
  const [hovered, setHovered] = useState<RoomSpot | null>(null)
  const [walkingTo, setWalkingTo] = useState<RoomSpot | null>(null)

  const go = (room: RoomSpot) => {
    if (walkingTo) return
    setWalkingTo(room)
    // 走动过渡：小人穿过屏幕后落地导航
    setTimeout(() => navigate(room.path), 780)
  }

  return (
    <section>
      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="font-title text-2xl flex items-center gap-2 mb-1"
      >
        <Map className="w-6 h-6 text-baixu" />
        小屋地图
      </motion.h2>
      <motion.p
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="text-sm text-ink-soft mb-4"
      >
        剖开小屋看一看——亮起来的地方都能走进去。
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="relative rounded-3xl overflow-hidden border border-warm-line shadow-card bg-paper"
      >
        <img
          src="/assets/house_section.webp"
          alt="小屋剖面图"
          loading="lazy"
          className="w-full block select-none"
          draggable={false}
        />
        {/* 房间热点 */}
        {ROOMS.map((room) => (
          <button
            key={room.id}
            aria-label={`去${room.label}`}
            onClick={() => go(room)}
            onMouseEnter={() => setHovered(room)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(room)}
            onBlur={() => setHovered(null)}
            className="absolute rounded-2xl transition-all duration-300 cursor-pointer group"
            style={{
              left: `${room.spot.x}%`, top: `${room.spot.y}%`,
              width: `${room.spot.w}%`, height: `${room.spot.h}%`,
            }}
          >
            <span
              className={`absolute inset-0 rounded-2xl border-2 transition-all duration-300 ${
                hovered?.id === room.id
                  ? 'border-crina/70 bg-crina/10 shadow-[0_0_24px_rgba(138,143,196,0.35)]'
                  : 'border-transparent bg-crina/0 group-hover:border-crina/40'
              }`}
            />
            <span
              className={`absolute left-1/2 -translate-x-1/2 bottom-1.5 px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap transition-all duration-300 ${
                hovered?.id === room.id
                  ? 'bg-crina text-white opacity-100'
                  : 'bg-paper/85 text-ink-soft opacity-0 group-hover:opacity-100'
              }`}
            >
              {room.label}
            </span>
          </button>
        ))}

        {/* 悬停氛围角预览 */}
        <AnimatePresence>
          {hovered && !walkingTo && (
            <motion.div
              key={hovered.id}
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.18 }}
              className="absolute z-10 w-44 sm:w-52 rounded-2xl overflow-hidden border border-warm-line shadow-float bg-paper pointer-events-none"
              style={{
                left: `${Math.min(Math.max(hovered.spot.x + hovered.spot.w / 2 - 12, 2), 62)}%`,
                top: hovered.spot.y > 40 ? `${Math.max(hovered.spot.y - 4, 2)}%` : `${Math.min(hovered.spot.y + hovered.spot.h + 2, 58)}%`,
                transform: 'translateY(' + (hovered.spot.y > 40 ? '-100%' : '0') + ')',
              }}
            >
              <img src={hovered.corner} alt={`${hovered.label}氛围角`} loading="lazy" className="w-full aspect-[4/3] object-cover" />
              <div className="px-3 py-2">
                <div className="text-sm font-medium">{hovered.label}</div>
                <div className="text-[11px] text-ink-soft">{hovered.desc}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* 移动端房间速达 */}
      <div className="mt-3 flex flex-wrap gap-2 sm:hidden">
        {ROOMS.map((room) => (
          <button
            key={room.id}
            onClick={() => go(room)}
            className="btn-press text-xs px-3 py-1.5 rounded-full bg-paper border border-warm-line text-ink-soft"
          >
            {room.label}
          </button>
        ))}
      </div>

      {/* 走动过渡动画 */}
      <AnimatePresence>
        {walkingTo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-cream/85 backdrop-blur-sm flex flex-col items-center justify-center gap-4"
          >
            <motion.div
              initial={{ x: '-40vw' }}
              animate={{ x: '40vw' }}
              transition={{ duration: 0.75, ease: 'easeInOut' }}
              className="flex items-center"
            >
              <motion.div
                animate={{ y: [0, -6, 0, -6, 0] }}
                transition={{ duration: 0.5, repeat: 1, ease: 'easeInOut' }}
              >
                <CharacterAvatar name="crina" color="#8A8FC4" avatarUrl="/assets/crina_avatar.webp" size={56} />
              </motion.div>
            </motion.div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="text-sm text-ink-soft"
            >
              跟 crina 走去{walkingTo.label}……
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
