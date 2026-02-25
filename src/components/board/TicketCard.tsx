import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from 'react-router-dom'
import type { Ticket } from '../../types'
import { PriorityFlagBadge } from '../ticket/PriorityPicker'
import { UserAvatar } from '../ticket/UserAvatar'

interface Props {
  ticket: Ticket
}

export function TicketCard({ ticket }: Props) {
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: ticket.id })

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

  const dueDate = ticket.due_date ? new Date(ticket.due_date) : null
  const isOverdue = dueDate && dueDate < new Date()
  const assignees = ticket.assignees ?? []
  const tags = ticket.tags ?? []

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className={`
        bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 cursor-pointer
        hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all select-none
        ${isDragging ? 'shadow-lg ring-2 ring-blue-400' : ''}
      `}
    >
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-snug line-clamp-2 mb-2">
        {ticket.title}
      </p>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
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
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 font-medium">
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
                <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 ring-1 ring-white dark:ring-gray-800 flex items-center justify-center text-xs text-gray-500 dark:text-gray-400 font-medium">
                  +{assignees.length - 3}
                </div>
              )}
            </div>
          )}
        </div>

        {dueDate && (
          <span className={`text-xs font-medium flex-shrink-0 ${isOverdue ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'}`}>
            {dueDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>
    </div>
  )
}
