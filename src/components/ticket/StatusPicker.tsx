import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { usePopupLayer } from '../../lib/popups'
import { createPortal } from 'react-dom'
import type { TicketStatus, StatusCategory } from '../../types'
import { STATUS_CATEGORY_LABELS, STATUS_CATEGORY_ORDER } from '../../types'
import { StatusIndicator } from './StatusIndicator'
import { markHandled } from '../../lib/keys'
import { useT } from '../../i18n'

interface Props {
  statuses: TicketStatus[]
  value: string | null
  onChange: (status: TicketStatus) => void
  anchor: HTMLElement
  onClose: () => void
}

const WIDTH = 240

/** Popover listing the list's statuses grouped by category; keyboard navigable. */
export function StatusPicker({ statuses, value, onChange, anchor, onClose }: Props) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [cursor, setCursor] = useState(() => Math.max(0, statuses.findIndex((s) => s.id === value)))

  const groups = useMemo(() => {
    const byCat = new Map<StatusCategory, TicketStatus[]>()
    for (const s of statuses) byCat.set(s.category, [...(byCat.get(s.category) ?? []), s])
    return STATUS_CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({ cat: c, items: byCat.get(c)! }))
  }, [statuses])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8))
      const below = window.innerHeight - r.bottom
      setPos({ top: below > 300 ? r.bottom + 6 : Math.max(8, r.top - 6 - 300), left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [anchor])

  usePopupLayer(true, ref, onClose, anchor)
  useEffect(() => {
    ref.current?.focus()
    const onDoc = (e: MouseEvent) => {
      const node = e.target as Node
      if (ref.current && !ref.current.contains(node) && !anchor.contains(node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [anchor, onClose])

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') { markHandled(e.nativeEvent); e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(flat.length - 1, c + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); const s = flat[cursor]; if (s) { onChange(s); onClose() } }
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return createPortal(
    <div
      ref={ref}
      tabIndex={-1}
      role="listbox"
      aria-label={t('ticketExtra.status.pick')}
      onKeyDown={onKey}
      style={{ top: pos.top, left: pos.left, width: WIDTH, maxHeight: 300 }}
      className="fixed z-[150] overflow-auto bg-surface border border-line rounded-xl shadow-lg py-1.5 animate-fade-in outline-none"
      onClick={stop} onMouseDown={stop} onPointerDown={stop}
    >
      {groups.map((g) => (
        <div key={g.cat}>
          <p className="px-3 pt-1.5 pb-0.5 text-2xs font-semibold uppercase tracking-wider text-fg-faint">{t(STATUS_CATEGORY_LABELS[g.cat as StatusCategory])}</p>
          {g.items.map((s) => {
            const idx = flat.indexOf(s)
            const selected = s.id === value
            return (
              <button
                key={s.id}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setCursor(idx)}
                onClick={() => { onChange(s); onClose() }}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left ${idx === cursor ? 'bg-raised text-fg' : 'text-fg-2'} ${selected ? 'font-semibold' : ''}`}
              >
                <StatusIndicator status={s} size={15} />
                <span className="flex-1 truncate">{s.name}</span>
                {selected && <Icon name="check" className="text-primary-500" />}
              </button>
            )
          })}
        </div>
      ))}
      {statuses.length === 0 && <p className="px-3 py-2 text-xs text-fg-faint">{t('ticketExtra.status.emptyInList')}</p>}
    </div>,
    document.body,
  )
}

/** Clickable status chip that opens the picker. Used in the ticket sidebar and list rows. */
export function StatusButton({ status, statuses, onChange, disabled = false, size = 'md' }: {
  status: TicketStatus | null | undefined
  statuses: TicketStatus[]
  onChange: (s: TicketStatus) => void
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setAnchor(anchor ? null : e.currentTarget) }}
        onPointerDown={(e) => e.stopPropagation()}
        className={`chip-dyn border inline-flex items-center gap-1.5 rounded-lg font-semibold ${size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-1.5'} ${disabled ? 'cursor-default' : 'hover:brightness-95 dark:hover:brightness-125'}`}
        style={{ '--c': status?.color ?? '#6b7280' } as React.CSSProperties}
        title={disabled ? undefined : t('ticketExtra.status.change')}
      >
        <StatusIndicator status={status} size={size === 'sm' ? 13 : 15} />
        {status?.name ?? t('ticketExtra.status.choose')}
        {!disabled && <Icon name="chevronDown" className="opacity-70" />}
      </button>
      {anchor && <StatusPicker statuses={statuses} value={status?.id ?? null} onChange={onChange} anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  )
}
