import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Ticket, TicketStatus } from '../../types'
import { TicketCard } from './TicketCard'

interface Props {
  status: TicketStatus
  tickets: Ticket[]
}

export function KanbanColumn({ status, tickets }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id })

  return (
    <div className="flex flex-col min-w-[280px] max-w-[320px] w-full flex-shrink-0">
      <div
        className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col h-full"
        style={{ borderTopWidth: 3, borderTopColor: status.color }}
      >
        {/* Column header */}
        <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: status.color }} />
            <h3 className="font-semibold text-gray-700 text-sm">{status.name}</h3>
          </div>
          <span className="text-xs font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
            {tickets.length}
          </span>
        </div>

        {/* Cards area */}
        <div
          ref={setNodeRef}
          className={`flex-1 p-3 space-y-2 min-h-[120px] rounded-b-xl transition-colors ${
            isOver ? 'bg-blue-50' : ''
          }`}
        >
          <SortableContext items={tickets.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </SortableContext>

          {tickets.length === 0 && (
            <div className="flex items-center justify-center h-16 text-xs text-gray-300 border-2 border-dashed border-gray-200 rounded-lg">
              Buraya bırak
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
