import { PRIORITY_LABELS, type TicketPriority } from '../../types'
import { useT } from '../../i18n'

const dotColor: Record<TicketPriority, string> = {
  low:      '#94a3b8',
  medium:   '#f59e0b',
  high:     '#f97316',
  critical: '#ef4444',
}

const badgeStyles: Record<TicketPriority, string> = {
  low:      'bg-slate-100 dark:bg-slate-800/60 text-fg-muted',
  medium:   'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400',
  high:     'bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400',
  critical: 'bg-danger/10 text-danger',
}

interface Props {
  priority: TicketPriority | null
  size?: 'sm' | 'md'
}

export function PriorityBadge({ priority, size = 'sm' }: Props) {
  const t = useT()
  if (!priority) return <span className="text-fg-faint text-xs">—</span>
  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md font-medium ${badgeStyles[priority]} ${sizeClass}`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: dotColor[priority] }}
      />
      {t(PRIORITY_LABELS[priority])}
    </span>
  )
}
