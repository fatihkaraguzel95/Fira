import type { TicketStatus } from '../../types'
import { useT } from '../../i18n'

interface Props {
  status: Pick<TicketStatus, 'name' | 'color' | 'category' | 'is_cancelled'> | null | undefined
  size?: number
  className?: string
}

/**
 * ClickUp-like status indicator: a circle in the status colour whose inside
 * tells the category — dashed/empty = backlog, filled ring = active,
 * pause = blocked, check = done/closed, cross = cancelled.
 */
export function StatusIndicator({ status, size = 16, className = '' }: Props) {
  const t = useT()
  const color = status?.color ?? '#9ca3af'
  const cat = status?.category ?? 'active'
  const s = size
  const r = s / 2 - 1.5

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      className={`flex-shrink-0 ${className}`}
      data-status-dot
      aria-label={status ? t('ticketExtra.status.aria', { name: status.name }) : t('ticketExtra.status.none')}
      role="img"
    >
      {cat === 'backlog' && (
        <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke={color} strokeWidth={1.75} strokeDasharray={`${r * 0.9} ${r * 0.6}`} opacity={0.9} />
      )}
      {cat === 'active' && (
        <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke={color} strokeWidth={2.25} />
      )}
      {cat === 'blocked' && (
        <>
          <circle cx={s / 2} cy={s / 2} r={r} fill={color} opacity={0.18} stroke={color} strokeWidth={1.75} />
          <rect x={s / 2 - r * 0.42} y={s / 2 - r * 0.5} width={r * 0.3} height={r} fill={color} rx={0.5} />
          <rect x={s / 2 + r * 0.12} y={s / 2 - r * 0.5} width={r * 0.3} height={r} fill={color} rx={0.5} />
        </>
      )}
      {cat === 'done' && (
        <>
          <circle cx={s / 2} cy={s / 2} r={r} fill={color} opacity={0.2} stroke={color} strokeWidth={1.75} />
          <path d={`M${s * 0.3} ${s * 0.52} L${s * 0.45} ${s * 0.66} L${s * 0.71} ${s * 0.36}`} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {cat === 'closed' && !status?.is_cancelled && (
        <>
          <circle cx={s / 2} cy={s / 2} r={r} fill={color} />
          <path d={`M${s * 0.3} ${s * 0.52} L${s * 0.45} ${s * 0.66} L${s * 0.71} ${s * 0.36}`} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {cat === 'closed' && status?.is_cancelled && (
        <>
          <circle cx={s / 2} cy={s / 2} r={r} fill={color} />
          <path d={`M${s * 0.34} ${s * 0.34} L${s * 0.66} ${s * 0.66} M${s * 0.66} ${s * 0.34} L${s * 0.34} ${s * 0.66}`} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
