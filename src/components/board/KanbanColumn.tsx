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
    <div className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white dark:bg-gray-800/40 border border-slate-100 dark:border-gray-700/50 hover:border-slate-200 dark:hover:border-gray-600/60 transition-colors">
      <svg className="w-3 h-3 text-slate-300 dark:text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
      </svg>
      <button
        className="flex-1 text-left min-w-0"
        onClick={() => navigate(`/ticket/${ticket.id}`)}
      >
        <p className="text-[11px] text-slate-400 dark:text-gray-500 truncate leading-tight">{ticket.title}</p>
      </button>
      <div className="flex items-center gap-1 flex-shrink-0">
        <PriorityFlagBadge priority={ticket.priority} size="sm" />
        {dueDate && (
          <span className="text-[10px] text-slate-300 dark:text-gray-600 tabular-nums">
            {dueDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
          </span>
        )}
        <button
          onClick={onUnarchive}
          title="Arşivden Çıkar"
          className="opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center rounded text-slate-400 hover:text-primary-600 dark:hover:text-primary-400"
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
    <div className="flex flex-col w-[300px] flex-shrink-0 min-h-0">
      <div
        ref={setNodeRef}
        className={`
          flex flex-col rounded-2xl border overflow-hidden transition-all duration-150
          ${isOver
            ? 'ring-2 ring-primary-400 ring-offset-2 bg-primary-50/50 dark:bg-primary-950/20 border-primary-300 dark:border-primary-700'
            : 'bg-slate-50/80 dark:bg-gray-900/60 border-slate-200 dark:border-gray-700/80'
          }
        `}
      >
        {/* Status color top accent bar */}
        <div className="h-0.5 w-full flex-shrink-0" style={{ backgroundColor: status.color }} />

        {/* Column header */}
        <div className="px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: status.color }}
            />
            <h3 className="font-semibold text-slate-700 dark:text-gray-200 text-sm leading-none">
              {status.name}
            </h3>
          </div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-gray-700 text-slate-600 dark:text-gray-300 tabular-nums min-w-[22px] text-center">
            {tickets.length}
          </span>
        </div>

        {/* Divider */}
        <div className="h-px bg-slate-200/70 dark:bg-gray-700/50 mx-3" />

        {/* Card list area */}
        <div className="flex-1 p-3 space-y-2 min-h-[120px]">
          <SortableContext items={tickets.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} onArchive={onArchive} />
            ))}
          </SortableContext>

          {tickets.length === 0 && (
            <div
              className={`flex flex-col items-center justify-center h-20 rounded-xl border-2 border-dashed transition-colors gap-1 ${
                isOver
                  ? 'border-primary-300 dark:border-primary-700 text-primary-400 dark:text-primary-500 bg-primary-50/50 dark:bg-primary-950/10'
                  : 'border-slate-200 dark:border-gray-700 text-slate-300 dark:text-gray-600'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-[11px] font-medium">Buraya bırak</span>
            </div>
          )}
        </div>

        {/* Archived section */}
        {archivedTickets.length > 0 && (
          <div className="border-t border-slate-200/70 dark:border-gray-700/50 px-3 pt-2 pb-3 flex-shrink-0">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="w-full flex items-center gap-1.5 text-xs text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-400 transition-colors mb-1.5 group"
            >
              <svg
                className={`w-3 h-3 transition-transform flex-shrink-0 ${showArchived ? 'rotate-90' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <svg className="w-3 h-3 flex-shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              <span className="font-medium">{archivedTickets.length} arşivlenmiş</span>
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
    </div>
  )
}
