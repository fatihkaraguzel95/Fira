import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from 'react-router-dom'
import type { Ticket } from '../../types'
import { PriorityFlagBadge } from '../ticket/PriorityPicker'
import { UserAvatar } from '../ticket/UserAvatar'
import { ContextMenu } from './ContextMenu'
import { useDeleteTicket } from '../../hooks/useTickets'

interface Props {
  ticket: Ticket
  onArchive: (id: string, archived: boolean) => void
}

export function TicketCard({ ticket, onArchive }: Props) {
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: ticket.id })
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const deleteTicket = useDeleteTicket()

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  }

  const handleClick = (e: React.MouseEvent) => {
    if (isDragging) return
    e.stopPropagation()
    navigate(`/ticket/${ticket.id}`)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const dueDate = ticket.due_date ? new Date(ticket.due_date) : null
  const isOverdue = dueDate && dueDate < new Date()
  const assignees = ticket.assignees ?? []
  const tags = ticket.tags ?? []

  const contextItems = [
    {
      label: 'Aç',
      icon: (
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      ),
      onClick: () => navigate(`/ticket/${ticket.id}`),
    },
    {
      label: 'Arşivle',
      icon: (
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
      ),
      onClick: () => onArchive(ticket.id, true),
    },
    {
      label: 'Sil',
      danger: true,
      icon: (
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
      onClick: () => {
        if (confirm('Bu ticket silinsin mi?')) deleteTicket.mutate(ticket.id)
      },
    },
  ]

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={`
          bg-white dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 p-3.5 cursor-pointer select-none
          shadow-card hover:shadow-card-hover hover:border-primary-300 dark:hover:border-primary-600
          transition-all duration-150
          ${isDragging ? 'shadow-card-hover ring-2 ring-primary-400 ring-offset-1' : ''}
        `}
      >
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-snug line-clamp-2 mb-2.5">
          {ticket.title}
        </p>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2.5">
            {tags.slice(0, 3).map(({ tag }) => (
              <span
                key={tag.id}
                className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: tag.color + '20', color: tag.color }}
              >
                {tag.name}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-gray-700 text-slate-400 dark:text-gray-500 font-medium">
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <PriorityFlagBadge priority={ticket.priority} size="sm" />
            {assignees.length > 0 && (
              <div className="flex -space-x-1.5">
                {assignees.slice(0, 3).map(({ user }) => (
                  <div key={user.id} className="ring-1 ring-white dark:ring-gray-800 rounded-full">
                    <UserAvatar user={user} size="sm" />
                  </div>
                ))}
                {assignees.length > 3 && (
                  <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-gray-700 ring-1 ring-white dark:ring-gray-800 flex items-center justify-center text-xs text-slate-500 dark:text-gray-400 font-medium">
                    +{assignees.length - 3}
                  </div>
                )}
              </div>
            )}
          </div>

          {dueDate && (
            <span className={`text-xs font-medium flex-shrink-0 ${
              isOverdue
                ? 'text-red-500 dark:text-red-400'
                : 'text-slate-400 dark:text-gray-500'
            }`}>
              {dueDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          items={contextItems}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}
