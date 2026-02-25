import type { TicketPriority } from '../../types'

const PRIORITIES: { value: TicketPriority; label: string; color: string; bg: string; ring: string }[] = [
  { value: 'low',      label: 'Düşük',  color: '#3b82f6', bg: 'bg-blue-50 dark:bg-blue-950/40',     ring: 'ring-blue-400' },
  { value: 'medium',   label: 'Orta',   color: '#f59e0b', bg: 'bg-amber-50 dark:bg-amber-950/40',   ring: 'ring-amber-400' },
  { value: 'high',     label: 'Yüksek', color: '#f97316', bg: 'bg-orange-50 dark:bg-orange-950/40', ring: 'ring-orange-400' },
  { value: 'critical', label: 'Kritik', color: '#ef4444', bg: 'bg-red-50 dark:bg-red-950/40',       ring: 'ring-red-400' },
]

function FlagIcon({ color, filled }: { color: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-4 h-4 flex-shrink-0"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 1v14M3 3h9l-3 3.5 3 3.5H3V3z" />
    </svg>
  )
}

interface PickerProps {
  value: TicketPriority
  onChange: (p: TicketPriority) => void
  disabled?: boolean
}

export function PriorityPicker({ value, onChange, disabled }: PickerProps) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {PRIORITIES.map((p) => {
        const selected = value === p.value
        return (
          <button
            key={p.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(p.value)}
            title={p.label}
            className={`
              flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all
              ${selected ? `${p.bg} ring-2 ${p.ring}` : 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 ring-1 ring-gray-200 dark:ring-gray-700'}
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            <FlagIcon color={p.color} filled={selected} />
            <span style={{ color: selected ? p.color : undefined }} className={selected ? 'font-semibold' : 'text-gray-500 dark:text-gray-400'}>
              {p.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

interface BadgeProps {
  priority: TicketPriority
  size?: 'sm' | 'md'
}

export function PriorityFlagBadge({ priority, size = 'sm' }: BadgeProps) {
  const p = PRIORITIES.find((x) => x.value === priority)!
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  return (
    <span className="inline-flex items-center gap-1" title={p.label}>
      <svg
        viewBox="0 0 16 16"
        className={iconSize}
        fill={p.color}
        stroke={p.color}
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 1v14M3 3h9l-3 3.5 3 3.5H3V3z" />
      </svg>
      {size === 'md' && <span className="text-xs font-medium" style={{ color: p.color }}>{p.label}</span>}
    </span>
  )
}
