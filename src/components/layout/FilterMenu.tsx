import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { usePopupLayer } from '../../lib/popups'
import { onShortcut } from '../../lib/shortcuts'
import type { TicketFilters, TicketStatus } from '../../types'
import { countActiveFilters, hasAnyFilter, clearFilters } from '../../lib/ticketFilters'
import { useT, type TranslationKey } from '../../i18n'
import { FilterOptions, sectionCount as countInSection, filterRowClass as row, type FilterSection } from './FilterOptions'

interface Props {
  filters: TicketFilters
  onChange: (f: TicketFilters) => void
  statuses: TicketStatus[]
  teamId: string | null
  projectId: string
  /** At the right edge of a row: the menu opens leftwards (its submenu too). */
  align?: 'left' | 'right'
}

type Section = FilterSection

// Only the translation key lives here: a table of labels built at module scope
// would be evaluated once at import and freeze on the language of that moment.
const SECTIONS: { key: Section; labelKey: TranslationKey; icon: React.ReactNode }[] = [
  { key: 'assignee', labelKey: 'board.filter.assignee', icon: <Icon name="person" /> },
  { key: 'tags', labelKey: 'board.filter.tags', icon: <Icon name="tag" /> },
  { key: 'priority', labelKey: 'board.filter.priority', icon: <Icon name="flag" /> },
  { key: 'status', labelKey: 'board.filter.status', icon: <Icon name="half" /> },
  { key: 'due', labelKey: 'board.filter.due', icon: <Icon name="calendar" /> },
]

/**
 * MS Planner-like filter control: "Filtre (n)", same place in every view.
 * The list search that sat beside it moved to the top bar's command palette
 * (#9ab8db99): "/" opens the palette narrowed to the open list.
 */
export function FilterMenu({ filters, onChange, statuses, teamId, projectId, align = 'left' }: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<Section | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const count = countActiveFilters(filters)

  usePopupLayer(open, rootRef, () => setOpen(false))
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true) }
  }, [open])

  // Keyboard shortcut (see lib/shortcuts, Ctrl+Shift+F): toggles the filter menu.
  // Opened from the keyboard, the menu should be usable from the keyboard: focus
  // lands on the first criterion, arrows move, → opens a criterion, ← comes back.
  const menuRef = useRef<HTMLDivElement>(null)
  const wantFocus = useRef(false)
  // The submenu is rendered twice (inline for phones, flyout for desktop) and
  // only one is displayed; focusing the hidden copy silently does nothing.
  const visible = (els: Iterable<HTMLElement>) => Array.from(els).filter((el) => el.getClientRects().length > 0)
  const firstVisible = (selector: string) => visible(menuRef.current?.querySelectorAll<HTMLElement>(selector) ?? [])[0]
  useEffect(() => onShortcut('filter', () => {
    wantFocus.current = true
    setOpen((o) => !o)
    setSection(null)
  }), [])
  // Runs after the dropdown is in the DOM — a requestAnimationFrame fired from
  // the shortcut handler came before React had rendered it.
  useEffect(() => {
    if (!open || !wantFocus.current) return
    wantFocus.current = false
    firstVisible('[data-nav]')?.focus()
  }, [open])
  // Same for the flyout: → opens a criterion and wants its first row focused.
  const wantSubFocus = useRef(false)
  useEffect(() => {
    if (!section || !wantSubFocus.current) return
    wantSubFocus.current = false
    firstVisible('[data-sub] [data-nav]')?.focus()
  }, [section])

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = visible(menuRef.current?.querySelectorAll<HTMLElement>('[data-nav]') ?? [])
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    const move = (n: number) => { e.preventDefault(); items[(i + n + items.length) % items.length]?.focus() }
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus() }
    else if (e.key === 'ArrowRight') {
      const key = (document.activeElement as HTMLElement | null)?.dataset.section as Section | undefined
      if (key) {
        e.preventDefault()
        if (key === section) { firstVisible('[data-sub] [data-nav]')?.focus() } // already open: just move in
        else { wantSubFocus.current = true; setSection(key) }
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
      const inSub = !!(document.activeElement as HTMLElement | null)?.closest('[data-sub]')
      if (inSub) { e.preventDefault(); const key = section; setSection(null); requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>(`[data-section="${key}"]`)?.focus()) }
    }
  }

  const sectionCount = (s: Section) => countInSection(filters, s)

  const renderSub = (s: Section) => (
    <FilterOptions section={s} filters={filters} onChange={onChange} statuses={statuses} teamId={teamId} projectId={projectId} />
  )

  return (
    <div ref={rootRef} className="relative flex items-center gap-1">
      {/* Filter button */}
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setSection(null) }}
        aria-expanded={open}
        data-shortcut="filter"
        title={t('board.filter.title')}
        className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl transition-colors min-h-[36px] ${
          count > 0 ? 'bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300 font-medium' : 'text-fg-muted hover:text-fg hover:bg-raised'
        }`}
      >
        <Icon name="filter" />
        <span className="hidden sm:inline">{t('board.filter.label')}</span>
        {count > 0 && <span className="tabular-nums">({count})</span>}
      </button>

      {/* Dropdown */}
      {open && (
        <div ref={menuRef} onKeyDown={onMenuKeyDown} className={`absolute ${align === 'right' ? 'right-0 flex-row-reverse' : 'left-0'} top-full mt-1.5 z-30 flex items-start animate-fade-in`}>
          <div className="w-64 bg-surface border border-line rounded-xl shadow-lg py-1.5">
            <div className="flex items-center justify-between px-3 pb-1.5 pt-0.5">
              <span className="text-sm font-semibold text-fg">{t('board.filter.heading')}</span>
              {hasAnyFilter(filters) && (
                <button className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline" onClick={() => { onChange(clearFilters(filters)); setSection(null) }}>
                  {t('board.filter.clearAll')}
                </button>
              )}
            </div>
            {SECTIONS.map((s) => {
              const n = sectionCount(s.key)
              const active = section === s.key
              return (
                <div key={s.key}>
                  <button
                    data-nav
                    data-section={s.key}
                    className={`${row} focus-visible:bg-raised focus-visible:text-fg outline-none ${active ? 'bg-raised text-fg' : ''}`}
                    onClick={() => { if (!active) wantSubFocus.current = true; setSection(active ? null : s.key) }}
                    onMouseEnter={() => setSection(s.key)}
                    aria-expanded={active}
                  >
                    <span className="text-fg-muted">{s.icon}</span>
                    <span className="flex-1">{t(s.labelKey)}{n > 0 && <span className="ml-1 text-primary-600 dark:text-primary-400 tabular-nums">({n})</span>}</span>
                    <Icon name="chevronRight" className={`text-fg-faint transition-transform md:rotate-0 ${active ? 'rotate-90' : ''}`} />
                  </button>
                  {/* Mobile: inline submenu */}
                  {active && <div data-sub className="md:hidden border-t border-line-soft bg-raised/40 max-h-64 overflow-auto py-1">{renderSub(s.key)}</div>}
                </div>
              )
            })}
            <div className="border-t border-line-soft mt-1 pt-1">
              <label className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-fg-2 hover:bg-raised cursor-pointer">
                <input data-nav type="checkbox" className="rounded-md" checked={!!filters.show_closed} onChange={(e) => onChange({ ...filters, show_closed: e.target.checked || undefined })} />
                {t('board.filter.showClosed')}
              </label>
              <label className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-fg-2 hover:bg-raised cursor-pointer">
                <input data-nav type="checkbox" className="rounded-md" checked={!!filters.show_children} onChange={(e) => onChange({ ...filters, show_children: e.target.checked || undefined })} />
                {t('board.filter.showChildren')}
              </label>
              {/* Backlog is on by default; unchecking hides "Planlanıyor" items. */}
              <label className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-fg-2 hover:bg-raised cursor-pointer">
                <input data-nav type="checkbox" className="rounded-md" checked={filters.show_backlog !== false} onChange={(e) => onChange({ ...filters, show_backlog: e.target.checked ? undefined : false })} />
                {t('board.filter.showBacklog')}
              </label>
            </div>
          </div>
          {/* Desktop: flyout submenu */}
          {section && (
            <div data-sub className={`hidden md:block ${align === 'right' ? 'mr-1' : 'ml-1'} w-64 max-h-80 overflow-auto bg-surface border border-line rounded-xl shadow-lg py-1.5`}>
              {renderSub(section)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
