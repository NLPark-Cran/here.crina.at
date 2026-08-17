import { NavLink, Outlet } from 'react-router'
import {
  DoorOpen,
  Sofa,
  MessagesSquare,
  ClipboardList,
  Mailbox,
  LibraryBig,
  Settings,
} from 'lucide-react'
import { useEffect } from 'react'
import { useAuth } from '../store/auth'

const ROOMS = [
  { to: '/', label: '门厅', icon: DoorOpen, end: true },
  { to: '/parlor', label: '客厅', icon: Sofa },
  { to: '/chat', label: '私聊间', icon: MessagesSquare },
  { to: '/board', label: '委托板', icon: ClipboardList },
  { to: '/mailbox', label: '信箱', icon: Mailbox },
  { to: '/archive', label: '档案馆', icon: LibraryBig },
  { to: '/settings', label: '设置', icon: Settings },
]

export function Layout() {
  const { user, fetchMe } = useAuth()
  useEffect(() => {
    if (user === undefined) void fetchMe()
  }, [user, fetchMe])

  return (
    <div className="room-bg paper-grain min-h-dvh flex flex-col">
      {/* 桌面端顶部导航 */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-cream/80 border-b border-warm-line">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <NavLink to="/" className="flex items-center gap-2 shrink-0 min-w-0">
            {user ? (
              user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.nickname}
                  className="w-7 h-7 rounded-full object-cover shadow-sm"
                />
              ) : (
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-crina to-crina-deep flex items-center justify-center text-white text-sm font-title shadow-sm">
                  {user.nickname.slice(0, 1)}
                </span>
              )
            ) : (
              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-crina to-crina-deep flex items-center justify-center text-white text-sm font-title shadow-sm">
                镜
              </span>
            )}
            <span className="font-title text-lg tracking-wide truncate">
              {user ? `${user.nickname} 的空间` : '镜听空间'}
            </span>
          </NavLink>
          <nav className="hidden md:flex items-center gap-1">
            {ROOMS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `btn-press flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
                    isActive
                      ? 'bg-crina/15 text-crina-deep font-medium'
                      : 'text-ink-soft hover:bg-crina/8 hover:text-ink'
                  }`
                }
              >
                <Icon className="w-4 h-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden md:block text-sm text-ink-soft shrink-0">
            {user ? (
              <NavLink to="/settings" className="hover:text-crina-deep transition-colors">
                {user.nickname}，欢迎回来
              </NavLink>
            ) : (
              <NavLink to="/login" className="text-crina-deep hover:underline">
                敲门进来
              </NavLink>
            )}
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 pt-6 pb-24 md:pb-10">
        <Outlet />
      </main>

      {/* 移动端底部 tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-paper/95 backdrop-blur-md border-t border-warm-line pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-7">
          {ROOMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${
                  isActive ? 'text-crina-deep font-medium' : 'text-ink-soft'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
