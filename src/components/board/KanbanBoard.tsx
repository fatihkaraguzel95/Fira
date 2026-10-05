import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useEffect, useRef, useState } from 'react'
import type { Ticket, TicketStatus, TicketFilters } from '../../types'
import { KanbanColumn } from './KanbanColumn'
import { TicketCard } from './TicketCard'
import { useReorderTickets, useArchiveTicket, getLocalArchivedIds } from '../../hooks/useTickets'
import { celebrateTicket, isCelebrating, subscribeCelebrating } from '../../lib/celebrate'
import { dropIndex } from '../../lib/dropIndex'
import { isCompleteStatus } from '../../types'
import { useReorderStatuses } from '../../hooks/useStatuses'
import type { TeamPermissions } from '../../hooks/useTeams'
import { useT } from '../../i18n'

interface Props {
  tickets: Ticket[]
  statuses: TicketStatus[]
  projectId: string
  perms: TeamPermissions
  teamId?: string | null
  /** Active filters — so an empty column can say whether a filter is hiding it. */
  filters?: TicketFilters
  /** Unfiltered task count per status id, for the "visible/total" badge. */
  totals?: Map<string, number>
  /** Lets a hidden column offer a one-click "show these again". */
  onFiltersChange?: (f: TicketFilters) => void
}

/**
 * An empty column means one of two things: there is genuinely nothing there, or a
 * filter is hiding it. Say which — and offer the switch right there, so nobody has
 * to hunt through the filter menu to undo it.
 */
function hiddenNoticeFor(t: ReturnType<typeof useT>, category: string | undefined, filters?: TicketFilters) {
  if (category === 'closed' && !filters?.show_closed)
    return { label: t('board.hidden.closed'), cta: t('board.filter.showClosed'), patch: { show_closed: true } as Partial<TicketFilters> }
  if (category === 'backlog' && filters?.show_backlog === false)
    return { label: t('board.hidden.backlog'), cta: t('board.filter.showBacklog'), patch: { show_backlog: undefined } as Partial<TicketFilters> }
  return null
}

export function KanbanBoard({ tickets, statuses, projectId, perms, teamId = null, filters, totals, onFiltersChange }: Props) {
  const tr = useT()
  const [columns, setColumns] = useState<Map<string, Ticket[]>>(new Map())
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null)
  const isDragging = useRef(false)
  const columnsRef = useRef<Map<string, Ticket[]>>(new Map())
  columnsRef.current = columns

  const reorder = useReorderTickets()
  const reorderStatuses = useReorderStatuses()
  const archiveTicket = useArchiveTicket()
  const dragFromId = useRef<string | null>(null)

  // Combine DB archived_at + localStorage fallback
  const [localArchivedIds, setLocalArchivedIds] = useState<Set<string>>(() => getLocalArchivedIds())

  const isEffectivelyArchived = (t: Ticket) => !!t.archived_at || localArchivedIds.has(t.id)

  const handleArchive = (id: string, archived: boolean) => {
    setLocalArchivedIds(prev => {
      const next = new Set(prev)
      if (archived) next.add(id)
      else next.delete(id)
      return next
    })
    archiveTicket.mutate({ id, archived })
  }

  const archivedMap = new Map<string, Ticket[]>()
  statuses.forEach((s) => {
    archivedMap.set(
      s.id,
      tickets.filter((t) => t.status_id === s.id && isEffectivelyArchived(t))
        .sort((a, b) => a.order_index - b.order_index),
    )
  })

  // A card that the filter drops while its confetti is still playing stays put
  // until the animation ends, then fades (#6228C4EB): `celebratingTick` wakes
  // this effect when a celebration finishes so the card can finally leave.
  const [celebratingTick, setCelebratingTick] = useState(0)
  useEffect(() => subscribeCelebrating(() => setCelebratingTick((n) => n + 1)), [])
  /** Where each celebrating card landed — the column it must stay in while the confetti plays. */
  const celebratedInto = useRef(new Map<string, string>())
  useEffect(() => {
    if (isDragging.current) return
    const map = new Map<string, Ticket[]>()
    statuses.forEach((s) => {
      map.set(
        s.id,
        tickets
          .filter((t) => t.status_id === s.id && !isEffectivelyArchived(t))
          .sort((a, b) => a.order_index - b.order_index),
      )
    })
    // A status change made in the ticket window reaches the list first as an
    // optimistic patch: that is the moment the destination is known.
    for (const t of tickets) if (t.status_id && isCelebrating(t.id) && !celebratedInto.current.has(t.id)) celebratedInto.current.set(t.id, t.status_id)
    // A celebrating card stays on the board in the column it was dropped INTO
    // (or moved into from the ticket window) until its confetti ends — even
    // when the new list no longer has it, and even while the list still shows
    // its old status. Its destination is remembered when the celebration
    // starts; without that it reappeared where the drag began (kullanıcı, 15 Eyl).
    for (const [id, dest] of celebratedInto.current.entries()) {
      if (!isCelebrating(id)) { celebratedInto.current.delete(id); continue }
      let card: Ticket | undefined = tickets.find((t) => t.id === id)
      if (!card) for (const items of columnsRef.current.values()) { card = items.find((t) => t.id === id); if (card) break }
      if (!card || !map.has(dest)) continue
      for (const [colId, items] of map.entries()) if (colId !== dest && items.some((t) => t.id === id)) map.set(colId, items.filter((t) => t.id !== id))
      const target = map.get(dest) ?? []
      if (!target.some((t) => t.id === id)) map.set(dest, [...target, { ...card, status_id: dest }].sort((a, b) => a.order_index - b.order_index))
    }
    setColumns(map)
  }, [tickets, statuses, localArchivedIds, celebratingTick])

  const findColId = (id: string): string | null => {
    if (columnsRef.current.has(id)) return id
    for (const [colId, items] of columnsRef.current.entries()) {
      if (items.some((t) => t.id === id)) return colId
    }
    return null
  }

  const collisionDetection: CollisionDetection = (args) => {
    const isCol = (id: unknown) => typeof id === 'string' && id.startsWith('col:')
    if (isCol(args.active.id)) {
      // Column drag: only other column handles count (the column's own body would otherwise "win")
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((d) => isCol(d.id) && d.id !== args.active.id) })
    }
    const cards = { ...args, droppableContainers: args.droppableContainers.filter((d) => !isCol(d.id)) }
    const pointer = pointerWithin(cards)
    if (pointer.length > 0) return pointer
    return rectIntersection(cards)
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Space picks up / drops; Enter is left to the card, which opens the ticket.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  )

  const isColumnId = (id: unknown) => typeof id === 'string' && id.startsWith('col:')

  const handleDragStart = ({ active }: DragStartEvent) => {
    if (isColumnId(active.id)) return
    isDragging.current = true
    dragFromId.current = findColId(active.id as string)
    const ticket = [...columnsRef.current.values()].flat().find((t) => t.id === active.id)
    setActiveTicket(ticket ?? null)
  }

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (isColumnId(active.id)) return
    if (!over || active.id === over.id) return

    const fromId = findColId(active.id as string)
    const toId = findColId(over.id as string)

    if (!fromId || !toId || fromId === toId) return

    setColumns((prev) => {
      const next = new Map(prev)
      const fromItems = [...(next.get(fromId) ?? [])]
      const toItems = [...(next.get(toId) ?? [])]

      const activeIdx = fromItems.findIndex((t) => t.id === active.id)
      if (activeIdx === -1) return prev
      const [moved] = fromItems.splice(activeIdx, 1)

      // Where in the target column? See lib/dropIndex — over a card it is
      // before/after by halves; over the column itself, above the first card
      // means the top (that is what "drop it at the top" looks like).
      const activeRect = active.rect.current.translated
      const activeMid = activeRect ? activeRect.top + activeRect.height / 2 : null
      const overIdx = toItems.findIndex((t) => t.id === over.id)
      const firstRect = toItems.length ? document.querySelector(`[data-ticket-id="${toItems[0].id}"]`)?.getBoundingClientRect() : undefined
      const insertAt = dropIndex({
        length: toItems.length,
        overIdx,
        activeMid,
        overMid: overIdx >= 0 ? over.rect.top + over.rect.height / 2 : null,
        firstMid: firstRect ? firstRect.top + firstRect.height / 2 : null,
      })
      toItems.splice(insertAt, 0, moved)

      next.set(fromId, fromItems)
      next.set(toId, toItems)
      return next
    })
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (isColumnId(active.id)) {
      // Column reorder: the drop target may be another column handle, a column body (status id) or a card inside it
      if (!over) return
      const fromId = (active.id as string).slice(4)
      const overId = over.id as string
      const toId = isColumnId(overId) ? overId.slice(4) : statuses.some((s) => s.id === overId) ? overId : findColId(overId)
      if (!toId || toId === fromId) return
      const from = statuses.findIndex((s) => s.id === fromId)
      const to = statuses.findIndex((s) => s.id === toId)
      if (from < 0 || to < 0) return
      reorderStatuses.mutate(arrayMove(statuses, from, to).map((s, i) => ({ id: s.id, order_index: i, projectId })))
      return
    }
    isDragging.current = false
    setActiveTicket(null)

    const originalFromId = dragFromId.current
    dragFromId.current = null

    if (!over || !originalFromId) return

    // Current column of the dragged ticket AFTER handleDragOver has moved it
    const currentColId = findColId(active.id as string)
    if (!currentColId) return

    // Same-column reorder: ticket didn't change columns
    if (originalFromId === currentColId) {
      const col = [...(columnsRef.current.get(currentColId) ?? [])]
      const oldIdx = col.findIndex((t) => t.id === active.id)
      const newIdx = col.findIndex((t) => t.id === over.id)

      if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return

      const reordered = arrayMove(col, oldIdx, newIdx)
      setColumns((prev) => new Map(prev).set(currentColId, reordered))
      reorder.mutate([{ status_id: currentColId, ids: reordered.map((t) => t.id) }])
      return
    }

    // Dropped into a done column from somewhere else: celebrate on the card.
    const toStatus = statuses.find((s) => s.id === currentColId)
    const fromStatus = statuses.find((s) => s.id === originalFromId)
    if (isCompleteStatus(toStatus) && !isCompleteStatus(fromStatus)) {
      celebratedInto.current.set(String(active.id), currentColId)
      celebrateTicket(String(active.id), toStatus?.color)
    }

    // Cross-column move (#B17C109F): handleDragOver put the card into the new
    // column at the spot where it ENTERED; from then on the pointer kept moving
    // and the sortable preview followed it (cards sliding aside), but the list
    // itself did not. The drop must land where the preview showed — the same
    // arrayMove-to-`over` rule the same-column branch uses — or the card ends
    // up one or more rows away from the placeholder the user was looking at.
    let target = [...(columnsRef.current.get(currentColId) ?? [])]
    const curIdx = target.findIndex((t) => t.id === active.id)
    const overIdx = target.findIndex((t) => t.id === over.id)
    if (curIdx !== -1 && overIdx !== -1 && curIdx !== overIdx) {
      target = arrayMove(target, curIdx, overIdx)
      setColumns((prev) => new Map(prev).set(currentColId, target))
    }

    // Only the two columns involved are rewritten, so a filtered-out card in
    // some third column keeps the index it has.
    reorder.mutate([
      { status_id: originalFromId, ids: (columnsRef.current.get(originalFromId) ?? []).map((t) => t.id) },
      { status_id: currentColId, ids: target.map((t) => t.id) },
    ])
  }

  const handleDragCancel = () => {
    isDragging.current = false
    setActiveTicket(null)
    dragFromId.current = null
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-5 h-full pb-6 overflow-x-auto scrollbar-thin items-stretch">
        <SortableContext items={statuses.map((s) => `col:${s.id}`)} strategy={horizontalListSortingStrategy}>
        {statuses.map((status) => (
          <KanbanColumn
            key={status.id}
            status={status}
            tickets={columns.get(status.id) ?? []}
            archivedTickets={archivedMap.get(status.id) ?? []}
            onArchive={perms.canWrite ? handleArchive : undefined}
            canDeleteTicket={(t) => perms.canDelete(t.created_by)}
            canDrag={perms.canWrite}
            teamId={teamId}
            canAssign={perms.canWrite}
            canReorder={perms.canWrite}
            dragActive={!!activeTicket}
            projectId={projectId}
            canCreate={perms.canWrite}
            hiddenNotice={(() => { const n = hiddenNoticeFor(tr, status.category, filters); return n && { label: n.label, cta: n.cta, onShow: onFiltersChange ? () => onFiltersChange({ ...(filters ?? {}), ...n.patch }) : undefined } })()}
            totalCount={totals?.get(status.id) ?? null}
          />
        ))}
        </SortableContext>
      </div>

      <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
        {activeTicket && (
          <div className="rotate-1 shadow-2xl opacity-95">
            <TicketCard ticket={activeTicket} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
