import { useState } from 'react'
import { Icon } from '../ui/Icon'
import type { Ticket, TicketStatus, UpdateTicketInput, TicketActivity } from '../../types'
import { isCompleteStatus } from '../../types'
import { useTicketDeadlines, useAddDeadline, useDeleteDeadline } from '../../hooks/useTicketDeadlines'
import { useRemoveAssignee } from '../../hooks/useTicketAssignees'
import { useIncomingLinks } from '../../hooks/useLinks'
import { celebrateTicket } from '../../lib/celebrate'
import { PrioritySelect, PriorityFlagBadge } from './PriorityPicker'
import { StatusButton } from './StatusPicker'
import { TagSelector } from './TagSelector'
import { AssigneePopover } from './AssigneePopover'
import { DateInput } from '../ui/DateInput'
import { UserAvatar } from './UserAvatar'
import { useT, useLang } from '../../i18n'
import { useTicketRecurrence, useRecurrenceOccurrences, useSetRecurrence, useClearRecurrence } from '../../hooks/useRecurrence'
import { ruleOf } from '../../lib/recurrence'
import { RecurrenceDialog, describeRule } from './RecurrenceDialog'
import { displayTime, displayDate, exactTime, useDateFormat } from '../../lib/time'

/**
 * The ticket's properties — status, priority, assignees, tags, dates and the
 * created/completed/updated stamps — as a self-contained FRAGMENT. Both the
 * full-screen and the popup views compose this same fragment, so a new field
 * (an effort estimate, a worklog, a Pomodoro timer…) is added here once and
 * shows up in every view. Its own small bits of state (the assignee popover,
 * the "add a deadline" form, the finish-with-open-blockers prompt) live here.
 *
 * Layout: two INDEPENDENT columns (left: status → priority → tags, right: due
 * date → assignees) rather than a row-major grid, so a field that grows to two
 * lines never pushes the other side around. The who/when stamps run full width
 * underneath, stacked.
 */
const PropRow = ({ label, children, celebrateOrigin }: { label: string; children: React.ReactNode; celebrateOrigin?: boolean }) => (
  <div className="flex items-start gap-3" {...(celebrateOrigin ? { 'data-celebrate-origin': '' } : {})}>
    <span className="w-[92px] flex-shrink-0 pt-1.5 text-xs font-semibold text-fg-faint uppercase tracking-wider">{label}</span>
    <div className="flex-1 min-w-0">{children}</div>
  </div>
)

interface Props {
  ticket: Ticket
  statuses: TicketStatus[]
  canEdit: boolean
  teamId: string | null
  ticketProjectId: string | null
  onUpdate: (input: UpdateTicketInput) => void
  completed: TicketActivity | null
}

export function TicketProperties({ ticket, statuses, canEdit, teamId, ticketProjectId, onUpdate, completed }: Props) {
  const t = useT()
  const lang = useLang()
  useDateFormat()   // repaint when the chosen date format changes
  const [assigneeAnchor, setAssigneeAnchor] = useState<HTMLElement | null>(null)
  const [pendingDone, setPendingDone] = useState<TicketStatus | null>(null)
  const [addingDeadline, setAddingDeadline] = useState(false)
  const [recurOpen, setRecurOpen] = useState(false)
  const [dlDate, setDlDate] = useState('')
  const [dlDesc, setDlDesc] = useState('')

  // Tekrar (#59e0b75e): görev ya serinin şablonudur ya da seriden doğmuştur.
  const { data: series } = useTicketRecurrence(ticket.id, ticket.recurrence_id ?? null)
  const { data: occurrences = [] } = useRecurrenceOccurrences(series?.id ?? null)
  const setRecurrence = useSetRecurrence()
  const clearRecurrence = useClearRecurrence()
  const isTemplate = !!series && series.template_ticket_id === ticket.id
  const missed = occurrences.filter((o) => o.outcome === 'missed').length

  const { data: deadlines = [] } = useTicketDeadlines(ticket.id)
  const addDeadline = useAddDeadline()
  const deleteDeadline = useDeleteDeadline()
  const removeAssignee = useRemoveAssignee()
  const { data: incomingLinks = [] } = useIncomingLinks(ticket.id)
  const openBlockerTitles = incomingLinks.filter((l) => l.kind === 'blocks' && l.source && !isCompleteStatus(l.source.status_info as never)).map((l) => l.source!.title)

  const assignees = ticket.assignees?.map((a) => a.user) ?? []
  const tags = ticket.tags?.map((rel) => rel.tag) ?? []

  // Status changes from any control (picker, next-step, mark-done) go through here,
  // so the open-blocker question and the celebration stay in one place.
  const applyStatus = (s: TicketStatus) => {
    if (isCompleteStatus(s) && !isCompleteStatus(ticket.status_info) && openBlockerTitles.length > 0 && pendingDone?.id !== s.id) {
      setPendingDone(s)
      return
    }
    setPendingDone(null)
    if (s.id === ticket.status_id) return
    onUpdate({ status_id: s.id, status: s.name })
    if (isCompleteStatus(s) && !isCompleteStatus(ticket.status_info)) celebrate(s)
  }
  // "Next" is simply the next column of the board, left to right (#CFF4ADB3): no
  // separate workflow — the leftmost column is the earliest, the rightmost the latest.
  const statusIdx = statuses.findIndex((s) => s.id === ticket.status_id)
  const nextStatus = statusIdx >= 0 && statusIdx < statuses.length - 1 ? statuses[statusIdx + 1] : null
  const doneStatus = statuses.find((s) => s.category === 'done') ?? statuses.find((s) => s.category === 'closed' && !s.is_cancelled) ?? null
  // When the next column *is* the done one, › and ✓ do the same thing: only ✓ is shown (#CFF4ADB3, 18 Sep).
  const showComplete = !!doneStatus && !isCompleteStatus(ticket.status_info)
  const showNext = !(showComplete && nextStatus?.id === doneStatus?.id)
  const celebrate = (s: TicketStatus) => {
    const origins = Array.from(document.querySelectorAll<HTMLElement>('[data-celebrate-origin]'))
    celebrateTicket(ticket.id, s.color, origins.find((o) => o.getBoundingClientRect().width > 0) ?? origins[0])
  }

  const handleAddDeadline = async () => {
    if (!dlDate) return
    await addDeadline.mutateAsync({ ticketId: ticket.id, date: dlDate, description: dlDesc })
    setDlDate(''); setDlDesc(''); setAddingDeadline(false)
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 items-start gap-x-8 gap-y-4">
        {/* ── Left column: status → priority → tags ── */}
        <div className="space-y-4 min-w-0">
          <PropRow label={t('ticket.prop.status')} celebrateOrigin>
            <div className="flex items-center gap-1.5 flex-wrap">
              <StatusButton
                status={ticket.status_info}
                statuses={statuses}
                disabled={!canEdit}
                onChange={applyStatus}
              />
              {canEdit && (
                <>
                  {/* One click forward (#CFF4ADB3): the next column of the board, left to right. */}
                  {showNext && (
                  <button
                    type="button"
                    disabled={!nextStatus}
                    onClick={() => nextStatus && applyStatus(nextStatus)}
                    title={nextStatus ? `${t('ticketExtra.status.next')}: ${nextStatus.name}` : t('ticketExtra.status.lastStep')}
                    aria-label={nextStatus ? `${t('ticketExtra.status.next')}: ${nextStatus.name}` : t('ticketExtra.status.lastStep')}
                    data-status-next
                    data-shortcut="ticket-next"
                    className="w-[30px] h-[30px] inline-flex items-center justify-center rounded-lg border border-line text-fg-2 hover:bg-raised hover:text-fg disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    <Icon name="chevronRight" />
                  </button>
                  )}
                  {showComplete && doneStatus && (
                    <button
                      type="button"
                      onClick={() => applyStatus(doneStatus)}
                      title={t('ticketExtra.status.markDone')}
                      aria-label={t('ticketExtra.status.markDone')}
                      data-shortcut="ticket-done"
                      className="w-[30px] h-[30px] inline-flex items-center justify-center rounded-lg border border-line text-fg-2 hover:bg-success hover:border-success hover:text-white transition-colors cursor-pointer"
                    >
                      <Icon name="check" />
                    </button>
                  )}
                </>
              )}
            </div>
            {pendingDone && (
              <div className="mt-2 rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs space-y-1.5 animate-fade-in">
                <p className="text-fg-2">
                  <span className="font-semibold text-danger">
                    {openBlockerTitles.length === 1
                      ? t('ticket.blockers.warningOne')
                      : t('ticket.blockers.warning', { n: openBlockerTitles.length })}
                  </span>: {openBlockerTitles.slice(0, 3).join(', ')}{openBlockerTitles.length > 3 ? '…' : ''}
                </p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => { const s = pendingDone; setPendingDone(null); onUpdate({ status_id: s.id, status: s.name }); celebrate(s) }}
                    className="px-2 py-1 rounded-md bg-danger text-white font-semibold hover:opacity-90"
                  >
                    {t('ticket.blockers.completeAnyway')}
                  </button>
                  <button onClick={() => setPendingDone(null)} className="px-2 py-1 rounded-md text-fg-muted hover:bg-raised">{t('common.giveUp')}</button>
                </div>
              </div>
            )}
          </PropRow>

          <PropRow label={t('ticket.prop.priority')}>
            {canEdit ? (
              <PrioritySelect value={ticket.priority} onChange={(p) => onUpdate({ priority: p })} />
            ) : (
              <PriorityFlagBadge priority={ticket.priority} size="md" showMedium />
            )}
          </PropRow>

          {ticketProjectId && (
            <PropRow label={t('ticket.prop.tags')}>
              <TagSelector ticketId={ticket.id} projectId={ticketProjectId} assignedTags={tags} />
            </PropRow>
          )}
        </div>

        {/* ── Right column: due date → assignees ── */}
        <div className="space-y-4 min-w-0">
          <PropRow label={t('ticket.prop.dueDate')}>
            {canEdit ? (
              <DateInput
                aria-label={t('ticket.prop.dueDate')}
                value={ticket.due_date?.slice(0, 10) ?? ''}
                onChange={(v) => onUpdate({ due_date: v })}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-field text-fg"
              />
            ) : ticket.due_date ? (
              <span className="text-sm text-fg-2">{displayDate(ticket.due_date)}</span>
            ) : (
              <span className="text-sm text-fg-faint">—</span>
            )}

            {deadlines.length > 0 && (
              <ul className="mt-3 space-y-2">
                {deadlines.map(dl => (
                  <li key={dl.id} className="group flex items-start gap-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-fg-2">{displayDate(dl.date)}</p>
                      {dl.description && <p className="text-xs text-fg-faint truncate">{dl.description}</p>}
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => deleteDeadline.mutate({ id: dl.id, ticketId: ticket.id })}
                        className="opacity-0 group-hover:opacity-100 text-fg-faint hover:text-danger text-xs transition-opacity flex-shrink-0 mt-0.5"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* Only offer an extra deadline once a due date exists */}
            {canEdit && !addingDeadline && ticket.due_date && (
              <button onClick={() => setAddingDeadline(true)} className="mt-1 inline-flex items-center min-h-6 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 hover:underline font-medium">
                {t('ticket.deadline.add')}
              </button>
            )}
            {canEdit && addingDeadline && (
              <div className="mt-2 space-y-1.5">
                <input type="date" value={dlDate} onChange={e => setDlDate(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 bg-field text-fg" />
                <input type="text" value={dlDesc} onChange={e => setDlDesc(e.target.value)} placeholder={t('ticket.deadline.descPlaceholder')} className="w-full border border-line rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 bg-field text-fg" />
                <div className="flex gap-1.5">
                  <button onClick={handleAddDeadline} disabled={!dlDate || addDeadline.isPending} className="flex-1 text-xs bg-primary-600 text-white px-2 py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors font-medium">{t('common.add')}</button>
                  <button onClick={() => { setAddingDeadline(false); setDlDate(''); setDlDesc('') }} className="text-xs text-fg-faint hover:text-slate-600 px-2 py-2 rounded-lg hover:bg-raised transition-colors">{t('common.cancel')}</button>
                </div>
              </div>
            )}
          </PropRow>

          <PropRow label={t('ticket.prop.recurrence')}>
            {series && series.active ? (
              <div className="space-y-1">
                <p className="text-sm text-fg-2">{describeRule(ruleOf(series), lang, t as never)}</p>
                <p className="text-xs text-fg-faint">
                  {isTemplate
                    ? t('ticket.recur.isTemplate')
                    : t('ticket.recur.occurrenceNo', { n: ticket.occurrence_no ?? 1 })}
                  {missed > 0 && ` · ${t('ticket.recur.missedCount', { n: missed })}`}
                </p>
                {canEdit && (
                  <button onClick={() => setRecurOpen(true)} className="text-xs text-primary-600 dark:text-primary-400 hover:underline font-medium">
                    {isTemplate ? t('ticket.recur.edit') : t('ticket.recur.openSeries')}
                  </button>
                )}
              </div>
            ) : canEdit && !ticket.parent_id ? (
              <button onClick={() => setRecurOpen(true)} className="inline-flex items-center min-h-6 text-sm text-primary-600 dark:text-primary-400 hover:underline font-medium" data-recur-open>
                {series ? t('ticket.recur.restart') : t('ticket.recur.add')}
              </button>
            ) : (
              <span className="text-sm text-fg-faint">—</span>
            )}
          </PropRow>

          <PropRow label={t('ticket.prop.assignees')}>
            <div className="space-y-0.5">
              {assignees.map((u) => (
                <div key={u.id} className="group/assignee flex items-center gap-1 -mx-1.5">
                  <button
                    type="button"
                    onClick={(e) => setAssigneeAnchor(e.currentTarget)}
                    className="flex-1 min-w-0 flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-raised text-left"
                    title={t('ticket.assignee.edit')}
                  >
                    <UserAvatar user={u} size="sm" showName />
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeAssignee.mutate({ ticketId: ticket.id, userId: u.id })}
                      title={t('ticket.assignee.remove')}
                      aria-label={t('ticket.assignee.removeNamed', { name: u.full_name || u.email || t('ticket.person') })}
                      className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md text-fg-faint hover:text-danger hover:bg-danger/10 opacity-0 group-hover/assignee:opacity-100 focus-visible:opacity-100 transition-opacity"
                    >
                      <Icon name="close" />
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <button
                  type="button"
                  onClick={(e) => setAssigneeAnchor(e.currentTarget)}
                  className="flex items-center gap-2 px-1.5 py-1 -mx-1.5 rounded-lg text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-raised"
                >
                  <span className="w-6 h-6 rounded-full border border-dashed border-primary-400 flex items-center justify-center">
                    <Icon name="plus" />
                  </span>
                  {t('ticket.assignee.add')}
                </button>
              )}
              {!canEdit && assignees.length === 0 && <p className="text-xs text-fg-faint">{t('ticket.assignee.none')}</p>}
            </div>
            {assigneeAnchor && (
              <AssigneePopover
                ticketId={ticket.id}
                assignees={assignees}
                teamId={teamId ?? null}
                anchor={assigneeAnchor}
                onClose={() => setAssigneeAnchor(null)}
                canEdit={canEdit}
              />
            )}
          </PropRow>
        </div>
      </div>

      {/* Created / last-modified moved out: they read as a line under the title
          (like Microsoft To Do) rather than as form fields — see TicketModal. */}
      <div className="mt-4 space-y-4">
        {completed && (
          <PropRow label={t('ticket.prop.completed')}>
            <div className="flex items-start gap-2">
              {completed.actor ? <UserAvatar user={completed.actor} size="sm" /> : null}
              <div className="min-w-0">
                <p className="text-xs font-medium text-fg-2 truncate">{completed.actor?.full_name || completed.actor?.email || (completed.meta?.by_name as string) || '—'}</p>
                <p className="text-xs text-fg-faint mt-0.5" title={exactTime(completed.created_at)}>{displayTime(completed.created_at)}</p>
              </div>
            </div>
          </PropRow>
        )}
      </div>

      {recurOpen && (
        <RecurrenceDialog
          title={ticket.title || t('ticket.untitled')}
          rule={series ? ruleOf(series) : null}
          canClear={!!series?.active && isTemplate}
          saving={setRecurrence.isPending || clearRecurrence.isPending}
          onSave={(rule) => {
            // Seri şablonu her zaman ilk görevdir: bir tekrardan açıldıysa kural ona yazılır.
            const target = series?.template_ticket_id ?? ticket.id
            setRecurrence.mutate({ ticketId: target, rule }, { onSuccess: () => setRecurOpen(false) })
          }}
          onClear={() => clearRecurrence.mutate(series?.template_ticket_id ?? ticket.id, { onSuccess: () => setRecurOpen(false) })}
          onClose={() => setRecurOpen(false)}
        />
      )}
    </>
  )
}
