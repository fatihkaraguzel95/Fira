import type { TicketPriority } from '../../types'
import { PRIORITY_LABELS } from '../../types'

const dotColor: Record<TicketPriority, string> = {
  low:      '#94a3b8',
  medium:   '#f59e0b',
  high:     '#f97316',
  critical: '#ef4444',
}

const badgeStyles: Record<TicketPriority, string> = {
  low:      'bg-slate-100 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400',
  medium:   'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400',
  high:     'bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400',
  critical: 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400',
}

interface Props {
  priority: TicketPriority
  size?: 'sm' | 'md'
}

export function PriorityBadge({ priority, size = 'sm' }: Props) {
  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md font-medium ${badgeStyles[priority]} ${sizeClass}`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: dotColor[priority] }}
      />
      {PRIORITY_LABELS[priority]}
    </span>
  )
}
