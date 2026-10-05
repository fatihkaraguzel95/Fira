import { useRef, useState, type ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useT } from '../../i18n'
import { useRowMenu, type RowMenuItem } from '../ui/RowMenu'
import type { ColumnKey, SortDir } from '../../lib/listView'

/**
 * One column header of the new list (TL-05): draggable to reorder (name column
 * stays put), a sort button, a ⋯ menu (sort / move / hide) and a resize handle
 * on the right edge (drag; double-click fits the content). The cell content —
 * the plain label or the filtering button — comes from the caller.
 */
export const MIN_COL_WIDTH = 60
/** Ad sütunu elle daraltılabilir ama okunur kalmalı. */
export const MIN_NAME_WIDTH = 160

export interface HeadCellProps {
  colKey: ColumnKey
  label: string
  width?: number
  fixed?: boolean
  sortable: boolean
  sortDir: SortDir | null
  ariaSort: 'ascending' | 'descending' | 'none'
  onSort: (dir: SortDir | null) => void
  onMove: (to: 'start' | 'end') => void
  onHide?: () => void
  onResize?: (width: number) => void
  onAutoFit?: () => void
  /** Ad sütunu: elle verilen genişliği bırakıp kalan alanı doldur. */
  onFill?: () => void
  /** Bu sütunun daralabileceği en küçük genişlik. */
  minWidth?: number
  /** Reordering / resizing off (touch, narrow screens). */
  interactive?: boolean
  /** Sürüklenen sütun buraya bırakılacaksa hangi kenara (#b1a31526). */
  dropEdge?: 'before' | 'after' | null
  /** Bu sütunda kaç filtre seçili (başlıkta sayı olarak görünür). */
  filterCount?: number
  /** Menüye "Filtrele" girdisi ekler; açılan kutuyu `filterPopover` çizer. */
  onFilter?: () => void
  /** Menü açılırken çağrılır — açık filtre kutusu kapansın diye. */
  onMenuOpen?: () => void
  filterPopover?: ReactNode
  className?: string
  children?: ReactNode
}

export function HeadCell({ colKey, label, width, fixed = false, sortable, sortDir, ariaSort, onSort, onMove, onHide, onResize, onAutoFit, onFill, minWidth = MIN_COL_WIDTH, interactive = true, dropEdge = null, filterCount = 0, onFilter, onMenuOpen, filterPopover, className = '' }: HeadCellProps) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: colKey, disabled: fixed || !interactive })
  const [live, setLive] = useState<number | null>(null)
  const labelRef = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ x0: number; w0: number } | null>(null)

  const items: RowMenuItem[] = []
  if (sortable) {
    items.push({ key: 'asc', label: t('board.list.sortAsc'), onSelect: () => onSort('asc') })
    items.push({ key: 'desc', label: t('board.list.sortDesc'), onSelect: () => onSort('desc') })
    if (sortDir) items.push({ key: 'none', label: t('board.list.sortNone'), onSelect: () => onSort(null) })
  }
  if (onFilter) items.push({ key: 'filter', label: t('board.list.col.filter'), onSelect: onFilter, separated: items.length > 0 })
  if (!fixed && interactive) {
    items.push({ key: 'start', label: t('board.list.col.moveStart'), onSelect: () => onMove('start'), separated: items.length > 0 })
    items.push({ key: 'end', label: t('board.list.col.moveEnd'), onSelect: () => onMove('end') })
  }
  if (onAutoFit && interactive) items.push({ key: 'fit', label: t('board.list.col.autoFit'), onSelect: onAutoFit, separated: true })
  if (onFill && interactive) items.push({ key: 'fill', label: t('board.list.col.fill'), onSelect: onFill })
  if (onHide && !fixed) items.push({ key: 'hide', label: t('board.list.col.hide'), onSelect: onHide, danger: true, separated: true })
  const menu = useRowMenu(items, { label: t('board.list.col.menu', { name: label }) })

  const startResize = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!onResize) return
    e.preventDefault(); e.stopPropagation()
    const th = (e.currentTarget as HTMLElement).closest('th') as HTMLElement | null
    const w0 = width ?? th?.getBoundingClientRect().width ?? 120
    drag.current = { x0: e.clientX, w0 }
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => { if (drag.current) setLive(Math.max(minWidth, Math.round(drag.current.w0 + ev.clientX - drag.current.x0))) }
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp)
      if (drag.current) { const w = Math.max(minWidth, Math.round(drag.current.w0 + ev.clientX - drag.current.x0)); drag.current = null; setLive(null); onResize(w) }
    }
    el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp)
  }

  const w = live ?? width
  const style: React.CSSProperties = {
    ...(w ? { width: w, minWidth: w } : {}),
    transform: CSS.Translate.toString(transform), transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <th
      ref={setNodeRef}
      scope="col"
      aria-sort={ariaSort}
      data-col={colKey}
      style={style}
      onContextMenu={menu.onContextMenu}
      {...(fixed || !interactive ? {} : { ...attributes, role: undefined, ...listeners })}
      className={`group/head relative px-2 py-2 text-xs font-medium text-fg-muted select-none border-r border-line-soft last:border-r-0 hover:bg-raised/60 transition-colors ${!fixed && interactive ? 'cursor-move' : ''} ${isDragging ? 'z-20 bg-raised' : ''} ${className}`}
    >
      {/* Nereye düşeceği belli olsun (#b1a31526): sürüklenen sütun bu başlığın
          hangi yanına gelecekse o kenarda kalın bir çizgi çıkar. */}
      {dropEdge === 'before' && <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-primary-500 rounded-full" aria-hidden />}
      {dropEdge === 'after' && <span className="absolute right-0 top-1 bottom-1 w-0.5 bg-primary-500 rounded-full" aria-hidden />}
      {/* Başlıkta yalnız sütunun adı var (#d8a62c6e, kullanıcı isteği): sıralama
          oku ve ⋯ düğmesi kalktı, ikisi de adın açtığı menüde. Ok yalnız o
          sütuna göre sıralanıyorken çıkar — o bir kontrol değil, durum bilgisi. */}
      <button
        ref={labelRef}
        type="button"
        aria-haspopup={items.length ? 'menu' : undefined}
        aria-expanded={menu.open || undefined}
        // Basılı tutma olayları dnd-kit'e geçsin: başlık adı sütunun neredeyse
        // tamamını kapladığı için sürükleme buradan başlıyor. Sensörün 6 px
        // eşiği sayesinde düz tıklama sürükleme sayılmıyor, menü açılıyor.
        onClick={(e) => { e.stopPropagation(); if (menu.open) { menu.close(); return } onMenuOpen?.(); menu.openAt(labelRef.current) }}
        className={`flex items-center gap-1 min-w-0 w-full text-left rounded-md px-0.5 -mx-0.5 transition-colors ${menu.open ? 'text-fg' : 'hover:text-fg'} ${filterCount > 0 ? 'text-primary-600 dark:text-primary-400' : ''}`}
      >
        <span className="truncate">{label}</span>
        {filterCount > 0 && <span className="tabular-nums flex-shrink-0">({filterCount})</span>}
        {sortDir && (
          <Icon name={sortDir === 'asc' ? 'chevronUp' : 'chevronDown'} className="text-primary-600 dark:text-primary-400" />
        )}
      </button>
      {menu.menu}
      {filterPopover}
      {onResize && interactive && (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={t('board.list.col.resize', { name: label })}
          title={t('board.list.col.resize', { name: label })}
          onPointerDown={startResize}
          onDoubleClick={(e) => { e.stopPropagation(); onAutoFit?.() }}
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-0 -right-0.5 h-full w-2.5 cursor-col-resize touch-none z-10 ${live !== null ? 'bg-primary-500/50' : 'hover:bg-primary-500/30'}`}
        />
      )}
    </th>
  )
}
