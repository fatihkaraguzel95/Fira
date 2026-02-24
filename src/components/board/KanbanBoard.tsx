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
  useSensor,
  useSensors,
  type CollisionDetection,
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
  const [columns, setColumns] = useState<Map<string, Ticket[]>>(new Map())
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null)
  const isDragging = useRef(false)
  // Always-current ref to avoid stale closures in event handlers
  const columnsRef = useRef<Map<string, Ticket[]>>(new Map())
  columnsRef.current = columns

  const reorder = useReorderTickets()

  // Sync columns from server when not dragging
  useEffect(() => {
    if (isDragging.current) return
    const map = new Map<string, Ticket[]>()
    statuses.forEach((s) => {
      map.set(
        s.id,
        tickets
          .filter((t) => t.status_id === s.id)
          .sort((a, b) => a.order_index - b.order_index),
      )
    })
    setColumns(map)
  }, [tickets, statuses])

  // Find which column a given id belongs to (uses ref = always fresh)
  const findColId = (id: string): string | null => {
    if (columnsRef.current.has(id)) return id
    for (const [colId, items] of columnsRef.current.entries()) {
      if (items.some((t) => t.id === id)) return colId
    }
    return null
  }

  // Custom collision: pointer-within first, then rect intersection
  const collisionDetection: CollisionDetection = (args) => {
    const pointer = pointerWithin(args)
    if (pointer.length > 0) return pointer
    return rectIntersection(args)
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  )

  const handleDragStart = ({ active }: DragStartEvent) => {
    isDragging.current = true
    const ticket = [...columnsRef.current.values()].flat().find((t) => t.id === active.id)
    setActiveTicket(ticket ?? null)
  }

  const handleDragOver = ({ active, over }: DragOverEvent) => {
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

    const fromId = findColId(active.id as string)
    const toId = findColId(over.id as string)

    if (!fromId) return

    // Same-column reorder
    if (fromId === toId) {
      const col = [...(columnsRef.current.get(fromId) ?? [])]
      const oldIdx = col.findIndex((t) => t.id === active.id)
      const newIdx = col.findIndex((t) => t.id === over.id)

      if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return

      const reordered = arrayMove(col, oldIdx, newIdx)
      setColumns((prev) => new Map(prev).set(fromId, reordered))
      reorder.mutate(reordered.map((t, i) => ({ id: t.id, status_id: fromId, order_index: i })))
      return
    }

    // Cross-column drop: persist full visual state
    const updates: { id: string; status_id: string; order_index: number }[] = []
    columnsRef.current.forEach((items, statusId) => {
      items.forEach((ticket, i) => {
        updates.push({ id: ticket.id, status_id: statusId, order_index: i })
      })
    })
    if (updates.length > 0) reorder.mutate(updates)
  }

  const handleDragCancel = () => {
    isDragging.current = false
    setActiveTicket(null)
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
      <div className="flex gap-4 h-full pb-4 overflow-x-auto scrollbar-thin">
        {statuses.map((status) => (
          <KanbanColumn
            key={status.id}
            status={status}
            tickets={columns.get(status.id) ?? []}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
        {activeTicket && (
          <div className="rotate-1 shadow-2xl">
            <TicketCard ticket={activeTicket} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
