import { useMemo, useState } from 'react'
import { Icon } from '../ui/Icon'
import type { TicketFilters, TicketStatus, TicketPriority, DueBucket } from '../../types'
import { useTeamMemberProfiles } from '../../hooks/useTeams'
import { useAuth } from '../../hooks/useAuth'
import { useTags } from '../../hooks/useTags'
import { PRIORITIES } from '../ticket/PriorityPicker'
import { UserAvatar } from '../ticket/UserAvatar'
import { dueOptions, UNASSIGNED } from '../../lib/ticketFilters'
import { useT } from '../../i18n'

/** The criteria a filter can be built from — one per section of the menu. */
export type FilterSection = 'assignee' | 'tags' | 'priority' | 'status' | 'due'

export function toggleIn<T>(list: T[] | undefined, v: T): T[] | undefined {
  const cur = list ?? []
  const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]
  return next.length ? next : undefined
}

export const FilterCheck = ({ on }: { on: boolean }) => (
  <span className={`w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-md border ${on ? 'bg-primary-600 border-primary-600 text-white' : 'border-line bg-field'}`}>
    {on && <Icon name="check" size={12} />}
  </span>
)

export const filterRowClass =
  'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-fg-2 hover:bg-raised hover:text-fg text-left focus-visible:bg-raised focus-visible:text-fg outline-none'

/** How many choices are active in one section — for the "(2)" next to a label. */
export function sectionCount(filters: TicketFilters, s: FilterSection): number {
  return s === 'assignee' ? filters.assignee_ids?.length ?? 0
    : s === 'tags' ? filters.tag_ids?.length ?? 0
    : s === 'priority' ? filters.priority?.length ?? 0
    : s === 'status' ? filters.status_id?.length ?? 0
    : filters.due?.length ?? 0
}

/** Drop just this section's choices, leaving the rest of the filter alone. */
export function clearSection(filters: TicketFilters, s: FilterSection): TicketFilters {
  return s === 'assignee' ? { ...filters, assignee_ids: undefined }
    : s === 'tags' ? { ...filters, tag_ids: undefined }
    : s === 'priority' ? { ...filters, priority: undefined }
    : s === 'status' ? { ...filters, status_id: undefined }
    : { ...filters, due: undefined }
}

/**
 * The choices of one filter criterion. Lives on its own so the header menu and
 * the list view's column headers (#22AA9355) offer the same list, in the same
 * order, writing to the same filter — a column popover that drifted from the
 * menu would be two filters with one name.
 */
export function FilterOptions({ section, filters, onChange, statuses, teamId, projectId }: {
  section: FilterSection
  filters: TicketFilters
  onChange: (f: TicketFilters) => void
  statuses: TicketStatus[]
  teamId: string | null
  projectId: string
}) {
  const t = useT()
  const [personQuery, setPersonQuery] = useState('')
  const members = useTeamMemberProfiles(teamId)
  const { user } = useAuth()
  const { data: tags = [] } = useTags(projectId)
  const row = filterRowClass

  // You first, then "unassigned", then everyone else A→Z: the two you reach for
  // most sit at the top instead of wherever the team list happens to put them.
  const filteredMembers = useMemo(() => {
    const q = personQuery.trim().toLocaleLowerCase('tr-TR')
    const list = q ? members.filter((m) => (m.full_name || m.email || '').toLocaleLowerCase('tr-TR').includes(q)) : members
    return [...list].sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', 'tr'))
  }, [members, personQuery])
  const meMember = filteredMembers.find((m) => m.id === user?.id) ?? null
  const otherMembers = filteredMembers.filter((m) => m.id !== user?.id)

  switch (section) {
    case 'assignee':
      return (
        <>
          <div className="px-3 pt-2 pb-1">
            <input
              value={personQuery}
              onChange={(e) => setPersonQuery(e.target.value)}
              placeholder={t('board.filter.searchPerson')}
              className="w-full text-sm bg-field border border-line rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-primary-500 text-fg"
            />
          </div>
          {meMember && (
            <button data-nav className={row} onClick={() => onChange({ ...filters, assignee_ids: toggleIn(filters.assignee_ids, meMember.id) })}>
              <FilterCheck on={!!filters.assignee_ids?.includes(meMember.id)} />
              <UserAvatar user={meMember} size="sm" />
              <span className="truncate">{meMember.full_name || meMember.email}</span>
              <span className="ml-auto text-xs text-fg-faint flex-shrink-0">{t('board.filter.me')}</span>
            </button>
          )}
          <button data-nav className={row} onClick={() => onChange({ ...filters, assignee_ids: toggleIn(filters.assignee_ids, UNASSIGNED) })}>
            <FilterCheck on={!!filters.assignee_ids?.includes(UNASSIGNED)} />
            <span className="w-6 h-6 rounded-full border border-dashed border-line flex items-center justify-center text-fg-faint text-2xs">?</span>
            {t('board.filter.unassigned')}
          </button>
          {otherMembers.map((m) => (
            <button data-nav key={m.id} className={row} onClick={() => onChange({ ...filters, assignee_ids: toggleIn(filters.assignee_ids, m.id) })}>
              <FilterCheck on={!!filters.assignee_ids?.includes(m.id)} />
              <UserAvatar user={m} size="sm" />
              <span className="truncate">{m.full_name || m.email}</span>
            </button>
          ))}
          {filteredMembers.length === 0 && <p className="px-3 py-2 text-xs text-fg-faint">{t('board.filter.noPeople')}</p>}
        </>
      )
    case 'tags':
      return tags.length === 0 ? <p className="px-3 py-2 text-xs text-fg-faint">{t('board.filter.noTags')}</p> : (
        <>
          {tags.map((tag) => (
            <button data-nav key={tag.id} className={row} onClick={() => onChange({ ...filters, tag_ids: toggleIn(filters.tag_ids, tag.id) })}>
              <FilterCheck on={!!filters.tag_ids?.includes(tag.id)} />
              <span className="chip-dyn border text-2xs px-2 py-0.5 rounded-full font-medium" style={{ '--c': tag.color } as React.CSSProperties}>{tag.name}</span>
            </button>
          ))}
        </>
      )
    case 'priority':
      return (
        <>
          {PRIORITIES.map((p) => (
            <button data-nav key={p.value} className={row} onClick={() => onChange({ ...filters, priority: toggleIn<TicketPriority>(filters.priority, p.value) })}>
              <FilterCheck on={!!filters.priority?.includes(p.value)} />
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
              {t(p.labelKey)}
            </button>
          ))}
        </>
      )
    case 'status':
      return (
        <>
          {statuses.map((s) => (
            <button data-nav key={s.id} className={row} onClick={() => onChange({ ...filters, status_id: toggleIn(filters.status_id, s.id) })}>
              <FilterCheck on={!!filters.status_id?.includes(s.id)} />
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
              {s.name}
            </button>
          ))}
        </>
      )
    case 'due':
      return (
        <>
          {dueOptions().map((d) => (
            <button data-nav key={d.value} className={row} onClick={() => onChange({ ...filters, due: toggleIn<DueBucket>(filters.due, d.value) })}>
              <FilterCheck on={!!filters.due?.includes(d.value)} />
              {d.value === 'overdue' && <span className="text-danger">⚠</span>}
              {d.label}
            </button>
          ))}
        </>
      )
  }
}
