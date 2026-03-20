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
import { useReorderTickets, useArchiveTicket, getLocalArchivedIds } from '../../hooks/useTickets'
import { useCreateStatus } from '../../hooks/useStatuses'

const COLORS = [
  { hex: '#6b7280', label: 'Gri' },
  { hex: '#3b82f6', label: 'Mavi' },
  { hex: '#10b981', label: 'Yeşil' },
  { hex: '#f59e0b', label: 'Sarı' },
  { hex: '#ef4444', label: 'Kırmızı' },
  { hex: '#8b5cf6', label: 'Mor' },
  { hex: '#ec4899', label: 'Pembe' },
  { hex: '#f97316', label: 'Turuncu' },
]

interface Props {
  tickets: Ticket[]
  statuses: TicketStatus[]
  projectId: string
}

function AddStatusColumn({ projectId }: { projectId: string }) {
  const createStatus = useCreateStatus()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6b7280')

  const handleAdd = async () => {
    if (!name.trim()) return
    await createStatus.mutateAsync({ projectId, name: name.trim(), color })
    setName('')
    setColor('#6b7280')
    setAdding(false)
  }

  if (!adding) {
    return (
      <div className="flex-shrink-0 w-[300px] flex items-start pt-1">
        <button
          onClick={() => setAdding(true)}
          className="w-full flex items-center justify-center py-3 rounded-2xl border-2 border-dashed border-slate-300 dark:border-gray-600 text-slate-400 dark:text-gray-500 hover:border-primary-400 hover:text-primary-500 dark:hover:border-primary-600 dark:hover:text-primary-400 transition-all text-sm font-medium gap-2 h-12"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Durum Ekle
        </button>
      </div>
    )
  }

  return (
    <div className="flex-shrink-0 w-[300px] bg-white dark:bg-gray-900 rounded-2xl border border-slate-200 dark:border-gray-700 shadow-card p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-700 dark:text-gray-200">Yeni Durum</p>

      <div className="flex flex-wrap gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c.hex}
            title={c.label}
            onClick={() => setColor(c.hex)}
            className="w-6 h-6 rounded-full transition-transform hover:scale-110 flex-shrink-0"
            style={{
              backgroundColor: c.hex,
              outline: color === c.hex ? `2px solid ${c.hex}` : undefined,
              outlineOffset: 2,
              boxShadow: color === c.hex ? '0 0 0 1px white inset' : undefined,
            }}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
            if (e.key === 'Escape') setAdding(false)
          }}
          placeholder="Durum adı..."
          className="flex-1 border border-slate-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-transparent dark:text-gray-200 placeholder-slate-400 dark:placeholder-gray-500"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleAdd}
          disabled={!name.trim() || createStatus.isPending}
          className="flex-1 text-xs bg-primary-600 text-white px-3 py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors font-medium"
        >
          Ekle
        </button>
        <button
          onClick={() => setAdding(false)}
          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors"
        >
          İptal
        </button>
      </div>
    </div>
  )
}

export function KanbanBoard({ tickets, statuses, projectId }: Props) {
  const [columns, setColumns] = useState<Map<string, Ticket[]>>(new Map())
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null)
  const isDragging = useRef(false)
  const columnsRef = useRef<Map<string, Ticket[]>>(new Map())
  columnsRef.current = columns

  const reorder = useReorderTickets()
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
    setColumns(map)
  }, [tickets, statuses, localArchivedIds])

  const findColId = (id: string): string | null => {
    if (columnsRef.current.has(id)) return id
    for (const [colId, items] of columnsRef.current.entries()) {
      if (items.some((t) => t.id === id)) return colId
    }
    return null
  }

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
    dragFromId.current = findColId(active.id as string)
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
      reorder.mutate(reordered.map((t, i) => ({ id: t.id, status_id: currentColId, order_index: i })))
      return
    }

    // Cross-column move: persist every ticket's current column & position
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
      <div className="flex gap-5 h-full pb-6 overflow-x-auto scrollbar-thin items-start">
        {statuses.map((status) => (
          <KanbanColumn
            key={status.id}
            status={status}
            tickets={columns.get(status.id) ?? []}
            archivedTickets={archivedMap.get(status.id) ?? []}
            onArchive={handleArchive}
          />
        ))}
        <AddStatusColumn projectId={projectId} />
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
