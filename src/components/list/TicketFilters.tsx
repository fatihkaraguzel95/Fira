import type { TicketFilters, TicketPriority, TicketStatus } from '../../types'
import { useUsers } from '../../hooks/useUsers'

interface Props {
  filters: TicketFilters
  onChange: (f: TicketFilters) => void
  statuses: TicketStatus[]
}

const PRIORITIES: { value: TicketPriority; label: string; color: string }[] = [
  { value: 'low',      label: 'Düşük',   color: '#94a3b8' },
  { value: 'medium',   label: 'Orta',    color: '#f59e0b' },
  { value: 'high',     label: 'Yüksek',  color: '#f97316' },
  { value: 'critical', label: 'Kritik',  color: '#ef4444' },
]

const Divider = () => (
  <div className="h-5 w-px bg-slate-200 dark:bg-gray-700 flex-shrink-0" />
)

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
    !!filters.assignee_id ||
    !!filters.search

  return (
    <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl px-4 py-3 mb-4 shadow-card flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* Search */}
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-gray-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Ara..."
          value={filters.search ?? ''}
          onChange={(e) => onChange({ ...filters, search: e.target.value || undefined })}
          className="pl-8 pr-3 py-1.5 border border-slate-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-500 w-36 transition-shadow"
        />
      </div>

      <Divider />

      {/* Status */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-slate-400 dark:text-gray-500 font-semibold uppercase tracking-wide whitespace-nowrap">Durum:</span>
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

      <Divider />

      {/* Priority */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-400 dark:text-gray-500 font-semibold uppercase tracking-wide whitespace-nowrap">Öncelik:</span>
        <div className="flex gap-1 flex-wrap">
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

      <Divider />

      {/* Assignee */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-400 dark:text-gray-500 font-semibold uppercase tracking-wide whitespace-nowrap">Kişi:</span>
        <select
          value={filters.assignee_id ?? ''}
          onChange={(e) => onChange({ ...filters, assignee_id: e.target.value || undefined })}
          className="border border-slate-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-800 dark:text-gray-200 transition-shadow"
        >
          <option value="">Hepsi</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
          ))}
        </select>
      </div>

      {hasFilters && (
        <>
          <Divider />
          <button
            onClick={() => onChange({ project_id: filters.project_id })}
            className="text-xs text-slate-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors flex items-center gap-1 font-medium"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Temizle
          </button>
        </>
      )}
    </div>
  )
}
