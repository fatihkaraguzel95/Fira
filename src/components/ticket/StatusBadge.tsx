import type { TicketStatus } from '../../types'

interface Props {
  status: TicketStatus
  size?: 'sm' | 'md'
}

export function StatusBadge({ status, size = 'sm' }: Props) {
  const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md font-medium ${sizeClass}`}
      style={{ '--c': status.color } as React.CSSProperties}
    >
      <span className="chip-dot w-1.5 h-1.5 rounded-full" />
      {status.name}
    </span>
  )
}
