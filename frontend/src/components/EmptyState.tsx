import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  icon: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
}

/** 精心文案的空状态 */
export function EmptyState({ icon: Icon, title, hint, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-crina/10 flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-crina" />
      </div>
      <p className="font-title text-lg text-ink">{title}</p>
      {hint && <p className="mt-2 text-sm text-ink-soft max-w-xs leading-relaxed">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
