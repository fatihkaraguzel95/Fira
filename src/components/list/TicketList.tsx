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
    <div className="flex flex-col h-full gap-3">
      <Filters filters={filters} onChange={(f) => setFilters({ ...f, project_id: projectId })} statuses={statuses} />

      <div className="flex-1 overflow-auto bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="bg-slate-50 dark:bg-gray-800/60 text-left border-b border-slate-200 dark:border-gray-700">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide">Başlık</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide w-36">Durum</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide w-28">Öncelik</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide w-36">Atananlar</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide w-28">Bitiş</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide w-28">Oluşturma</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-gray-800">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3.5">
                        <div className="h-4 bg-slate-100 dark:bg-gray-800 rounded-lg animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : tickets?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-gray-800 flex items-center justify-center">
                        <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <p className="text-sm text-slate-400 dark:text-gray-500 font-medium">Ticket bulunamadı</p>
                    </div>
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
                      className="hover:bg-primary-50/50 dark:hover:bg-primary-950/10 cursor-pointer transition-colors group"
                    >
                      <td className="px-4 py-3.5 font-medium text-slate-900 dark:text-gray-100 max-w-xs">
                        <span className="line-clamp-1 group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors">
                          {ticket.title}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        {status ? (
                          <span
                            className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg font-medium"
                            style={{ backgroundColor: status.color + '22', color: status.color }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: status.color }} />
                            {status.name}
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-gray-500 text-xs">{ticket.status}</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <PriorityBadge priority={ticket.priority} />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex -space-x-1">
                          {assignees.slice(0, 3).map(({ user }) => (
                            <UserAvatar key={user.id} user={user} size="sm" />
                          ))}
                          {assignees.length === 0 && (
                            <span className="text-slate-300 dark:text-gray-600 text-sm">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {dueDate ? (
                          <span className={`text-xs font-medium ${
                            isOverdue
                              ? 'text-red-500 dark:text-red-400'
                              : 'text-slate-500 dark:text-gray-400'
                          }`}>
                            {dueDate.toLocaleDateString('tr-TR')}
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-gray-600 text-sm">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-400 dark:text-gray-500">
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
    </div>
  )
}
