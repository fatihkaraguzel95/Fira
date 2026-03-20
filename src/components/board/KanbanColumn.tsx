import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useNavigate } from 'react-router-dom'
import type { Ticket, TicketStatus } from '../../types'
import { TicketCard } from './TicketCard'
import { PriorityFlagBadge } from '../ticket/PriorityPicker'

// ─── Compact archived card ────────────────────────────────────────────────────
function ArchivedCard({ ticket, onUnarchive }: { ticket: Ticket; onUnarchive: () => void }) {
  const navigate = useNavigate()
  const dueDate = ticket.due_date ? new Date(ticket.due_date) : null

  return (
    <div className="group flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700/60 hover:border-slate-300 dark:hover:border-gray-600 transition-colors">
      <svg className="w-3 h-3 text-slate-300 dark:text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
      </svg>
      <button
        className="flex-1 text-left min-w-0"
        onClick={() => navigate(`/ticket/${ticket.id}`)}
      >
        <p className="text-xs text-slate-400 dark:text-gray-500 truncate leading-tight">{ticket.title}</p>
      </button>
      <div className="flex items-center gap-1 flex-shrink-0">
        <PriorityFlagBadge priority={ticket.priority} size="sm" />
        {dueDate && (
          <span className="text-xs text-slate-300 dark:text-gray-600">
            {dueDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
          </span>
        )}
        <button
          onClick={onUnarchive}
          title="Arşivden Çıkar"
          className="opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center rounded text-slate-400 hover:text-primary-600"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ─── Column ───────────────────────────────────────────────────────────────────
interface Props {
  status: TicketStatus
  tickets: Ticket[]
  archivedTickets: Ticket[]
  onArchive: (id: string, archived: boolean) => void
}

export function KanbanColumn({ status, tickets, archivedTickets, onArchive }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id })
  const [showArchived, setShowArchived] = useState(false)

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[280px] max-w-[320px] w-full flex-shrink-0 rounded-xl border shadow-card transition-all duration-150 ${
        isOver
          ? 'bg-primary-50 dark:bg-primary-950/20 border-primary-300 dark:border-primary-700 shadow-card-hover'
          : 'bg-white dark:bg-gray-900 border-slate-200 dark:border-gray-700'
      }`}
      style={{ borderTopWidth: 3, borderTopColor: status.color }}
    >
      {/* Column header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: status.color }} />
          <h3 className="font-semibold text-slate-700 dark:text-gray-200 text-sm">{status.name}</h3>
        </div>
        <span className="text-xs font-semibold text-slate-500 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 rounded-full px-2 py-0.5 min-w-[22px] text-center tabular-nums">
          {tickets.length}
        </span>
      </div>

      {/* Divider */}
      <div className="h-px bg-slate-100 dark:bg-gray-800 mx-0" />

      {/* Active cards */}
      <div className="flex-1 p-3 space-y-2 min-h-[200px]">
        <SortableContext items={tickets.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} onArchive={onArchive} />
          ))}
        </SortableContext>

        {tickets.length === 0 && (
          <div className={`flex items-center justify-center h-20 text-xs rounded-xl border-2 border-dashed transition-colors ${
            isOver
              ? 'border-primary-300 dark:border-primary-700 text-primary-400 dark:text-primary-500'
              : 'border-slate-200 dark:border-gray-700 text-slate-300 dark:text-gray-600'
          }`}>
            Buraya bırak
          </div>
        )}
      </div>

      {/* Archived section */}
      {archivedTickets.length > 0 && (
        <div className="border-t border-slate-100 dark:border-gray-800 px-3 pt-2 pb-3">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="w-full flex items-center gap-1.5 text-xs text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-400 transition-colors mb-1.5"
          >
            <svg
              className={`w-3 h-3 transition-transform flex-shrink-0 ${showArchived ? 'rotate-90' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            {archivedTickets.length} arşivlenmiş
          </button>

          {showArchived && (
            <div className="space-y-1">
              {archivedTickets.map((ticket) => (
                <ArchivedCard
                  key={ticket.id}
                  ticket={ticket}
                  onUnarchive={() => onArchive(ticket.id, false)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
