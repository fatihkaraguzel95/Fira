import type { TicketFilters, TicketPriority, TicketStatus } from '../../types'
import { useUsers } from '../../hooks/useUsers'

interface Props {
  filters: TicketFilters
  onChange: (f: TicketFilters) => void
  statuses: TicketStatus[]
}

const PRIORITIES: { value: TicketPriority; label: string; color: string }[] = [
  { value: 'low',      label: 'Düşük',   color: '#6b7280' },
  { value: 'medium',   label: 'Orta',    color: '#3b82f6' },
  { value: 'high',     label: 'Yüksek',  color: '#f59e0b' },
  { value: 'critical', label: 'Kritik',  color: '#ef4444' },
]

export function TicketFilters({ filters, onChange, statuses }: Props) {
  const { data: users } = useUsers()

  const toggleStatus = (id: string) => {
    const cur = filters.status_id ?? []
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    onChange({ ...filters, status_id: next.length ? next : undefined })
  }

  const togglePriority = (p: TicketPriority) => {
    const cur = filters.priority ?? []
    const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]
    onChange({ ...filters, priority: next.length ? next : undefined })
  }

  const hasFilters =
    (filters.status_id?.length ?? 0) > 0 ||
    (filters.priority?.length ?? 0) > 0 ||
    filters.assignee_id ||
    filters.search

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
      {/* Search */}
      <input
        type="text"
        placeholder="Ara..."
        value={filters.search ?? ''}
        onChange={(e) => onChange({ ...filters, search: e.target.value || undefined })}
        className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
      />

      {/* Divider */}
      <div className="h-5 w-px bg-gray-200" />

      {/* Status */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400 font-medium whitespace-nowrap">Durum:</span>
        <div className="flex gap-1 flex-wrap">
          {statuses.map((s) => {
            const active = filters.status_id?.includes(s.id)
            return (
              <button
                key={s.id}
                onClick={() => toggleStatus(s.id)}
                className="px-2.5 py-1 text-xs rounded-full font-medium transition-all border"
                style={
                  active
                    ? { backgroundColor: s.color, color: '#fff', borderColor: s.color }
                    : { backgroundColor: s.color + '15', color: s.color, borderColor: s.color + '40' }
                }
              >
                {s.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-gray-200" />

      {/* Priority */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400 font-medium whitespace-nowrap">Öncelik:</span>
        <div className="flex gap-1">
          {PRIORITIES.map(({ value, label, color }) => {
            const active = filters.priority?.includes(value)
            return (
              <button
                key={value}
                onClick={() => togglePriority(value)}
                className="px-2.5 py-1 text-xs rounded-full font-medium transition-all border"
                style={
                  active
                    ? { backgroundColor: color, color: '#fff', borderColor: color }
                    : { backgroundColor: color + '15', color: color, borderColor: color + '40' }
                }
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-gray-200" />

      {/* Assignee */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400 font-medium whitespace-nowrap">Kişi:</span>
        <select
          value={filters.assignee_id ?? ''}
          onChange={(e) => onChange({ ...filters, assignee_id: e.target.value || undefined })}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Hepsi</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
          ))}
        </select>
      </div>

      {/* Clear */}
      {hasFilters && (
        <>
          <div className="h-5 w-px bg-gray-200" />
          <button
            onClick={() => onChange({ project_id: filters.project_id })}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1"
          >
            ✕ Temizle
          </button>
        </>
      )}
    </div>
  )
}
