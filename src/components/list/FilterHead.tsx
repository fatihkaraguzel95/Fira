import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { usePopupLayer } from '../../lib/popups'
import { useT } from '../../i18n'
import { FilterOptions, sectionCount, clearSection, type FilterSection } from '../layout/FilterOptions'
import type { TicketFilters, TicketStatus } from '../../types'

export interface FilterHeadProps {
  label: string
  section: FilterSection
  filters: TicketFilters
  onChange: (f: TicketFilters) => void
  statuses: TicketStatus[]
  teamId: string | null
  projectId: string
}

/**
 * The filtering part of a column header: the same choices as the header's
 * "Filtre" menu, opened next to the column they belong to. Writing to the same
 * filter object is the point — one filter, two ways in (#22AA9355).
 *
 * `FilterHeadContent` is the button + dropdown, for any host cell (the list's
 * `HeadCell`, TL-05); `ColumnFilterPopover` is the same dropdown on its own.
 */
export function FilterHeadContent({ label, section, filters, onChange, statuses, teamId, projectId, children }: FilterHeadProps & { children?: ReactNode }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const n = sectionCount(filters, section)

  usePopupLayer(open, box, () => setOpen(false))
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true) }
  }, [open])

  return (
    <span ref={box} className="flex items-center gap-1 min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t('board.list.filterBy', { name: label })}
        className={`flex items-center gap-1 transition-colors min-w-0 ${n > 0 ? 'text-primary-600 dark:text-primary-400' : 'text-fg-muted hover:text-fg'}`}
      >
        <span className="truncate">{label}</span>
        {n > 0 && <span className="tabular-nums">({n})</span>}
        <Icon name="chevronDown" />
      </button>
      {children}
      {open && (
        <div role="menu" className="absolute left-2 top-full z-30 mt-1 w-60 max-h-80 overflow-y-auto scrollbar-thin bg-surface border border-line rounded-xl shadow-2xl py-1 normal-case tracking-normal font-normal text-left">
          <FilterOptions section={section} filters={filters} onChange={onChange} statuses={statuses} teamId={teamId} projectId={projectId} />
          {n > 0 && (
            <button
              type="button"
              onClick={() => onChange(clearSection(filters, section))}
              className="w-full text-left px-3 py-2 text-xs text-fg-muted hover:bg-raised hover:text-fg border-t border-line-soft mt-1"
            >
              {t('board.list.clearColumnFilter')}
            </button>
          )}
        </div>
      )}
    </span>
  )
}

/**
 * Yalnız açılır kutu (#d8a62c6e, 23 Eyl): yeni listede sütun başlığı artık tek
 * bir menü düğmesi; filtre o menüden açılıyor ve buraya çiziliyor. Başlıkta
 * ikinci bir düğme kalmadı.
 */
export function ColumnFilterPopover({ section, filters, onChange, statuses, teamId, projectId, onClose }: Omit<FilterHeadProps, 'label'> & { onClose: () => void }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const n = sectionCount(filters, section)
  usePopupLayer(true, box, onClose)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true) }
  }, [onClose])
  return (
    <div ref={box} role="menu" className="absolute left-2 top-full z-30 mt-1 w-60 max-h-80 overflow-y-auto scrollbar-thin bg-surface border border-line rounded-xl shadow-2xl py-1 normal-case tracking-normal font-normal text-left">
      <FilterOptions section={section} filters={filters} onChange={onChange} statuses={statuses} teamId={teamId} projectId={projectId} />
      {n > 0 && (
        <button
          type="button"
          onClick={() => onChange(clearSection(filters, section))}
          className="w-full text-left px-3 py-2 text-xs text-fg-muted hover:bg-raised hover:text-fg border-t border-line-soft mt-1"
        >
          {t('board.list.clearColumnFilter')}
        </button>
      )}
    </div>
  )
}
