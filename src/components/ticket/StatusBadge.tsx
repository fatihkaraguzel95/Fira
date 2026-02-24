import type { TicketStatus } from '../../types'

interface Props {
  status: TicketStatus
  size?: 'sm' | 'md'
}

export function StatusBadge({ status, size = 'sm' }: Props) {
  const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded font-medium ${sizeClass}`}
      style={{ backgroundColor: status.color + '22', color: status.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
      {status.name}
    </span>
  )
}
