import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { usePopupLayer } from '../../lib/popups'
import { createPortal } from 'react-dom'
import type { Profile } from '../../types'
import { useAddAssignee, useRemoveAssignee } from '../../hooks/useTicketAssignees'
import { useTeamMemberProfiles } from '../../hooks/useTeams'
import { useAgents, agentShortName } from '../../hooks/useAgents'
import { useTicketAiWork, isAiWorkOpen } from '../../hooks/useAiWork'
import { UserAvatar } from './UserAvatar'
import { Spark } from './AiSpark'
import { markHandled } from '../../lib/keys'
import { useT } from '../../i18n'

interface Props {
  ticketId: string
  assignees: Profile[]
  teamId: string | null
  /** Element the popover is anchored to. */
  anchor: HTMLElement
  onClose: () => void
  canEdit?: boolean
}

const WIDTH = 288
const MAX_H = 380

/** MS Planner-like people picker: search, "Atanmış" with remove, "Öneriler" below. */
export function AssigneePopover({ ticketId, assignees, teamId, anchor, onClose, canEdit = true }: Props) {
  const t = useT()
  const members = useTeamMemberProfiles(teamId)
  const add = useAddAssignee()
  const remove = useRemoveAssignee()
  // Agents (100): assigning one starts its work, removing it stops the work —
  // said on the row, because here the click is the whole hand-off.
  const { data: agents = [] } = useAgents()
  const { data: aiWork } = useTicketAiWork(ticketId)
  const startsWork = (id: string) => agents.some((a) => a.profile_id === id && a.assign_trigger)
  const worksOn = (id: string) => isAiWorkOpen(aiWork) && aiWork?.ai_user_id === id
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; maxH: number }>({ top: 0, left: 0, maxH: MAX_H })
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const vw = window.innerWidth, vh = window.innerHeight
      let left = Math.min(r.left, vw - WIDTH - 8)
      if (left < 8) left = 8
      const below = vh - r.bottom - 8
      const above = r.top - 8
      if (below >= Math.min(MAX_H, 240) || below >= above) {
        setPos({ top: r.bottom + 6, left, maxH: Math.min(MAX_H, below) })
      } else {
        // Yukarı açılırken kutu **alt kenarından** bağlanır: üstü izin verilen en
        // büyük yükseklikten hesaplamak, içerik kısayken kutuyu hücreden yarım ekran
        // yukarıda bırakıyordu (#c8bb1e3b, ekran kaydı).
        setPos({ bottom: vh - r.top + 6, left, maxH: Math.min(MAX_H, above) })
      }
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [anchor])

  usePopupLayer(true, ref, onClose, anchor)
  useEffect(() => {
    inputRef.current?.focus()
    const onDoc = (e: MouseEvent) => {
      const node = e.target as Node
      if (ref.current && !ref.current.contains(node) && !anchor.contains(node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { markHandled(e); e.stopPropagation(); e.preventDefault(); onClose() }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true) }
  }, [anchor, onClose])

  const assignedIds = useMemo(() => new Set(assignees.map((a) => a.id)), [assignees])
  const norm = (s: string) => s.toLocaleLowerCase('tr-TR')
  const query = norm(q.trim())
  const matches = (p: Profile) => !query || norm(p.full_name || '').includes(query) || norm(p.email || '').includes(query)
  const assigned = assignees.filter(matches)
  const suggestions = members.filter((m) => !assignedIds.has(m.id) && matches(m))

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const row = 'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-fg hover:bg-raised text-left rounded-lg'

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={t('ticketExtra.assignee.assignees')}
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: WIDTH, maxHeight: pos.maxH }}
      className="fixed z-[150] flex flex-col bg-surface border border-line rounded-xl shadow-lg animate-fade-in overflow-hidden"
      onClick={stop}
      onMouseDown={stop}
      onPointerDown={stop}
      onContextMenu={stop}
    >
      <div className="p-2 border-b border-line-soft">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              ;(e.currentTarget.closest('[role="dialog"]')?.querySelector('[data-list] button') as HTMLElement | null)?.focus()
              return
            }
            if (e.key === 'Enter' && canEdit && suggestions.length === 1) {
              add.mutate({ ticketId, userId: suggestions[0].id, user: suggestions[0] }); setQ('')
            }
          }}
          placeholder={t('ticketExtra.assignee.searchPlaceholder')}
          className="w-full text-sm bg-field border border-line rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary-500 text-fg"
        />
      </div>

      <div
        data-list
        className="flex-1 overflow-auto p-1.5"
        // ↑/↓ walk the people; ↑ on the first goes back to the search box.
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button'))
          const i = items.indexOf(document.activeElement as HTMLElement)
          e.preventDefault()
          if (e.key === 'ArrowUp' && i <= 0) { inputRef.current?.focus(); return }
          items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
        }}
      >
        {assigned.length > 0 && (
          <>
            <p className="px-3 pt-1 pb-1 text-xs font-semibold text-fg-muted">{t('ticketExtra.assignee.assigned')}</p>
            {assigned.map((u) => (
              <div key={u.id} className={`${row} cursor-default`}>
                <UserAvatar user={u} size="sm" />
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{u.full_name || u.email}</span>
                  {worksOn(u.id) && (
                    <span data-agent-working className="flex items-center gap-1 text-xs text-primary-700 dark:text-primary-300">
                      <Spark className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{t(aiWork?.status === 'processing' ? 'ticketExtra.ai.working' : 'ticketExtra.ai.queued', { name: agentShortName(u.full_name) })}</span>
                    </span>
                  )}
                </span>
                {canEdit && (
                  <button
                    onClick={() => remove.mutate({ ticketId, userId: u.id })}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-fg-faint hover:text-danger hover:bg-raised"
                    title={worksOn(u.id) ? t('ticketExtra.assignee.unassignStops', { name: agentShortName(u.full_name) }) : t('ticketExtra.assignee.unassign')}
                    aria-label={t('ticketExtra.assignee.unassignName', { name: u.full_name || u.email || '' })}
                  >
                    <Icon name="close" />
                  </button>
                )}
              </div>
            ))}
          </>
        )}

        {canEdit && (
          <>
            <p className="px-3 pt-2 pb-1 text-xs font-semibold text-fg-muted">{t('ticketExtra.assignee.suggestions')}</p>
            {suggestions.map((u) => (
              <button key={u.id} className={row} onClick={() => { add.mutate({ ticketId, userId: u.id, user: u }); setQ('') }}>
                <UserAvatar user={u} size="sm" />
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{u.full_name || u.email}</span>
                  {startsWork(u.id) && (
                    <span data-agent-hint className="flex items-center gap-1 text-xs text-fg-muted">
                      <Spark className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{t('ticketExtra.assignee.startsWork')}</span>
                    </span>
                  )}
                </span>
              </button>
            ))}
            {suggestions.length === 0 && (
              <p className="px-3 py-2 text-xs text-fg-faint">{members.length === 0 ? t('ticketExtra.assignee.loadingMembers') : t('ticketExtra.assignee.noMatch')}</p>
            )}
          </>
        )}
        {!canEdit && assigned.length === 0 && <p className="px-3 py-2 text-xs text-fg-faint">{t('ticketExtra.assignee.noneAssigned')}</p>}
      </div>
    </div>,
    document.body,
  )
}
