interface Props {
  name: string
  color?: string | null
  avatarUrl?: string | null
  size?: number
  className?: string
}

/**
 * 角色头像占位组件：有图用图，没图用角色色圆形 + 首字。
 * 后续接入立绘只需传入 avatarUrl。
 */
export function CharacterAvatar({ name, color, avatarUrl, size = 48, className = '' }: Props) {
  const bg = color || '#8A8FC4'
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        width={size}
        height={size}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className={`rounded-full flex items-center justify-center text-white font-title shrink-0 select-none ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${bg}, ${bg}CC)`,
        fontSize: size * 0.42,
        boxShadow: `0 2px 8px ${bg}55`,
      }}
      aria-label={name}
    >
      {name.slice(0, 1)}
    </div>
  )
}
