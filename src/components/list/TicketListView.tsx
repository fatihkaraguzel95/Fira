import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core'
import { SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { holdStill } from '../layout/treeDnd'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useNavigate } from 'react-router-dom'
import { openTicket } from '../../lib/nav'
import type { Ticket, TicketFilters } from '../../types'
import { isCompleteStatus } from '../../types'
import { useT } from '../../i18n'
import { useGhosts, useMaterialize, GhostRow } from './GhostRows'
import { useDateFormat } from '../../lib/time'
import { dueOptions } from '../../lib/ticketFilters'
import {
  type ListViewConfig, type ColumnKey, type Group, type Row,
  sortTickets, groupTickets, buildRows, rootTickets, childProgress, groupPreset, presetFromFilters, mergePresets, moveColumn, rangeBetween, rowDropMode, descendantIds, placeInOrder, GROUP_BYS, COLUMN_KEYS,
  type RowDropMode,
} from '../../lib/listView'
import { useUpdateTicket, useReorderTickets, useMoveTicket } from '../../hooks/useTickets'
import { useSetParent } from '../../hooks/useChildren'
import { useBulkTickets } from '../../hooks/useBulkTickets'
import { QuickAddRow } from './QuickAddRow'
import { BulkActionBar } from './BulkActionBar'
import { csvOf, downloadText } from '../../lib/listCsv'
import { PRIORITY_LABELS, openBlockers } from '../../types'
import { useAuth } from '../../hooks/useAuth'
import { TitleEditor, StatusCell, PriorityFlag } from './InlineCells'
import { MetaIcon } from './MetaIcons'
import { AgentWorkBadge } from '../agents/AgentWorkBadge'
import { useNames } from '../layout/FavoritesSection'
import { ListToolbar } from './ListToolbar'
import { useTicketListData, type ListSource } from '../../hooks/useTicketListData'
import { COLUMNS, type CellContext } from './columns'
import { ColumnFilterPopover } from './FilterHead'
import { sectionCount } from '../layout/FilterOptions'
import { HeadCell, MIN_NAME_WIDTH } from './ColumnHeader'
import { ToolbarMenu, ColumnPickerItems } from './ListToolbar'
import { ShareLinkButton } from '../ui/ShareLinkButton'
import { StatusIndicator } from '../ticket/StatusIndicator'
import { UserAvatar } from '../ticket/UserAvatar'
import { ListAvatar } from '../ui/ListIcon'

interface Props {
  source: ListSource
  config: ListViewConfig
  onConfigChange: (c: ListViewConfig) => void
  /** The board's header filter, so a column header can edit it (project source only). */
  filters?: TicketFilters
  onFiltersChange?: (f: TicketFilters) => void
  /** Hide the list's own toolbar (grouping…) when the screen provides one. */
  toolbar?: boolean
  /** The screen's defaults, for "reset view" (TL-10). */
  defaultConfig?: ListViewConfig
}

/**
 * The one ticket list (#883CF8 / TL-01). Rows come from a `ListSource`, the
 * shape from a `ListViewConfig`, the cells from the column catalogue. Whatever
 * the screen — a list's table, "my tasks", a team's tasks — it is this
 * component with a different source and config.
 *
 * TL-01 draws: sticky header with sort, grouped sections, subtask rows with
 * depth, the classic empty and loading states. Grouping controls, subtask
 * modes, column picking, inline edit, quick add and selection arrive in the
 * following subtasks — all as readers and writers of the same config.
 */
export function TicketListView({ source, config, onConfigChange, filters, onFiltersChange, toolbar = true, defaultConfig }: Props) {
  const t = useT()
  useDateFormat()   // repaint when the chosen date format changes
  const navigate = useNavigate()
  // Cross-list sources fetch only the embeds a visible column (or the meta icons) needs (TL-12).
  const fields = useMemo(() => {
    const cols = new Set(config.columns.map((c) => c.key))
    return {
      tags: cols.has('tags') || config.showTagsInline || config.groupBy === 'tags',
      blockers: config.showMeta,
      attachments: cols.has('activity') || config.showMeta,
      deadlines: cols.has('deadlines'),
      comments: cols.has('activity') || config.showMeta,
      creator: cols.has('creator'),
      checklist: cols.has('checklist'),
    }
  }, [config.columns, config.showTagsInline, config.groupBy, config.showMeta])
  const sourceWithClosed = useMemo<ListSource>(() => (source.kind === 'project' ? source : { ...source, includeClosed: config.showClosed, fields }), [source, config.showClosed, fields])
  const data = useTicketListData(sourceWithClosed)
  const { user } = useAuth()
  const now = useMemo(() => new Date(), [data.tickets])   // eslint-disable-line react-hooks/exhaustive-deps

  const canFilter = !!filters && !!onFiltersChange && !!data.projectId
  const compact = config.density === 'compact'
  // ClickUp-like density (TL-13): ~40 px rows, ~32 px when compact.
  const cellPad = compact ? 'px-2 py-0.5' : 'px-3 py-1.5'
  const updateTicket = useUpdateTicket()
  const update = (id: string, input: Parameters<typeof updateTicket.mutate>[0]['input']) => updateTicket.mutate({ id, input })
  const ctx: CellContext = { t, teamId: data.teamId, canWrite: data.canWrite, project: data.project, now, projectId: data.projectId, statuses: data.statuses, update }
  // Editable cells need a single list (its statuses, tags, team); cross-list sources stay read-only until TL-09's per-row context.
  const editable = data.canWrite && !!data.projectId
  const [editingTitle, setEditingTitle] = useState<string | null>(null)
  // Windowing (TL-12): only the rows near the viewport are in the DOM once the
  // list is long. Heights are fixed per kind (wrapped text opts out), so the
  // spacers are exact and the scrollbar honest.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 800, width: 0 })
  useEffect(() => {
    const el = scrollerRef.current; if (!el) return
    let raf = 0
    const read = () => {
      raf = 0
      // Scrolled sideways: the sticky name column casts a shadow (index.css, TL-13).
      if (el.scrollLeft > 0) el.setAttribute('data-scrolled-x', ''); else el.removeAttribute('data-scrolled-x')
      setViewport((v) => (v.top === el.scrollTop && v.height === el.clientHeight && v.width === el.clientWidth ? v : { top: el.scrollTop, height: el.clientHeight, width: el.clientWidth }))
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read) }
    read()
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll); ro.observe(el)
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); if (raf) cancelAnimationFrame(raf) }
  }, [])
  // Multi-selection (TL-08): ids, kept across regrouping/sorting, dropped when the source changes.
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const anchorRef = useRef<string | null>(null)
  const orderRef = useRef<string[]>([])   // click order: the bulk bar's "first selected"
  const canSelect = data.canWrite || source.kind === 'me'
  useEffect(() => { setSelected(new Set()) }, [source.kind, data.projectId])
  const toggleOne = (id: string, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (e?.shiftKey && anchorRef.current) {
        for (const x of rangeBetween(visibleIdsRef.current, anchorRef.current, id)) next.add(x)
      } else if (next.has(id)) next.delete(id); else next.add(id)
      orderRef.current = [...orderRef.current.filter((x) => next.has(x)), ...Array.from(next).filter((x) => !orderRef.current.includes(x))]
      return next
    })
    if (!e?.shiftKey) anchorRef.current = id
  }
  const visibleIdsRef = useRef<string[]>([])
  const setMany = (ids: string[], on: boolean) => setSelected((prev) => { const next = new Set(prev); for (const id of ids) { if (on) next.add(id); else next.delete(id) } orderRef.current = [...orderRef.current.filter((x) => next.has(x)), ...Array.from(next).filter((x) => !orderRef.current.includes(x))]; return next })
  useEffect(() => {
    if (!selected.size) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('[role="dialog"], input, textarea, [contenteditable]')) { setSelected(new Set()) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected.size])

  // Narrow screens: the three columns that fit; the rest waits for landscape (TL-05).
  const isMobile = useIsMobile()
  // Grouped by status: the column repeats the group header and the leading dot, so it is folded away (TL-13).
  const hiddenColumns = useMemo<ColumnKey[]>(() => [...(data.projectId ? ['project' as const] : []), ...(config.groupBy === 'status' ? ['status' as const] : [])], [data.projectId, config.groupBy])
  const columns = useMemo(() => {
    const cols = config.columns.filter((c) => !hiddenColumns.includes(c.key))
    const shownCols = isMobile ? cols.filter((c) => c.key === 'name' || c.key === 'status' || c.key === 'assignees') : cols
    return shownCols.map((c) => ({ ...COLUMNS[c.key], width: c.width ?? COLUMNS[c.key].width }))
  }, [config.columns, isMobile, hiddenColumns])
  // The name column is fluid (ClickUp): at least its set width, and whatever the other columns leave of the viewport.
  const otherWidth = (canSelect ? 32 : 0) + columns.reduce((s, c) => s + (c.key === 'name' ? 0 : c.width), 0) + (isMobile ? 0 : 60)
  // Ad sütunu boşluğu doldurur (TL-13) — ama kullanıcı elle daralttıysa ona
  // uyar (#b1a31526: "daraltma isteğini reddediyor"). Elle verilen genişlik
  // `manualName`; yoksa akışkan davranış sürer.
  const manualName = config.columns.find((c) => c.key === 'name')?.width
  const nameWidth = isMobile ? 220 : manualName ? Math.max(MIN_NAME_WIDTH, manualName) : Math.max(240, viewport.width - otherWidth - 4)
  const tableWidth = otherWidth + nameWidth
  // Hayalet tekrarlar (#59e0b75e): yalnız tek liste görünümünde, listenin sonunda.
  const ghosts = useGhosts(source.kind === 'project' ? data.projectId : null, source.kind === 'project')
  const materialize = useMaterialize()

  // One DndContext for headers (ids = column keys) and rows (ids = ticket ids, TL-11).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  )
  const isColumnId = (id: unknown): id is ColumnKey => typeof id === 'string' && (COLUMN_KEYS as string[]).includes(id)
  /** Sürüklenen sütunun nereye düşeceği: hedef başlık ve hangi kenarı (#b1a31526). */
  const [colDrop, setColDrop] = useState<{ key: ColumnKey; edge: 'before' | 'after' } | null>(null)
  /** Filtre kutusu açık olan sütun (başlık menüsünden açılır). */
  const [filterCol, setFilterCol] = useState<ColumnKey | null>(null)
  const onHeaderDragEnd = ({ active, over }: DragEndEvent) => {
    const hint = colDrop
    setColDrop(null)
    // Gösterdiğimiz çizgi neredeyse oraya bırakılır; ipucu yoksa dnd-kit'in hedefi.
    const targetKey = hint?.key ?? (isColumnId(over?.id) && over!.id !== 'name' ? (over!.id as ColumnKey) : null)
    if (!targetKey || active.id === targetKey) return
    // `moveColumn` sutunu once cikarip sonra ekliyor: hedef sirasi da
    // surukleneni dislayan dizide aranmali, yoksa bir hane kayiyor.
    const rest = config.columns.filter((c) => c.key !== 'name' && c.key !== active.id)
    const idx = rest.findIndex((c) => c.key === targetKey)
    if (idx < 0) return
    onConfigChange({ ...config, columns: moveColumn(config.columns, active.id as ColumnKey, hint?.edge === 'after' ? idx + 1 : idx) })
  }
  const setWidth = (key: ColumnKey, width: number) => onConfigChange({ ...config, columns: config.columns.map((c) => (c.key === key ? { ...c, width } : c)) })
  /** Elle verilen genişliği bırak: sütun yine kalan alanı doldursun (ad sütunu). */
  const clearWidth = (key: ColumnKey) => onConfigChange({ ...config, columns: config.columns.map((c) => (c.key === key ? { ...c, width: undefined } : c)) })
  const autoFit = (key: ColumnKey) => {
    const cells = Array.from(document.querySelectorAll<HTMLElement>(`[data-list-view] td[data-col="${key}"] > *`))
    const head = document.querySelector<HTMLElement>(`[data-list-view] th[data-col="${key}"] > span`)
    const w = Math.max(60, ...cells.map((el) => el.scrollWidth), head?.scrollWidth ?? 0) + 34
    setWidth(key, Math.min(600, Math.round(w)))
  }

  // Closed rows: the board's header filter (show_closed) and the cross-list
  // queries already decide this; `config.showClosed` takes over in TL-10.
  // Subtasks (TL-03): in the nested modes every subtask rides under its parent
  // regardless of the "show subtasks" filter; "separate" keeps the classic
  // rule — subtasks are rows of their own only when that filter is on.
  const nested = config.subtaskMode !== 'separate'
  const showClosed = config.showClosedSubtasks || config.showClosed || !!filters?.show_closed
  const { shown, pool, hiddenDone } = useMemo(() => {
    const all = config.meMode && user && source.kind !== 'me' ? data.tickets.filter((t) => (t.assignees ?? []).some((a) => a.user_id === user.id)) : data.tickets
    if (!nested) {
      const flat = filters && !filters.show_children ? all.filter((t) => !t.parent_id) : all
      return { shown: flat, pool: flat, hiddenDone: new Map<string, number>() }
    }
    const ids = new Set(all.map((t) => t.id))
    const hiddenDone = new Map<string, number>()
    const pool = showClosed ? all : all.filter((t) => {
      if (t.parent_id && ids.has(t.parent_id) && isCompleteStatus(t.status_info)) { hiddenDone.set(t.parent_id, (hiddenDone.get(t.parent_id) ?? 0) + 1); return false }
      return true
    })
    return { shown: rootTickets(pool), pool, hiddenDone }
  }, [data.tickets, nested, filters, showClosed, config.meMode, user, source.kind])

  const groups = useMemo<Group[]>(() => {
    const sorted = sortTickets(shown, config.sort)
    return groupTickets(sorted, config.groupBy, { statuses: data.statuses, now, multi: config.groupMulti }, config.showEmptyGroups)
  }, [shown, config.sort, config.groupBy, config.groupMulti, config.showEmptyGroups, data.statuses, now])
  const sortedPool = useMemo(() => sortTickets(pool, config.sort), [pool, config.sort])

  // Parents that are not in this list (other list, filtered out): name them above the orphan.
  const orphanParentIds = useMemo(() => {
    const ids = new Set(data.tickets.map((t) => t.id))
    return Array.from(new Set(data.tickets.filter((t) => t.parent_id && !ids.has(t.parent_id)).map((t) => t.parent_id!)))
  }, [data.tickets])
  const parentNames = useNames('ticket', orphanParentIds)
  const parentTitle = (id: string) => data.tickets.find((x) => x.id === id)?.title ?? parentNames.data?.find((n) => n.id === id)?.name

  // "Collapse" mode = every parent folded, opened in place one by one (not persisted);
  // "Expand" mode = every parent open, folded ones remembered in the config.
  const [openParents, setOpenParents] = useState<Set<string>>(() => new Set())
  useEffect(() => { setOpenParents(new Set()) }, [config.subtaskMode, source.kind])
  const [addingUnder, setAddingUnder] = useState<string | null>(null)

  // "+ Görev ekle" under a group header: the new task takes the group's value (TL-02; TL-07 grows this row).
  const [addingIn, setAddingIn] = useState<string | null>(null)
  const canAdd = (data.canWrite && !!data.projectId) || source.kind === 'me'
  const filterPreset = useMemo(() => presetFromFilters(filters, now), [filters, now])
  useEffect(() => { setAddingIn(null) }, [config.groupBy, source.kind])

  const collapsedParents = useMemo(() => new Set(config.collapsed.filter((k) => k.startsWith('parent:')).map((k) => k.slice(7))), [config.collapsed])
  const hiddenParents = useMemo(() => {
    if (config.subtaskMode === 'expand') return collapsedParents
    const all = new Set<string>()
    for (const t of pool) if (t.parent_id) all.add(t.parent_id)
    for (const id of openParents) all.delete(id)
    return all
  }, [config.subtaskMode, collapsedParents, pool, openParents])
  const isFolded = (id: string) => hiddenParents.has(id)
  // Fold everything at once (TL-04). Group keys and parent keys share `config.collapsed`
  // (parents are prefixed), so one list can be changed without touching the other.
  const parentIds = useMemo(() => { const out = new Set<string>(); for (const t of pool) if (t.parent_id) out.add(t.parent_id); return Array.from(out).filter((id) => pool.some((t) => t.id === id)) }, [pool])
  const setGroupsFolded = (fold: boolean) => {
    const keep = config.collapsed.filter((k) => k.startsWith('parent:'))
    onConfigChange({ ...config, collapsed: fold ? [...keep, ...groups.map((g) => g.key)] : keep })
  }
  const setParentsFolded = (fold: boolean) => {
    if (config.subtaskMode === 'expand') {
      const keep = config.collapsed.filter((k) => !k.startsWith('parent:'))
      onConfigChange({ ...config, collapsed: fold ? [...keep, ...parentIds.map((id) => `parent:${id}`)] : keep })
    } else setOpenParents(fold ? new Set() : new Set(parentIds))
  }
  const toggleParent = (id: string) => {
    if (config.subtaskMode === 'expand') toggleCollapsed(`parent:${id}`)
    else setOpenParents((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  // Adding a subtask opens the parent, even one that has no children yet: in
  // "collapse" mode a parent is folded by default, so the first subtask would
  // otherwise vanish the moment it was created (#e85bfe14).
  const unfoldParent = (id: string) => {
    if (config.subtaskMode === 'expand') { if (config.collapsed.includes(`parent:${id}`)) toggleCollapsed(`parent:${id}`) }
    else setOpenParents((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }
  const collapsedGroups = useMemo(() => new Set(config.collapsed.filter((k) => !k.startsWith('parent:'))), [config.collapsed])

  const toggleCollapsed = (key: string) => {
    const has = config.collapsed.includes(key)
    onConfigChange({ ...config, collapsed: has ? config.collapsed.filter((k) => k !== key) : [...config.collapsed, key] })
  }

  const open = (id: string) => openTicket(navigate, id)
  // Row keys (TL-06): Enter/Space open the task; ←/→ walk the cells; Enter on a
  // cell presses its control; F2 renames; Escape returns to the row.
  const onRowKey = (e: React.KeyboardEvent<HTMLTableRowElement>, ticket: Ticket) => {
    const target = e.target as HTMLElement
    const row = e.currentTarget
    const cells = Array.from(row.querySelectorAll<HTMLElement>(':scope > td'))
    const cellOf = target.closest('td') as HTMLElement | null
    const atRow = target === row
    if (e.key === 'F2' && editable) { e.preventDefault(); setEditingTitle(ticket.id); return }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (atRow || target === cellOf)) {
      e.preventDefault()
      const dir = e.key === 'ArrowUp' ? -1 : 1
      if (e.altKey && canDrag) { moveByKey(ticket, dir, 'order'); return }
      if ((e.ctrlKey || e.metaKey) && canDrag) { moveByKey(ticket, dir, 'group'); return }
      const order = visibleIdsRef.current
      const nextId = order[order.indexOf(ticket.id) + dir]
      if (!nextId) return
      const focusNext = () => { const el = document.querySelector<HTMLElement>(`[data-list-view] tr[data-ticket-id="${nextId}"]`); if (el) { el.focus(); el.scrollIntoView({ block: 'nearest' }) } return !!el }
      if (!focusNext()) { const sc = scrollerRef.current; if (sc) sc.scrollTop += dir * (compact ? 32 : 40) * 4; requestAnimationFrame(() => requestAnimationFrame(() => focusNext())) }
      return
    }
    if (e.key === ' ' && atRow && canSelect) { e.preventDefault(); toggleOne(ticket.id); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && canSelect) { e.preventDefault(); setMany(visibleIdsRef.current, true); return }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (!atRow && !cellOf) return
      e.preventDefault()
      const idx = cellOf ? cells.indexOf(cellOf) : -1
      const next = e.key === 'ArrowRight' ? Math.min(cells.length - 1, idx + 1) : Math.max(0, idx - 1)
      cells[next]?.focus()
      return
    }
    if (e.key === 'Escape' && cellOf && target === cellOf) { e.preventDefault(); row.focus(); return }
    if ((e.key === 'Enter' || e.key === ' ') && (atRow || target === cellOf)) {
      e.preventDefault()
      if (atRow) { open(ticket.id); return }
      const control = cellOf!.querySelector<HTMLElement>('button, input, [role="button"]')
      if (control) control.click(); else open(ticket.id)
    }
  }
  const grouped = config.groupBy !== 'none'
  const colCount = columns.length + (isMobile ? 0 : 1) + (canSelect ? 1 : 0)   // + trailing "add column" cell + selection cell

  // ── Row drag-and-drop (TL-11) ──────────────────────────────────────────────
  // Dropping on a group header (or between its rows) changes the grouped field;
  // between rows of the same status group with no sort = manual order (reorder
  // RPC, same as the board); on a row's right half = make it a subtask.
  const reorder = useReorderTickets()
  const moveTicket = useMoveTicket()
  const setParent = useSetParent()
  const bulk = useBulkTickets()
  const canDrag = data.canWrite && !!data.projectId && !isMobile
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ kind: 'row'; id: string; mode: RowDropMode } | { kind: 'group'; key: string } | null>(null)
  const groupOf = (id: string) => groups.find((g) => g.tickets.some((x) => x.id === id) || (nested && sortedPool.some((x) => x.id === id) && g.tickets.some((r) => descendantIds(sortedPool, r.id).has(id))))
  // The pointer is tracked directly: dnd-kit's delta folds in the scroll of the
  // list container, so "activator + delta" drifts as soon as the list scrolls.
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const resolveAt = (pt: { x: number; y: number } | null) => {
    if (!pt) return null
    const el = document.elementFromPoint(pt.x, pt.y) as HTMLElement | null
    const rowEl = el?.closest<HTMLElement>('[data-list-view] tr[data-ticket-id]')
    if (rowEl) {
      const id = rowEl.getAttribute('data-ticket-id')!
      if (id === dragId || (dragId && descendantIds(data.tickets, dragId).has(id))) return null
      const r = rowEl.getBoundingClientRect()
      let mode = rowDropMode({ top: r.top, height: r.height, left: r.left + (canSelect ? 32 : 0) }, pt.x, pt.y, 140)
      const target = data.tickets.find((x) => x.id === id)
      if (mode === 'nest' && (!nested || (target && (target.parent_id ? data.tickets.some((x) => x.id === target.parent_id && x.parent_id) : false)))) mode = 'after'
      return { kind: 'row' as const, id, mode }
    }
    const gEl = el?.closest<HTMLElement>('[data-list-view] tr[data-group]')
    if (gEl) return { kind: 'group' as const, key: gEl.getAttribute('data-group')! }
    return null
  }
  const resolveRef = useRef(resolveAt); resolveRef.current = resolveAt
  /**
   * İmlecin yatayda hangi başlığın üzerinde ve hangi yarısında olduğu.
   * `elementFromPoint` kullanılmıyor: sürükleme katmanı imlecin altını kapatıyor
   * ve hedef hep boş çıkıyordu (#b1a31526 — "nereye bıraktığımı anlamıyorum").
   */
  const columnDropAt = (x: number, dragged: ColumnKey): { key: ColumnKey; edge: 'before' | 'after' } | null => {
    // Surukledigimiz basligin kendisi disarida: dnd-kit onu imlecle birlikte
    // otelediginden kutusu imlecin altina geliyor ve hedef hep kendisi cikiyordu.
    const heads = Array.from(document.querySelectorAll<HTMLElement>('[data-list-view] th[data-col]'))
      .map((th) => ({ key: th.getAttribute('data-col') ?? '', r: th.getBoundingClientRect() }))
      .filter((h) => isColumnId(h.key) && h.key !== 'name' && h.key !== dragged)
    if (!heads.length) return null
    const hit = heads.find((h) => x >= h.r.left && x <= h.r.right)
      ?? (x < heads[0].r.left ? heads[0] : heads[heads.length - 1])
    return { key: hit.key as ColumnKey, edge: x < hit.r.left + hit.r.width / 2 ? 'before' : 'after' }
  }
  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    if (isColumnId(active.id)) { setColDrop(null); return }
    const a = activatorEvent as PointerEvent | MouseEvent | TouchEvent | null
    pointerRef.current = a && 'clientX' in a ? { x: a.clientX, y: a.clientY } : a && 'touches' in a && a.touches[0] ? { x: a.touches[0].clientX, y: a.touches[0].clientY } : null
    setDragId(String(active.id))
  }
  const onDragMove = (e: DragMoveEvent) => {
    if (isColumnId(e.active.id)) {
      const a = e.activatorEvent as PointerEvent | MouseEvent | null
      const x = (a && 'clientX' in a ? a.clientX : 0) + (e.delta?.x ?? 0)
      setColDrop(columnDropAt(x, e.active.id as ColumnKey))
      return
    }
    setDrop(resolveRef.current(pointerRef.current))
  }
  useEffect(() => {
    if (!dragId) return
    const onMove = (e: PointerEvent) => { pointerRef.current = { x: e.clientX, y: e.clientY }; setDrop(resolveRef.current(pointerRef.current)) }
    const onTouch = (e: TouchEvent) => { const t = e.touches[0]; if (t) { pointerRef.current = { x: t.clientX, y: t.clientY }; setDrop(resolveRef.current(pointerRef.current)) } }
    const onScroll = () => setDrop(resolveRef.current(pointerRef.current))
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('touchmove', onTouch, true)
    document.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('pointermove', onMove, true); document.removeEventListener('touchmove', onTouch, true); document.removeEventListener('scroll', onScroll, true) }
  }, [dragId])
  const applyGroup = (ticket: Ticket, g: Group, orderIds?: string[]) => {
    const v = g.value
    const from = groupOf(ticket.id)?.value
    switch (v.kind) {
      case 'status': {
        if (!v.status) return
        const ids = orderIds ?? [...g.tickets.map((x) => x.id).filter((x) => x !== ticket.id), ticket.id]
        reorder.mutate([{ status_id: v.status.id, ids }])
        return
      }
      case 'priority': update(ticket.id, { priority: v.priority }); return
      case 'due': update(ticket.id, { due_date: groupPreset(v, now).due_date ?? null }); return
      case 'assignee': {
        if (v.user) bulk.assign.mutate({ ids: [ticket.id], userId: v.user.id, mode: 'add' })
        if (from?.kind === 'assignee' && from.user && from.user.id !== v.user?.id) bulk.assign.mutate({ ids: [ticket.id], userId: from.user.id, mode: 'remove' })
        return
      }
      case 'tags': {
        if (v.tag) bulk.tag.mutate({ ids: [ticket.id], tagId: v.tag.id, mode: 'add' })
        if (from?.kind === 'tags' && from.tag && from.tag.id !== v.tag?.id) bulk.tag.mutate({ ids: [ticket.id], tagId: from.tag.id, mode: 'remove' })
        return
      }
      case 'project': if (v.projectId && v.projectId !== ticket.project_id) moveTicket.mutate({ ticketId: ticket.id, projectId: v.projectId }); return
      default: return
    }
  }
  const onRowDragEnd = (_e: DragEndEvent) => {
    const id = dragId; const target = drop ?? resolveAt(pointerRef.current)
    setDragId(null); setDrop(null)
    if (!id || !target) return
    const ticket = data.tickets.find((x) => x.id === id); if (!ticket) return
    if (target.kind === 'group') {
      const g = groups.find((x) => x.key === target.key); if (!g) return
      if (ticket.parent_id) setParent.mutate({ id, parentId: null, previousParentId: ticket.parent_id })
      applyGroup(ticket, g)
      return
    }
    const over = data.tickets.find((x) => x.id === target.id); if (!over) return
    if (target.mode === 'nest') {
      if (over.id === ticket.parent_id) return
      setParent.mutate({ id, parentId: over.id, previousParentId: ticket.parent_id })
      return
    }
    // before / after: a subtask dropped next to a top-level row leaves its parent
    if (ticket.parent_id && !over.parent_id) setParent.mutate({ id, parentId: null, previousParentId: ticket.parent_id })
    else if (over.parent_id && over.parent_id !== ticket.parent_id) setParent.mutate({ id, parentId: over.parent_id, previousParentId: ticket.parent_id })
    const g = groupOf(over.id); if (!g) return
    if (g.value.kind === 'status' && g.value.status && !config.sort) {
      const roots = g.tickets.map((x) => x.id)
      applyGroup(ticket, g, placeInOrder(roots, id, over.id, target.mode))
    } else if (!grouped && !config.sort && over.status_id && over.status_id === ticket.status_id) {
      const roots = shown.filter((x) => x.status_id === over.status_id).map((x) => x.id)
      reorder.mutate([{ status_id: over.status_id, ids: placeInOrder(roots, id, over.id, target.mode) }])
    } else if (grouped) applyGroup(ticket, g)
  }
  const onDragEnd = (e: DragEndEvent) => { if (isColumnId(e.active.id)) onHeaderDragEnd(e); else onRowDragEnd(e) }

  // Keyboard moves (TL-11): Alt+↑/↓ = manual order in the status group, Ctrl+↑/↓ = previous / next group.
  const moveByKey = (ticket: Ticket, dir: -1 | 1, kind: 'order' | 'group') => {
    const g = groupOf(ticket.id); if (!g) return
    if (kind === 'group') {
      const idx = groups.findIndex((x) => x.key === g.key)
      const to = groups[idx + dir]; if (!to) return
      applyGroup(ticket, to)
      return
    }
    if (g.value.kind !== 'status' || !g.value.status || config.sort || ticket.parent_id) return
    const roots = g.tickets.map((x) => x.id)
    const i = roots.indexOf(ticket.id); const j = i + dir
    if (i < 0 || j < 0 || j >= roots.length) return
    const next = roots.slice(); next.splice(i, 1); next.splice(j, 0, ticket.id)
    reorder.mutate([{ status_id: g.value.status.id, ids: next }])
  }

  const head = (col: typeof columns[number]) => {
    const label = t(col.labelKey)
    const ariaSort = config.sort?.key === col.key ? (config.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
    const fixed = col.key === 'name'
    // Başlıkta tek düğme var: sütunun adı (#d8a62c6e). Filtre de o menüden
    // açılıyor, kutusu başlığın altına çiziliyor.
    const filterable = canFilter && !!col.filter
    return (
      <HeadCell
        key={col.key}
        colKey={col.key}
        label={label}
        dropEdge={colDrop?.key === col.key ? colDrop.edge : null}
        width={fixed ? nameWidth : col.width}
        fixed={fixed}
        sortable={col.sortable}
        sortDir={config.sort?.key === col.key ? config.sort.dir : null}
        ariaSort={ariaSort}
        onSort={(dir) => onConfigChange({ ...config, sort: dir ? { key: col.key, dir } : null })}
        onMove={(to) => onConfigChange({ ...config, columns: moveColumn(config.columns, col.key, to) })}
        onHide={fixed ? undefined : () => onConfigChange({ ...config, columns: config.columns.filter((c) => c.key !== col.key) })}
        onResize={(w) => setWidth(col.key, w)}
        onAutoFit={fixed ? undefined : () => autoFit(col.key)}
        onFill={fixed && manualName ? () => clearWidth('name') : undefined}
        minWidth={fixed ? MIN_NAME_WIDTH : undefined}
        interactive={!isMobile}
        filterCount={filterable ? sectionCount(filters!, col.filter!) : 0}
        onFilter={filterable ? () => setFilterCol(col.key) : undefined}
        onMenuOpen={() => setFilterCol(null)}
        filterPopover={filterable && filterCol === col.key ? (
          <ColumnFilterPopover
            section={col.filter!}
            filters={filters!}
            onChange={onFiltersChange!}
            statuses={data.statuses}
            teamId={data.teamId}
            projectId={data.projectId!}
            onClose={() => setFilterCol(null)}
          />
        ) : undefined}
        className={`${fixed ? 'sticky left-0 z-[2] bg-raised' : ''} ${col.align === 'right' ? 'text-right' : ''}`}
      />
    )
  }

  const nameCell = (row: Row) => {
    const ticket = row.ticket
    const done = isCompleteStatus(ticket.status_info)
    const p = childProgress(ticket)
    const folded = row.hasChildren && isFolded(ticket.id)
    const parentName = config.showParentName && row.orphan && ticket.parent_id ? parentTitle(ticket.parent_id) : undefined
    const meta = config.showMeta ? { desc: ticket.has_description ?? false, files: ticket.attachments?.length ?? 0, comments: ticket.comments?.[0]?.count ?? 0, blocked: openBlockers(ticket).length } : null
    const hidden = hiddenDone.get(ticket.id) ?? 0
    const canAddChild = data.canWrite && !!data.projectId && nested && row.depth < 2
    return (
      <td data-col="name" tabIndex={-1} className={`${cellPad} font-medium text-fg sticky left-0 z-[1] list-name-cell`} style={{ paddingLeft: `${(compact ? 8 : 12) + row.depth * 22}px`, width: nameWidth, minWidth: nameWidth }}>
        <span className="flex items-center gap-1.5 min-w-0">
          {/* Two fixed slots — fold chevron, then the status mark — so titles of one depth line up (TL-13). */}
          {row.hasChildren ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleParent(ticket.id) }}
              aria-expanded={!folded}
              aria-label={t(folded ? 'board.list.expandSubtasks' : 'board.list.collapseSubtasks')}
              className="w-5 h-5 rounded-md inline-flex items-center justify-center text-fg-faint hover:text-fg hover:bg-raised flex-shrink-0"
            >
              <Icon name="chevronRight" className={`transition-transform motion-reduce:transition-none ${folded ? '' : 'rotate-90'}`} />
            </button>
          ) : (!nested && row.orphan) ? (
            <span className="w-5 h-5 inline-flex items-center justify-center text-fg-faint flex-shrink-0 text-xs" title={t('board.card.subtask')}>↳</span>
          ) : <span className="w-5 h-5 flex-shrink-0" aria-hidden />}
          {/* The row's leading mark: the status indicator; a subtask's sits under its parent's by the indent. */}
          {editable && data.statuses.length
            ? <StatusCell ticket={ticket} statuses={data.statuses} update={update} variant="dot" />
            : <span className="w-5 h-5 inline-flex items-center justify-center flex-shrink-0" title={ticket.status_info?.name ?? ticket.status}><StatusIndicator status={ticket.status_info} size={14} /></span>}
          {editingTitle === ticket.id ? (
            <TitleEditor ticket={ticket} update={update} onDone={() => setEditingTitle(null)} />
          ) : (
          <span
            // Atanmamış görev bir ton soluk (#41cb2a2a) — tamamlananla aynı ton,
            // ikisi de "şu an kimsede değil" demek.
            className={`min-w-0 ${config.wrapText ? 'whitespace-normal break-words' : 'line-clamp-1'} ${done || (ticket.assignees ?? []).length === 0 ? 'text-fg-muted' : ''} group-hover/row:text-primary-700 dark:group-hover/row:text-primary-300 transition-colors`}
            onDoubleClick={(e) => { if (editable) { e.stopPropagation(); setEditingTitle(ticket.id) } }}
          >
            {parentName && <span className="text-fg-faint font-normal no-underline">{parentName} › </span>}
            {ticket.title.trim() || <span className="text-fg-faint italic">{t('common.unnamedTask')}</span>}
          </span>
          )}
          {meta && (meta.desc || meta.files > 0 || meta.comments > 0 || meta.blocked > 0) && (
            <span className="inline-flex items-center gap-2 text-2xs text-fg-faint flex-shrink-0 tabular-nums" data-meta>
              {meta.desc && <span className="inline-flex" role="img" title={t('board.card.hasDescription')} aria-label={t('board.card.hasDescription')}><MetaIcon kind="desc" /></span>}
              {meta.files > 0 && <span className="inline-flex items-center gap-0.5" title={t('board.card.files', { n: meta.files })}><MetaIcon kind="files" />{meta.files}</span>}
              {meta.comments > 0 && <span className="inline-flex items-center gap-0.5" title={t('board.card.comments', { n: meta.comments })}><MetaIcon kind="comments" />{meta.comments}</span>}
              {meta.blocked > 0 && <span className="inline-flex items-center gap-0.5 text-warning" title={t('board.card.blockedBy', { n: meta.blocked })}><MetaIcon kind="blocked" />{meta.blocked}</span>}
            </span>
          )}
          <AgentWorkBadge ticketId={ticket.id} teamId={data.teamId} compact className="flex-shrink-0 max-w-[12rem]" />
          {config.showTagsInline && (ticket.tags ?? []).length > 0 && (
            <span className="inline-flex items-center gap-1 flex-shrink-0" data-inline-tags>
              {(ticket.tags ?? []).slice(0, 2).map(({ tag }) => <span key={tag.id} className="chip-dyn border text-2xs px-1.5 rounded-full font-medium leading-4" style={{ '--c': tag.color } as React.CSSProperties}>{tag.name}</span>)}
              {(ticket.tags ?? []).length > 2 && <span className="text-2xs text-fg-faint">+{(ticket.tags ?? []).length - 2}</span>}
            </span>
          )}
          {p.total > 0 && !columns.some((c) => c.key === 'children') && (
            <span className={`text-2xs tabular-nums flex-shrink-0 ${p.done === p.total ? 'text-success' : 'text-fg-faint'}`} title={t('board.card.subtasks', { done: p.done, total: p.total })}>{p.done}/{p.total}</span>
          )}
          {hidden > 0 && <span className="text-2xs text-fg-faint flex-shrink-0" title={t('board.list.hiddenDone', { n: hidden })}>+{hidden} ✓</span>}
          {/* Row actions cluster at the right edge of the cell, shown on hover/focus (TL-13). */}
          {(editable && editingTitle !== ticket.id) || canAddChild ? (
            <span className="ml-auto inline-flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity" data-row-actions>
              {editable && editingTitle !== ticket.id && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setEditingTitle(ticket.id) }}
                  aria-label={t('board.list.edit.title')}
                  title={t('board.list.edit.titleHint')}
                  className="w-5 h-5 rounded-md inline-flex items-center justify-center text-fg-faint hover:text-fg hover:bg-raised"
                >
                  <Icon name="edit" />
                </button>
              )}
              <ShareLinkButton id={ticket.id} title={ticket.title} className="flex-shrink-0" />
              {canAddChild && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); unfoldParent(ticket.id); setAddingUnder(addingUnder === ticket.id ? null : ticket.id) }}
                  aria-label={t('board.list.addSubtask')}
                  title={t('board.list.addSubtask')}
                  className="w-5 h-5 rounded-md inline-flex items-center justify-center text-fg-faint hover:text-fg hover:bg-raised"
                >
                  <Icon name="plus" />
                </button>
              )}
            </span>
          ) : (
            <ShareLinkButton id={ticket.id} title={ticket.title} className="ml-auto opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity flex-shrink-0" />
          )}
        </span>
      </td>
    )
  }

  const groupHead = (g: Group): ReactNode => {
    const v = g.value
    const label = (() => {
      switch (v.kind) {
        case 'status': return v.status
          ? <span className="chip-dyn border inline-flex items-center gap-1.5 text-2xs px-1.5 py-0.5 rounded-md font-semibold" style={{ '--c': v.status.color } as React.CSSProperties}><StatusIndicator status={v.status} size={12} />{v.status.name}</span>
          : <span className="text-xs font-semibold text-fg-muted">{t('board.list.group.noStatus')}</span>
        case 'priority': return v.priority ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-fg"><PriorityFlag priority={v.priority} />{t(PRIORITY_LABELS[v.priority])}</span> : <span className="text-xs font-semibold text-fg-muted">{t('board.list.group.noPriority')}</span>
        case 'assignee': return v.user
          ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-fg"><span className="inline-flex -space-x-1.5">{v.users.slice(0, 3).map((u) => <UserAvatar key={u.id} user={u} size="sm" />)}</span>{v.users.map((u) => u.full_name || u.email).join(', ')}</span>
          : <span className="text-xs font-semibold text-fg-muted">{t('board.list.group.unassigned')}</span>
        case 'tags': return v.tag
          ? <span className="inline-flex items-center gap-1">{v.tagList.map((x) => <span key={x.id} className="chip-dyn border text-xs px-2 py-0.5 rounded-full font-semibold" style={{ '--c': x.color } as React.CSSProperties}>{x.name}</span>)}</span>
          : <span className="text-xs font-semibold text-fg-muted">{t('board.list.group.untagged')}</span>
        case 'due': return <span className={`text-xs font-semibold ${v.bucket === 'overdue' ? 'text-danger' : 'text-fg'}`}>{dueOptions().find((o) => o.value === v.bucket)?.label ?? v.bucket}</span>
        case 'project': { const p = data.project(v.projectId); return p
          ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-fg"><ListAvatar icon={p.icon ?? null} iconUrl={p.icon_url ?? null} color={null} size="sm" />{p.name}</span>
          : <span className="text-xs font-semibold text-fg-muted">{t('board.list.group.noList')}</span> }
        default: return null
      }
    })()
    const folded = collapsedGroups.has(g.key)
    return (
      <tr key={`g:${g.key}`} className={`bg-raised/40 group/ghead ${drop?.kind === 'group' && drop.key === g.key ? 'ring-2 ring-inset ring-primary-500' : ''}`} data-group={g.key}>
        <td colSpan={colCount} className={`${compact ? 'px-2 py-1' : 'px-3 py-1.5'}`}>
          <div className="sticky left-4 inline-flex items-center w-max max-w-full">
          {canSelect && (() => {
            const ids = g.tickets.map((x) => x.id)
            const on = ids.filter((id) => selected.has(id)).length
            return (
              <input
                type="checkbox"
                className={`rounded-md cursor-pointer mr-2 ${on || selected.size ? 'opacity-100' : 'opacity-0 group-hover/ghead:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'} transition-opacity`}
                checked={ids.length > 0 && on === ids.length}
                ref={(el) => { if (el) el.indeterminate = on > 0 && on < ids.length }}
                onChange={() => {}}
                onClick={(e) => { e.stopPropagation(); setMany(ids, !(on === ids.length)) }}
                aria-label={t('board.list.bulk.selectGroup')}
                data-group-select={g.key}
              />
            )
          })()}
          <button
            type="button"
            onClick={(e) => { if (e.shiftKey) setGroupsFolded(!folded); else toggleCollapsed(g.key) }}
            aria-expanded={!folded}
            className="inline-flex items-center gap-2 rounded-md -ml-1 pl-1 pr-2 py-0.5 hover:bg-raised transition-colors cursor-pointer"
          >
            <Icon name="chevronRight" className={`text-fg-faint transition-transform motion-reduce:transition-none ${folded ? '' : 'rotate-90'}`} />
            {label}
            <span className="text-2xs text-fg-faint tabular-nums">{g.tickets.length}</span>
          </button>
          {canAdd && (
            <button
              type="button"
              onClick={() => { if (folded) toggleCollapsed(g.key); setAddingIn(addingIn === g.key ? null : g.key) }}
              aria-label={t('board.list.addTask')}
              title={t('board.list.addTask')}
              className="ml-1 w-6 h-6 rounded-md inline-flex items-center justify-center text-fg-faint hover:text-fg hover:bg-raised opacity-0 group-hover/ghead:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
            >
              <Icon name="plus" />
            </button>
          )}
          </div>
        </td>
      </tr>
    )
  }

  // Keyed by group + ticket: a ticket with two assignees is a row in two groups, and
  // duplicate keys made React reuse the wrong rows when the grouping changed.
  const rowEl = (row: Row, groupKey: string) => {
    const ticket = row.ticket
    // Bırakma çizgisi ve odak halkası `data-drop` ile index.css'te **hücrelere**
    // çizilir; `tr`ye verilen gölgeyi yapışkan ad sütunu örtüyordu (#83a09637).
    const hint = drop?.kind === 'row' && drop.id === ticket.id ? drop.mode : null
    return (
      <SortableRow
        key={`${groupKey}:${ticket.id}`}
        id={ticket.id}
        disabled={!canDrag}
        data-ticket-id={ticket.id}
        data-depth={row.depth}
        data-drop={hint ?? undefined}
        onClick={(e) => { if (canSelect && (e.ctrlKey || e.metaKey || e.shiftKey)) { e.preventDefault(); toggleOne(ticket.id, e); return } open(ticket.id) }}
        tabIndex={0}
        aria-selected={canSelect ? selected.has(ticket.id) : undefined}
        onKeyDown={(e) => onRowKey(e, ticket)}
        className={`group/row animate-fade-in motion-reduce:animate-none focus-visible:outline-offset-[-2px] scroll-mt-10 cursor-pointer transition-colors ${selected.has(ticket.id) ? 'bg-primary-50/70 dark:bg-primary-950/30' : 'hover:bg-primary-50/40 dark:hover:bg-primary-950/15 focus-visible:bg-primary-50/40 dark:focus-visible:bg-primary-950/15'} ${hint === 'nest' ? 'bg-primary-100/60 dark:bg-primary-900/30' : ''} ${dragId === ticket.id ? 'opacity-40' : ''}`}
      >
        {canSelect && (
          <td className="w-8 px-2 py-0 align-middle" data-col="__select" onClick={(e) => { e.stopPropagation(); toggleOne(ticket.id, e) }}>
            <input
              type="checkbox"
              className={`rounded-md cursor-pointer ${selected.has(ticket.id) || selected.size ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'} transition-opacity`}
              checked={selected.has(ticket.id)}
              onChange={() => {}}
              onClick={(e) => { e.stopPropagation(); toggleOne(ticket.id, e) }}
              aria-label={t('board.list.bulk.select')}
              tabIndex={-1}
            />
          </td>
        )}
        {columns.map((col) => col.key === 'name'
          ? <NameCell key="name">{nameCell(row)}</NameCell>
          : <td key={col.key} data-col={col.key} tabIndex={-1} className={`${cellPad} ${col.align === 'right' ? 'text-right' : ''} focus-visible:outline-offset-[-2px]`}>{editable && col.edit ? col.edit(ticket, ctx) : col.cell(ticket, ctx)}</td>)}
        {!isMobile && <td aria-hidden />}
      </SortableRow>
    )
  }

  const body = (): ReactNode => {
    if (data.isLoading) {
      return Array.from({ length: 5 }).map((_, i) => (
        <tr key={i}>{canSelect && <td className="w-8" />}{columns.map((c) => <td key={c.key} className={cellPad}><div className="h-4 bg-raised rounded-lg animate-pulse" /></td>)}</tr>
      ))
    }
    if (shown.length === 0 && !(config.showEmptyGroups && groups.length)) {
      return (
        <tr key="empty">
          <td colSpan={colCount} className="px-4 py-16 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-raised flex items-center justify-center">
                <Icon name="ticket" size={24} className="text-fg-faint" />
              </div>
              <div>
                <p className="text-sm font-medium text-fg-muted">{t('board.list.empty')}</p>
                <p className="text-xs text-fg-faint mt-0.5">{t('board.list.emptyHint')}</p>
              </div>
            </div>
          </td>
        </tr>
      )
    }
    // Items are thunks: only the ones inside the window are turned into rows.
    type Item = { key: string; h: number; render: () => ReactNode }
    // Satır yükseklikleri (TL-12): sakin ekleme satırı normal satırla aynı yüksekliktedir.
    const H = { row: compact ? 32 : 40, group: compact ? 36 : 40, quick: 48 }
    const out: Item[] = []
    const push = (key: string, h: number, render: () => ReactNode) => out.push({ key, h, render })
    const visible: string[] = []
    for (const g of groups) {
      if (grouped) push(`g:${g.key}`, H.group, () => groupHead(g))
      if (grouped && collapsedGroups.has(g.key)) continue
      // Başlıktaki + listenin **başına** bir satır açar (kullanıcı, 25 Eyl):
      // aşağıdaki kalıcı satıra odaklanmak "yeni görev yukarı" beklentisini
      // karşılamıyordu. Buraya yazılan görev grubun en üstüne eklenir.
      if (canAdd && addingIn === g.key) {
        push(`addtop:${g.key}`, H.row, () => (
          <QuickAddRow
            key={`addtop:${g.key}`}
            colSpan={colCount}
            pad={cellPad}
            compact={compact}
            quiet
            dismiss
            place="top"
            columns={columns}
            nameWidth={nameWidth}
            trailing={!isMobile}
            selectCol={canSelect}
            projectId={data.projectId}
            teamId={data.teamId}
            statuses={data.statuses}
            preset={mergePresets(groupPreset(g.value, now), filterPreset)}
            onClose={() => setAddingIn(null)}
          />
        ))
      }
      const rows = buildRows(g.tickets, config.subtaskMode, hiddenParents, nested ? sortedPool : g.tickets)
      for (const r of rows) visible.push(r.ticket.id)
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        push(`${g.key}:${row.ticket.id}`, H.row, () => rowEl(row, g.key))
        if (addingUnder === row.ticket.id) {
          // After the parent's visible subtree: skip forward past deeper rows.
          let j = i + 1
          while (j < rows.length && rows[j].depth > row.depth) j++
          const tail = rows.slice(i + 1, j)
          for (const r of tail) push(`${g.key}:${r.ticket.id}`, H.row, () => rowEl(r, g.key))
          i = j - 1
          push(`add:${g.key}:${row.ticket.id}`, H.quick, () => (
            <QuickAddRow
              key={`add:${g.key}:${row.ticket.id}`}
              colSpan={colCount}
              pad={cellPad}
              projectId={row.ticket.project_id ?? data.projectId}
              teamId={data.teamId}
              statuses={data.statuses}
              preset={{}}
              parent={row.ticket}
              indent={(row.depth + 1) * 24}
              onClose={() => setAddingUnder(null)}
            />
          ))
        }
      }
      // Grubun sonunda hep duran ekleme satırı (#ce19252c): eskiden burada
      // "Görev ekle" düğmesi vardı ve her grupta tekrarlanınca gözü yoruyordu.
      // Boştayken satır tamamen görünmez; üzerine gelince halka, yer tutucu ve
      // denetimler birlikte belirir, her denetim kendi sütununun altında.
      // Buradan eklenen görev grubun **sonuna** gider.
      if (canAdd) {
        push(`add:${g.key}`, H.row, () => (
          <QuickAddRow
            key={`add:${g.key}`}
            colSpan={colCount}
            pad={cellPad}
            compact={compact}
            quiet
            fade
            place="bottom"
            columns={columns}
            nameWidth={nameWidth}
            trailing={!isMobile}
            selectCol={canSelect}
            autoFocus={false}
            projectId={data.projectId}
            teamId={data.teamId}
            statuses={data.statuses}
            preset={mergePresets(groupPreset(g.value, now), filterPreset)}
            onClose={() => setAddingIn(null)}
          />
        ))
      }
    }
    // Planlanan tekrarlar en sonda, kendi başlığı altında: gerçek satırların
    // sıralamasına, sayaçlarına ve seçimine karışmazlar.
    if (ghosts.length) {
      push('ghosts:head', H.group, () => (
        <tr key="ghosts:head" data-ghost-head>
          <td colSpan={colCount} className={`${compact ? 'px-2 py-1' : 'px-3 py-1.5'} border-t border-line-soft`}>
            <button type="button" onClick={() => toggleCollapsed('__ghosts')}
              className="sticky left-4 inline-flex items-center gap-1.5 text-xs font-semibold text-fg-muted hover:text-fg rounded-md px-1 -ml-1 hover:bg-raised">
              <Icon name="chevronRight" className={`transition-transform ${collapsedGroups.has('__ghosts') ? '' : 'rotate-90'}`} />
              {t('board.list.ghostsHead')}
              <span className="text-fg-faint tabular-nums">{ghosts.length}</span>
            </button>
          </td>
        </tr>
      ))
      if (!collapsedGroups.has('__ghosts')) {
        for (const gh of ghosts) {
          push(`ghost:${gh.key}`, H.row, () => (
            <GhostRow
              key={`ghost:${gh.key}`}
              ghost={gh}
              colSpan={colCount}
              pad={cellPad}
              canWrite={data.canWrite}
              pending={materialize.isPending}
              onCreate={() => materialize.mutate({ recurrenceId: gh.recurrence.id, due: gh.date })}
            />
          ))
        }
      }
    }
    visibleIdsRef.current = visible
    // Short lists (or wrapped text, whose rows have no fixed height) render whole.
    if (out.length <= 80 || config.wrapText) return out.map((it) => it.render())
    const overscan = 8
    let y = 0, start = 0, end = out.length
    const tops: number[] = new Array(out.length)
    for (let i = 0; i < out.length; i++) { tops[i] = y; y += out[i].h }
    const total = y
    const minY = viewport.top - overscan * H.row, maxY = viewport.top + viewport.height + overscan * H.row
    start = tops.findIndex((t, i) => t + out[i].h >= minY); if (start < 0) start = 0
    end = start; while (end < out.length && tops[end] < maxY) end++
    const before = tops[start] ?? 0, after = total - (tops[end - 1] !== undefined ? tops[end - 1] + out[end - 1].h : total)
    return [
      before > 0 ? <tr key="pad-top" aria-hidden data-pad="top" style={{ height: before }}><td colSpan={colCount} className="p-0" /></tr> : null,
      ...out.slice(start, end).map((it) => it.render()),
      after > 0 ? <tr key="pad-bottom" aria-hidden data-pad="bottom" style={{ height: after }}><td colSpan={colCount} className="p-0" /></tr> : null,
    ]
  }

  const exportCsv = () => {
    const byId = new Map(data.tickets.map((x) => [x.id, x]))
    const rows = visibleIdsRef.current.map((id) => byId.get(id)).filter((x): x is Ticket => !!x)
    const keys = columns.map((c) => c.key)
    const csv = csvOf(rows, keys, { label: (k) => t(COLUMNS[k].labelKey), priority: (p) => (p ? t(PRIORITY_LABELS[p]) : ''), project: (id) => data.project(id)?.name ?? '', now })
    downloadText(`fira-liste-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }
  const selectedTickets = useMemo(() => {
    const order = orderRef.current
    return data.tickets.filter((x) => selected.has(x.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  }, [data.tickets, selected])
  const selectedTeam = data.teamId
  const selectedProject = data.projectId ?? (selectedTickets.length && selectedTickets.every((x) => x.project_id === selectedTickets[0].project_id) ? selectedTickets[0].project_id : null)

  return (
    <div className="flex flex-col h-full gap-3" data-list-view data-group-by={config.groupBy} data-density={config.density}>
      {toolbar && (
        <ListToolbar
          config={config}
          onChange={onConfigChange}
          groupOptions={data.projectId ? GROUP_BYS.filter((g) => g !== 'project') : GROUP_BYS}
          canShowEmpty={!!data.projectId}
          hiddenColumns={hiddenColumns}
          onExport={exportCsv}
          closed={data.projectId && filters && onFiltersChange ? { on: !!filters.show_closed, set: (on) => onFiltersChange({ ...filters, show_closed: on || undefined }) } : undefined}
          onReset={defaultConfig ? () => onConfigChange(defaultConfig) : undefined}
          canMeMode={source.kind !== 'me'}
          fold={{
            groups: grouped ? { collapseAll: () => setGroupsFolded(true), expandAll: () => setGroupsFolded(false) } : undefined,
            subtasks: nested && parentIds.length ? { collapseAll: () => setParentsFolded(true), expandAll: () => setParentsFolded(false) } : undefined,
          }}
        />
      )}
      {/* One scroll container, both axes (see the classic list for why). */}
      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-auto scrollbar-thin bg-surface rounded-xl border border-line shadow-sm" data-list-scroller>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={() => { setDragId(null); setDrop(null); setColDrop(null) }}>
        <table className="min-w-full text-[13px]" role="table" aria-label={t('board.list.aria')} style={{ tableLayout: 'fixed', width: tableWidth, minWidth: '100%' }}>
          <thead className="sticky top-0 z-10 bg-raised">
            <tr className="bg-raised border-b border-line text-left">
              {canSelect && <th scope="col" className="w-8 px-2 py-2" data-col="__select"><span className="sr-only">{t('board.list.bulk.column')}</span></th>}
              <SortableContext items={columns.map((c) => c.key)} strategy={holdStill}>
                {columns.map(head)}
              </SortableContext>
              {/* The trailing cell has no width: with table-layout fixed it absorbs the slack, so the set widths hold. */}
              {!isMobile && (
                <th scope="col" className="px-1 py-2 text-left font-normal normal-case tracking-normal" data-col="__add">
                  <ToolbarMenu label="" icon={<Icon name="plus" />} title={t('board.list.addColumn')}>
                    <ColumnPickerItems config={config} onChange={onConfigChange} hidden={hiddenColumns} />
                  </ToolbarMenu>
                </th>
              )}
            </tr>
          </thead>
          <SortableContext items={visibleIdsRef.current} strategy={holdStill}>
          <tbody className="divide-y divide-line-soft">{body()}</tbody>
          </SortableContext>
        </table>
        </DndContext>
      </div>
      {selectedTickets.length > 0 && (
        <BulkActionBar
          tickets={selectedTickets}
          statuses={data.statuses}
          teamId={selectedTeam}
          projectId={selectedProject}
          onClear={() => setSelected(new Set())}
        />
      )}
    </div>
  )
}

/** A table row that dnd-kit can pick up (TL-11). Nothing shifts while dragging (`holdStill`); the drop hint is drawn by the parent. */
function SortableRow({ id, disabled, children, className, ...rest }: { id: string; disabled: boolean; children: ReactNode; className?: string } & React.HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, string | number | undefined>) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id, disabled })
  return (
    // The dragged row follows the pointer, so it must not catch elementFromPoint — the drop target is what lies under it.
    <tr ref={setNodeRef} {...rest} {...(disabled ? {} : { ...attributes, role: undefined })} {...(disabled ? {} : listeners)} style={{ transform: isDragging ? CSS.Translate.toString(transform) : undefined, pointerEvents: isDragging ? 'none' : undefined, position: isDragging ? 'relative' : undefined, zIndex: isDragging ? 5 : undefined }} className={className}>
      {children}
    </tr>
  )
}

/** The name cell renders its own <td>; this keeps the column loop uniform. */
const NameCell = ({ children }: { children: ReactNode }) => <>{children}</>

export type { Ticket }
