import type { TicketPriority } from '../../types'
import { PRIORITY_LABELS } from '../../types'

const styles: Record<TicketPriority, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

const icons: Record<TicketPriority, string> = {
  low: '↓',
  medium: '→',
  high: '↑',
  critical: '⚡',
}

interface Props {
  priority: TicketPriority
  size?: 'sm' | 'md'
}

export function PriorityBadge({ priority, size = 'sm' }: Props) {
  const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1'
  return (
    <span className={`inline-flex items-center gap-1 rounded font-medium ${styles[priority]} ${sizeClass}`}>
      <span>{icons[priority]}</span>
      {PRIORITY_LABELS[priority]}
    </span>
  )
}
