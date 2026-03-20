import type { TicketPriority } from '../../types'

const PRIORITIES: {
  value: TicketPriority
  label: string
  color: string
  dot: string
  selectedBg: string
  selectedBorder: string
  selectedText: string
}[] = [
  {
    value: 'low',
    label: 'Düşük',
    color: '#94a3b8',
    dot: '#94a3b8',
    selectedBg: 'bg-slate-100 dark:bg-slate-800',
    selectedBorder: 'border-slate-400 dark:border-slate-500',
    selectedText: 'text-slate-600 dark:text-slate-300',
  },
  {
    value: 'medium',
    label: 'Orta',
    color: '#f59e0b',
    dot: '#f59e0b',
    selectedBg: 'bg-amber-50 dark:bg-amber-950/40',
    selectedBorder: 'border-amber-400 dark:border-amber-500',
    selectedText: 'text-amber-700 dark:text-amber-400',
  },
  {
    value: 'high',
    label: 'Yüksek',
    color: '#f97316',
    dot: '#f97316',
    selectedBg: 'bg-orange-50 dark:bg-orange-950/40',
    selectedBorder: 'border-orange-400 dark:border-orange-500',
    selectedText: 'text-orange-700 dark:text-orange-400',
  },
  {
    value: 'critical',
    label: 'Kritik',
    color: '#ef4444',
    dot: '#ef4444',
    selectedBg: 'bg-red-50 dark:bg-red-950/40',
    selectedBorder: 'border-red-400 dark:border-red-500',
    selectedText: 'text-red-600 dark:text-red-400',
  },
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
              flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border
              ${selected
                ? `${p.selectedBg} ${p.selectedBorder} ${p.selectedText}`
                : 'bg-slate-50 dark:bg-gray-800 border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 hover:border-slate-300 dark:hover:border-gray-600'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            <FlagIcon color={p.color} filled={selected} />
            <span className="font-medium">{p.label}</span>
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

const PRIORITY_COLORS: Record<TicketPriority, string> = {
  low:      '#94a3b8',
  medium:   '#f59e0b',
  high:     '#f97316',
  critical: '#ef4444',
}

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low:      'Düşük',
  medium:   'Orta',
  high:     'Yüksek',
  critical: 'Kritik',
}

export function PriorityFlagBadge({ priority, size = 'sm' }: BadgeProps) {
  const color = PRIORITY_COLORS[priority]
  const label = PRIORITY_LABELS[priority]
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  return (
    <span className="inline-flex items-center gap-1" title={label}>
      <svg
        viewBox="0 0 16 16"
        className={iconSize}
        fill={color}
        stroke={color}
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 1v14M3 3h9l-3 3.5 3 3.5H3V3z" />
      </svg>
      {size === 'md' && (
        <span className="text-xs font-medium" style={{ color }}>
          {label}
        </span>
      )}
    </span>
  )
}
