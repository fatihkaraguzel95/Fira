import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useEffect, useRef, useState } from 'react'
import type { Ticket, TicketStatus } from '../../types'
import { KanbanColumn } from './KanbanColumn'
import { TicketCard } from './TicketCard'
import { useReorderTickets } from '../../hooks/useTickets'

interface Props {
  tickets: Ticket[]
  statuses: TicketStatus[]
}

export function KanbanBoard({ tickets, statuses }: Props) {
  // Map: statusId → sorted tickets
  const [columns, setColumns] = useState<Map<string, Ticket[]>>(new Map())
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null)
  const isDragging = useRef(false)
  const reorder = useReorderTickets()

  // Sync columns from props (only when not dragging)
  useEffect(() => {
    if (isDragging.current) return
    const cols = new Map<string, Ticket[]>()
    statuses.forEach((s) => {
      cols.set(
        s.id,
        tickets
          .filter((t) => t.status_id === s.id)
          .sort((a, b) => a.order_index - b.order_index)
      )
    })
    setColumns(cols)
  }, [tickets, statuses])

  // Find which column a ticket or column id belongs to
  const findColumnId = (id: string): string | null => {
    if (columns.has(id)) return id
    for (const [colId, items] of columns.entries()) {
      if (items.some((t) => t.id === id)) return colId
    }
    return null
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  const handleDragStart = ({ active }: DragStartEvent) => {
    isDragging.current = true
    const ticket = [...columns.values()].flat().find((t) => t.id === active.id)
    setActiveTicket(ticket ?? null)
  }

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || active.id === over.id) return

    const fromId = findColumnId(active.id as string)
    const toId = findColumnId(over.id as string)
    if (!fromId || !toId || fromId === toId) return

    setColumns((prev) => {
      const next = new Map(prev)
      const fromItems = [...(next.get(fromId) ?? [])]
      const toItems = [...(next.get(toId) ?? [])]

      const activeIdx = fromItems.findIndex((t) => t.id === active.id)
      if (activeIdx === -1) return prev
      const [moved] = fromItems.splice(activeIdx, 1)

      const overIdx = toItems.findIndex((t) => t.id === over.id)
      toItems.splice(overIdx >= 0 ? overIdx : toItems.length, 0, moved)

      next.set(fromId, fromItems)
      next.set(toId, toItems)
      return next
    })
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    isDragging.current = false
    setActiveTicket(null)

    if (!over) return

    const fromId = findColumnId(active.id as string)
    const toId = findColumnId(over.id as string)
    if (!fromId) return

    // Same-column reorder
    if (fromId === toId) {
      const col = [...(columns.get(fromId) ?? [])]
      const oldIdx = col.findIndex((t) => t.id === active.id)
      const newIdx = col.findIndex((t) => t.id === over.id)
      if (oldIdx === -1 || oldIdx === newIdx) return

      const reordered = arrayMove(col, oldIdx, newIdx)
      setColumns((prev) => new Map(prev).set(fromId, reordered))
      reorder.mutate(reordered.map((t, i) => ({ id: t.id, status_id: fromId, order_index: i })))
      return
    }

    // Cross-column: persist the current visual state
    const updates: { id: string; status_id: string; order_index: number }[] = []
    columns.forEach((items, statusId) => {
      items.forEach((ticket, i) => {
        if (ticket.status_id !== statusId || ticket.order_index !== i) {
          updates.push({ id: ticket.id, status_id: statusId, order_index: i })
        }
      })
    })
    if (updates.length > 0) reorder.mutate(updates)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 h-full pb-4 overflow-x-auto scrollbar-thin">
        {statuses.map((status) => (
          <KanbanColumn
            key={status.id}
            status={status}
            tickets={columns.get(status.id) ?? []}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTicket && (
          <div className="rotate-1 shadow-xl opacity-90">
            <TicketCard ticket={activeTicket} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
