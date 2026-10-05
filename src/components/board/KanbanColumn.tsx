import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { isLeavingAfterCelebration } from '../../lib/celebrate'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useNavigate } from 'react-router-dom'
import { openTicket } from '../../lib/nav'
import type { Ticket, TicketStatus } from '../../types'
import { TicketCard } from './TicketCard'
import { ColumnQuickAdd } from './ColumnQuickAdd'
import { PriorityFlagBadge } from '../ticket/PriorityPicker'
import { StatusIndicator } from '../ticket/StatusIndicator'
import { useT } from '../../i18n'
import { displayDate, useDateFormat } from '../../lib/time'

// ─── Compact archived card ────────────────────────────────────────────────────
function ArchivedCard({ ticket, onUnarchive }: { ticket: Ticket; onUnarchive: () => void }) {
  const t = useT()
  useDateFormat()   // repaint when the chosen date format changes
  const navigate = useNavigate()
  const dueDate = ticket.due_date ? new Date(ticket.due_date) : null

  return (
    <div className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-field/40 border border-slate-100 dark:border-gray-700/50 hover:border-slate-200 dark:hover:border-gray-600/60 transition-colors">
      <Icon name="archive" className="text-fg-faint" />
      <button
        className="flex-1 text-left min-w-0"
        onClick={() => openTicket(navigate, ticket.id)}
      >
        <p className="text-xs text-fg-faint truncate leading-tight">{ticket.title}</p>
      </button>
      <div className="flex items-center gap-1 flex-shrink-0">
        <PriorityFlagBadge priority={ticket.priority} size="sm" />
        {dueDate && (
          <span className="text-2xs text-fg-faint tabular-nums">
            {displayDate(ticket.due_date!)}
          </span>
        )}
        <button
          onClick={onUnarchive}
          title={t('board.column.unarchive')}
          className="opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center rounded-md text-fg-faint hover:text-primary-600 dark:hover:text-primary-400"
        >
          <Icon name="undo" />
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
  onArchive?: (id: string, archived: boolean) => void
  canDeleteTicket?: (t: Ticket) => boolean
  canDrag?: boolean
  teamId?: string | null
  canAssign?: boolean
  /** Column header can be dragged to reorder statuses. */
  canReorder?: boolean
  /** A card is being dragged somewhere on the board — only then do empty columns show a drop hint. */
  dragActive?: boolean
  /** List the column belongs to — needed to create a ticket straight from the column. */
  projectId?: string
  canCreate?: boolean
  /** Set when a filter (not emptiness) is why this column has nothing in it. */
  hiddenNotice?: { label: string; cta: string; onShow?: () => void } | null
  /** Unfiltered task count for this status — badge shows "visible/total" when they differ. */
  totalCount?: number | null
}

export function KanbanColumn({ status, tickets, archivedTickets, onArchive, canDeleteTicket, canDrag = true, teamId = null, canAssign = false, canReorder = false, dragActive = false, projectId, canCreate = false, hiddenNotice = null, totalCount = null }: Props) {
  const t = useT()
  const { setNodeRef, isOver } = useDroppable({ id: status.id })
  const sortable = useSortable({ id: `col:${status.id}`, disabled: !canReorder })
  const colStyle = { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition, opacity: sortable.isDragging ? 0.6 : 1 }
  const [showArchived, setShowArchived] = useState(false)
  const empty = tickets.length === 0

  return (
    <div role="region" aria-label={t('board.column.regionLabel', { name: status.name })} ref={sortable.setNodeRef} style={colStyle} className="flex flex-col w-[300px] flex-shrink-0 min-h-0 h-full">
      {/* No card-like container: columns are implied by the alignment of the cards themselves. */}
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-0 flex flex-col rounded-xl transition-colors duration-150 ${
          isOver ? 'bg-primary-50/50 dark:bg-primary-950/20 ring-1 ring-primary-300/70 dark:ring-primary-700/70' : ''
        }`}
      >

        {/* Column header */}
        {/* The whole header is the drag activator: press and drag the title to reorder columns */}
        <div
          {...(canReorder ? sortable.attributes : {})}
          {...(canReorder ? sortable.listeners : {})}
          title={canReorder ? t('board.column.dragHint') : undefined}
          aria-label={canReorder ? t('board.column.reorderLabel', { name: status.name }) : undefined}
          className={`px-1.5 py-2 flex items-center justify-between flex-shrink-0 select-none ${canReorder ? 'cursor-move' : ''}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <StatusIndicator status={status} size={15} />
            <h2 className="font-semibold text-fg-2 text-sm leading-none truncate">
              {status.name}
            </h2>
          </div>
          {/* Always rendered — hiding it on empty columns made their headers shorter
              than the rest, so the whole column sat a few pixels higher. Zero is
              just kept quiet instead of removed. */}
          {/* When a filter hides part of the column, say so: "3/120". Without it
              there was no sign that 117 tasks existed but were filtered out. */}
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums min-w-[22px] text-center flex-shrink-0 ${
              tickets.length > 0 ? 'bg-line text-fg-2' : 'text-fg-faint'
            }`}
            title={totalCount != null && totalCount !== tickets.length
              ? t('board.column.countHint', { total: totalCount, shown: tickets.length })
              : undefined}
          >
            {tickets.length}
            {totalCount != null && totalCount !== tickets.length && (
              <span className="font-normal opacity-60">/{totalCount}</span>
            )}
          </span>
        </div>

        {/* Card list area */}
        <div data-card-list className="flex-1 min-h-[120px] overflow-y-auto scrollbar-thin px-0.5 pb-3 space-y-2">
          {canCreate && projectId && <ColumnQuickAdd status={status} projectId={projectId} teamId={teamId} />}
          <SortableContext items={tickets.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} onArchive={onArchive} canDelete={canDeleteTicket ? canDeleteTicket(ticket) : true} canDrag={canDrag} teamId={teamId} canAssign={canAssign} leaving={isLeavingAfterCelebration(ticket.id)} />
            ))}
          </SortableContext>

          {empty && (
            dragActive ? (
              <div
                className={`flex flex-col items-center justify-center h-20 rounded-xl border-2 border-dashed transition-colors gap-1 ${
                  isOver
                    ? 'border-primary-300 dark:border-primary-700 text-primary-400 dark:text-primary-500 bg-primary-50/50 dark:bg-primary-950/10'
                    : 'border-line text-fg-faint'
                }`}
              >
                <Icon name="plus" />
                <span className="text-xs font-medium">{t('board.dropHere')}</span>
              </div>
            ) : (
              /* "No data" placeholder — same dashed frame as the "Durum Ekle" column button */
              <div className="flex flex-col items-center justify-center gap-1.5 py-8 rounded-xl border-2 border-dashed border-line text-fg-faint select-none">
                <Icon name="inbox" size={28} className="opacity-40" />
                <span className="text-xs">{hiddenNotice ? hiddenNotice.label : t('board.column.empty')}</span>
                {hiddenNotice && (hiddenNotice.onShow ? (
                  <button
                    type="button"
                    onClick={hiddenNotice.onShow}
                    className="mt-1 text-2xs font-medium px-2 py-1 rounded-md border border-line/70 bg-transparent text-fg-muted hover:text-fg hover:bg-raised/60 transition-colors"
                  >
                    {hiddenNotice.cta}
                  </button>
                ) : (
                  <span className="text-2xs opacity-70 text-center px-2">{hiddenNotice.cta}</span>
                ))}
              </div>
            )
          )}
        </div>

        {/* Archived section */}
        {archivedTickets.length > 0 && (
          <div className="border-t border-line-soft px-1 pt-2 pb-3 flex-shrink-0">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="w-full flex items-center gap-1.5 text-xs text-fg-faint hover:text-fg-2 transition-colors mb-1.5 group"
            >
              <Icon name="chevronRight" className={`transition-transform ${showArchived ? 'rotate-90' : ''}`} />
              <Icon name="archive" className="opacity-60" />
              <span className="font-medium">{t('board.column.archivedCount', { n: archivedTickets.length })}</span>
            </button>

            {showArchived && (
              <div className="space-y-1">
                {archivedTickets.map((ticket) => (
                  <ArchivedCard
                    key={ticket.id}
                    ticket={ticket}
                    onUnarchive={() => onArchive?.(ticket.id, false)}
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
