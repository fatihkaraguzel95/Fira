import type { TicketFilters, TicketPriority, TicketStatus } from '../../types'
import { useUsers } from '../../hooks/useUsers'

interface Props {
  filters: TicketFilters
  onChange: (f: TicketFilters) => void
  statuses: TicketStatus[]
}

const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: 'low', label: 'Düşük' },
  { value: 'medium', label: 'Orta' },
  { value: 'high', label: 'Yüksek' },
  { value: 'critical', label: 'Kritik' },
]

export function TicketFilters({ filters, onChange, statuses }: Props) {
  const { data: users } = useUsers()

  const toggleStatus = (id: string) => {
    const current = filters.status_id ?? []
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    onChange({ ...filters, status_id: next.length ? next : undefined })
  }

  const togglePriority = (p: TicketPriority) => {
    const current = filters.priority ?? []
    const next = current.includes(p) ? current.filter((x) => x !== p) : [...current, p]
    onChange({ ...filters, priority: next.length ? next : undefined })
  }

  const hasFilters = (filters.status_id?.length ?? 0) > 0 || (filters.priority?.length ?? 0) > 0 || filters.assignee_id || filters.search

  return (
    <div className="flex flex-wrap items-center gap-2 py-3 px-1">
      <input
        type="text"
        placeholder="Ara..."
        value={filters.search ?? ''}
        onChange={(e) => onChange({ ...filters, search: e.target.value || undefined })}
        className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
      />

      {statuses.map((s) => (
        <button
          key={s.id}
          onClick={() => toggleStatus(s.id)}
          className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors`}
          style={
            filters.status_id?.includes(s.id)
              ? { backgroundColor: s.color, color: '#fff' }
              : { backgroundColor: s.color + '22', color: s.color }
          }
        >
          {s.name}
        </button>
      ))}

      <div className="flex gap-1">
        {PRIORITIES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => togglePriority(value)}
            className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${
              filters.priority?.includes(value) ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <select
        value={filters.assignee_id ?? ''}
        onChange={(e) => onChange({ ...filters, assignee_id: e.target.value || undefined })}
        className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">Tüm kullanıcılar</option>
        {users?.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
      </select>

      {hasFilters && (
        <button onClick={() => onChange({ project_id: filters.project_id })} className="text-xs text-gray-400 hover:text-gray-700 underline">
          Temizle
        </button>
      )}
    </div>
  )
}
