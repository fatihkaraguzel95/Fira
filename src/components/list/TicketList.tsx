import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTickets } from '../../hooks/useTickets'
import type { TicketFilters, TicketStatus } from '../../types'
import { TicketFilters as Filters } from './TicketFilters'
import { PriorityBadge } from '../ticket/PriorityBadge'
import { UserAvatar } from '../ticket/UserAvatar'

interface Props {
  projectId: string
  statuses: TicketStatus[]
}

export function TicketList({ projectId, statuses }: Props) {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<TicketFilters>({ project_id: projectId })
  const { data: tickets, isLoading } = useTickets({ ...filters, project_id: projectId })

  return (
    <div className="flex flex-col h-full">
      <Filters filters={filters} onChange={(f) => setFilters({ ...f, project_id: projectId })} statuses={statuses} />

      <div className="flex-1 overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 text-left">
              <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">Başlık</th>
              <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide w-36">Durum</th>
              <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide w-28">Öncelik</th>
              <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide w-36">Atananlar</th>
              <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide w-28">Bitiş</th>
              <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide w-28">Oluşturma</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-gray-800">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : tickets?.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">
                  Ticket bulunamadı
                </td>
              </tr>
            ) : (
              tickets?.map((ticket) => {
                const dueDate = ticket.due_date ? new Date(ticket.due_date) : null
                const isOverdue = dueDate && dueDate < new Date()
                const status = ticket.status_info
                const assignees = ticket.assignees ?? []
                return (
                  <tr
                    key={ticket.id}
                    onClick={() => navigate(`/ticket/${ticket.id}`)}
                    className="border-b border-gray-50 dark:border-gray-800 hover:bg-blue-50 dark:hover:bg-blue-900/10 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 max-w-xs">
                      <span className="line-clamp-1">{ticket.title}</span>
                    </td>
                    <td className="px-4 py-3">
                      {status ? (
                        <span
                          className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded font-medium"
                          style={{ backgroundColor: status.color + '22', color: status.color }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
                          {status.name}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500 text-xs">{ticket.status}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={ticket.priority} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex -space-x-1">
                        {assignees.slice(0, 3).map(({ user }) => (
                          <UserAvatar key={user.id} user={user} size="sm" />
                        ))}
                        {assignees.length === 0 && (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {dueDate ? (
                        <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                          {dueDate.toLocaleDateString('tr-TR')}
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500">
                      {new Date(ticket.created_at).toLocaleDateString('tr-TR')}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
