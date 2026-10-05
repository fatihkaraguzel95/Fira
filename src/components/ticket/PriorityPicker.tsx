import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { usePopupLayer } from '../../lib/popups'
import { PRIORITY_LABELS, type TicketPriority } from '../../types'
import { useT, type TranslationKey } from '../../i18n'

/**
 * Single source of truth for priority colors/labels — used by ticket AND subtask UIs.
 *
 * `labelKey` is what every caller renders: this array is module-level, so a
 * literal label would freeze in whatever language was current at import. The
 * words themselves are shared vocabulary and live in `common`.
 */
export const PRIORITIES: {
  value: TicketPriority
  labelKey: TranslationKey
  color: string
  dot: string
  selectedBg: string
  selectedBorder: string
  selectedText: string
}[] = [
  {
    value: 'low',
    labelKey: 'common.priority.low',
    color: '#94a3b8',
    dot: '#94a3b8',
    selectedBg: 'bg-slate-100 dark:bg-slate-800',
    selectedBorder: 'border-slate-400 dark:border-slate-500',
    selectedText: 'text-slate-600 dark:text-slate-300',
  },
  {
    value: 'medium',
    labelKey: 'common.priority.medium',
    color: '#f59e0b',
    dot: '#f59e0b',
    selectedBg: 'bg-amber-50 dark:bg-amber-950/40',
    selectedBorder: 'border-amber-400 dark:border-amber-500',
    selectedText: 'text-amber-700 dark:text-amber-400',
  },
  {
    value: 'high',
    labelKey: 'common.priority.high',
    color: '#f97316',
    dot: '#f97316',
    selectedBg: 'bg-orange-50 dark:bg-orange-950/40',
    selectedBorder: 'border-orange-400 dark:border-orange-500',
    selectedText: 'text-orange-700 dark:text-orange-400',
  },
  {
    value: 'critical',
    labelKey: 'common.priority.critical',
    color: '#ef4444',
    dot: '#ef4444',
    selectedBg: 'bg-red-50 dark:bg-red-950/40',
    selectedBorder: 'border-red-400 dark:border-red-500',
    selectedText: 'text-danger',
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
  value: TicketPriority | null
  /** null = no priority (clicking the selected option again clears it) */
  onChange: (p: TicketPriority | null) => void
  disabled?: boolean
}

export function PriorityPicker({ value, onChange, disabled }: PickerProps) {
  const t = useT()
  return (
    <div
      role="radiogroup"
      aria-label={t('ticketExtra.priority.label')}
      className="flex gap-1.5 flex-wrap items-center"
      onKeyDown={(e) => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
        const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'))
        const i = items.indexOf(document.activeElement as HTMLElement)
        if (i < 0) return
        e.preventDefault()
        const next = items[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]
        next?.focus(); next?.click()
      }}
    >
      {PRIORITIES.map((p) => {
        const selected = value === p.value
        const label = t(p.labelKey)
        return (
          <button
            key={p.value}
            type="button"
            disabled={disabled}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(selected ? null : p.value)}
            title={selected ? t('ticketExtra.priority.clickAgainToClear', { label }) : label}
            className={`
              flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border
              ${selected
                ? `${p.selectedBg} ${p.selectedBorder} ${p.selectedText}`
                : 'bg-raised border-line text-fg-muted hover:border-fg-faint'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            <FlagIcon color={p.color} filled={selected} />
            <span className="font-medium">{label}</span>
          </button>
        )
      })}
      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          title={t('ticketExtra.priority.clear')}
          aria-label={t('ticketExtra.priority.clear')}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised transition-colors"
        >
          <Icon name="close" />
        </button>
      )}
    </div>
  )
}

/**
 * Compact single-select for priority (a dropdown, not a row of buttons) — the
 * ticket properties don't need every option on screen at once. Shows the chosen
 * priority; the menu lists all four plus "remove".
 */
export function PrioritySelect({ value, onChange, disabled }: PickerProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  usePopupLayer(open, ref, () => setOpen(false))
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true) }
  }, [open])

  const cur = PRIORITIES.find((p) => p.value === value) ?? null
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors min-w-[120px] ${
          cur ? `${cur.selectedBg} ${cur.selectedBorder} ${cur.selectedText}` : 'bg-field border-line text-fg-muted'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-fg-faint'}`}
      >
        {cur ? <FlagIcon color={cur.color} filled /> : null}
        <span className="flex-1 text-left">{cur ? t(cur.labelKey) : t('ticketExtra.priority.none')}</span>
        <Icon name="chevronDown" className="text-fg-faint" />
      </button>
      {open && !disabled && (
        <div role="listbox" className="absolute z-30 mt-1 w-44 bg-surface border border-line rounded-lg shadow-lg py-1 animate-fade-in">
          {PRIORITIES.map((p) => {
            const selected = value === p.value
            return (
              <button
                key={p.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => { onChange(p.value); setOpen(false) }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-raised ${selected ? 'font-semibold text-fg' : 'text-fg-2'}`}
              >
                <FlagIcon color={p.color} filled />
                <span className="flex-1">{t(p.labelKey)}</span>
                {selected && <Icon name="check" className="text-primary-600 dark:text-primary-400" />}
              </button>
            )
          })}
          {value && (
            <>
              <div className="my-1 border-t border-line-soft" />
              <button type="button" onClick={() => { onChange(null); setOpen(false) }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-fg-muted hover:bg-raised hover:text-danger">
                <Icon name="close" />
                {t('ticketExtra.priority.clear')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface BadgeProps {
  priority: TicketPriority | null
  size?: 'sm' | 'md'
}

export const PRIORITY_COLORS: Record<TicketPriority, string> = {
  low:      '#94a3b8',
  medium:   '#f59e0b',
  high:     '#f97316',
  critical: '#ef4444',
}

export function PriorityFlagBadge({ priority, size = 'sm', showMedium = false }: BadgeProps & { showMedium?: boolean }) {
  const t = useT()
  // Medium is the default (migration 042): drawing it on every card would be noise,
  // so it only shows where the priority itself is the subject (ticket window).
  if (!priority || (priority === 'medium' && !showMedium)) return null
  const color = PRIORITY_COLORS[priority]
  const label = t(PRIORITY_LABELS[priority])
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
