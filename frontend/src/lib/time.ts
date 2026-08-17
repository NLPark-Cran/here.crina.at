/** 人性化相对时间：x分钟前 / x小时前 / 昨天 / x天前 / 具体日期 */
export function relativeTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMs < 0) {
    // 未来时间（日历事件）
    const futureMin = Math.floor(-diffMs / 60000)
    if (futureMin < 1) return '就是现在'
    if (futureMin < 60) return `${futureMin} 分钟后`
    const futureHour = Math.floor(futureMin / 60)
    if (futureHour < 24) return `${futureHour} 小时后`
    const futureDay = Math.floor(futureHour / 24)
    if (futureDay < 30) return `${futureDay} 天后`
    return formatDate(date)
  }

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) {
    // 判断是否是“昨天”（自然日）
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    if (isSameDay(date, yesterday)) return '昨天'
    return `${diffHour} 小时前`
  }
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (isSameDay(date, yesterday)) return '昨天'
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay} 天前`
  return formatDate(date)
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hh}:${mm}`
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** 按时间段变化的问候语 */
export function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜很深了，小屋的灯还为你留着'
  if (h < 9) return '早上好，厨房里有刚温好的桂花茶'
  if (h < 12) return '上午好，今天的阳光刚好落在窗台'
  if (h < 14) return '中午好，吃饱了吗？来坐坐'
  if (h < 18) return '下午好，居民们都在各忙各的'
  if (h < 22) return '晚上好，客厅里正热闹着呢'
  return '夜深了，小声一点，弦墨影刚睡着'
}
