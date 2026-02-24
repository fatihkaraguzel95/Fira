import type { TicketStatus } from '../../types'
import { STATUS_LABELS } from '../../types'

const styles: Record<TicketStatus, string> = {
  todo: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  review: 'bg-yellow-100 text-yellow-700',
  done: 'bg-green-100 text-green-700',
}

const dots: Record<TicketStatus, string> = {
  todo: 'bg-gray-400',
  in_progress: 'bg-blue-500',
  review: 'bg-yellow-500',
  done: 'bg-green-500',
}

interface Props {
  status: TicketStatus
  size?: 'sm' | 'md'
}

export function StatusBadge({ status, size = 'sm' }: Props) {
  const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded font-medium ${styles[status]} ${sizeClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status]}`} />
      {STATUS_LABELS[status]}
    </span>
  )
}
