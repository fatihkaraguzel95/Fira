import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from 'react-router-dom'
import type { Ticket } from '../../types'
import { PriorityBadge } from '../ticket/PriorityBadge'
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
        bg-white rounded-lg border border-gray-200 p-3 cursor-pointer
        hover:shadow-md hover:border-blue-300 transition-all select-none
        ${isDragging ? 'shadow-lg ring-2 ring-blue-400' : ''}
      `}
    >
      <p className="text-sm font-medium text-gray-900 mb-2 leading-snug line-clamp-2">
        {ticket.title}
      </p>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {tags.slice(0, 3).map(({ tag }) => (
            <span
              key={tag.id}
              className="text-xs px-1.5 py-0.5 rounded font-medium"
              style={{ backgroundColor: tag.color + '22', color: tag.color }}
            >
              {tag.name}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="text-xs text-gray-400">+{tags.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <PriorityBadge priority={ticket.priority} />

        <div className="flex items-center gap-1.5">
          {dueDate && (
            <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
              {dueDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
            </span>
          )}
          {/* Multi-assignee avatars */}
          <div className="flex -space-x-1">
            {assignees.slice(0, 3).map(({ user }) => (
              <UserAvatar key={user.id} user={user} size="sm" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
