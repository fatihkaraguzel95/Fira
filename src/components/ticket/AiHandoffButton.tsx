import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTeamMemberProfiles, useTeamRole } from '../../hooks/useTeams'
import { useStatuses } from '../../hooks/useStatuses'
import { useTicketAiWork, useRequestAiWork, useCancelAiWork, useAiRunPulse, isAiWorkOpen } from '../../hooks/useAiWork'
import { agentShortName, useAgents } from '../../hooks/useAgents'
import { runStalled } from '../../lib/agentStats'
import { currentUser } from '../../lib/session'
import type { Ticket } from '../../types'
import { useT } from '../../i18n'
import { Spark } from './AiSpark'
import { AiApproval } from './AiApproval'

/**
 * "Claude'a yaptır" — hands the ticket to the AI agent (a team member with
 * `is_ai`). The click records an explicit request (059) that a listener picks
 * up. Since 100 assigning the agent writes the same kind of request (unless the
 * agent's owner turned that off) and removing the assignment cancels it, so
 * this chip is the one place that shows where the work stands, whichever way it
 * started: queued → working → done / failed / stopped.
 */

export function AiHandoffButton({ ticket, teamId, canEdit }: { ticket: Ticket; teamId: string | null; canEdit: boolean }) {
  const t = useT()
  const members = useTeamMemberProfiles(teamId)
  const { data: request } = useTicketAiWork(ticket.id)
  const { data: statuses = [] } = useStatuses(ticket.project_id)
  const { data: agents = [] } = useAgents()
  const { data: myId = null } = useQuery({ queryKey: ['session-user-id'], queryFn: async () => (await currentUser())?.id ?? null, staleTime: 60_000 })
  const requestWork = useRequestAiWork()
  const cancelWork = useCancelAiWork()
  const { perms } = useTeamRole(teamId)
  const open = isAiWorkOpen(request)
  const pulse = useAiRunPulse(open && request?.status === 'processing' ? request.id : null)
  // "Not heard from" depends on the clock: look again while the chip is on screen.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!open) return
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [open])

  // A team can have several agents (105). The one on this ticket is the one already
  // working on it; otherwise the button hands to MY agent, and to the team's first only when I have none.
  const aiMembers = members.filter((m) => m.is_ai)
  const mine = agents.find((a) => !!myId && a.owner_id === myId)
  const aiUser =
    (open && aiMembers.find((m) => m.id === request?.ai_user_id)) ||
    aiMembers.find((m) => m.id === mine?.profile_id) ||
    aiMembers[0]
  if (!aiUser) return null // no AI agent on this team → nothing to offer
  const aiName = agentShortName(aiUser.full_name)

  // Handing off should also queue the ticket in the "to do" column.
  const todoStatus =
    statuses.find((s) => /yap[ıi]lacak|to.?do/i.test(s.name)) ??
    statuses.find((s) => s.category === 'active') ??
    statuses.find((s) => s.category === 'backlog') ??
    statuses[0] ?? null
  const todo = todoStatus ? { id: todoStatus.id, name: todoStatus.name } : null
  const hand = () => requestWork.mutate({ ticketId: ticket.id, aiUser, todo })

  // Open (queued/working): a live status chip with a cancel action.
  if (open && request) {
    const working = request.status === 'processing'
    // Working, but its listener went away mid-job: nobody is on it until the agent reconnects (#a47fbec8).
    const stalled = working && !!pulse && runStalled(pulse, now)
    if (stalled) {
      return (
        <div data-tour="ticket-ai" data-ai-state="stalled" className="inline-flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm" title={t('ticketExtra.ai.stalledHint', { name: aiName })}>
          <span className="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />
          <span className="font-medium text-fg">{t('ticketExtra.ai.stalled', { name: aiName })}</span>
          {canEdit && (
            <button
              onClick={() => cancelWork.mutate({ id: request.id, ticketId: ticket.id })}
              disabled={cancelWork.isPending}
              className="ml-0.5 text-xs font-medium text-fg-muted hover:text-danger transition-colors disabled:opacity-50 cursor-pointer"
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      )
    }
    // "May this go live?" (109): asked by the agent, answered here by whoever asked for the
    // work, the agent's owner or a team admin — never by the agent's own account.
    const approval = working ? request.approval ?? null : null
    const owner = agents.find((a) => a.profile_id === request.ai_user_id)?.owner_id ?? null
    const canDecide = !!myId && myId !== request.ai_user_id && (myId === request.requested_by || myId === owner || perms.canManage)
    const decider = approval?.decided_by ? members.find((m) => m.id === approval.decided_by) : null
    return (
      <div className="space-y-2">
      <div data-tour="ticket-ai" data-ai-state={working ? 'working' : 'queued'} className="inline-flex items-center gap-2 rounded-lg border border-primary-300 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-950/30 px-3 py-1.5 text-sm">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className={`absolute inline-flex h-full w-full rounded-full bg-primary-500 ${working ? 'animate-ping opacity-75' : 'opacity-40'}`} />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-600" />
        </span>
        <span className="font-medium text-primary-700 dark:text-primary-300">
          {working ? t('ticketExtra.ai.working', { name: aiName }) : t('ticketExtra.ai.queued', { name: aiName })}
        </span>
        {/* What it is doing right now, when the agent says so ("test", "QA"). */}
        {working && pulse?.step && <span data-ai-step className="max-w-[14rem] truncate text-xs text-fg-muted">{pulse.step}</span>}
        {canEdit && (
          <button
            onClick={() => cancelWork.mutate({ id: request.id, ticketId: ticket.id })}
            disabled={cancelWork.isPending}
            className="ml-0.5 text-xs font-medium text-fg-faint hover:text-danger transition-colors disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
      {approval && (
        <AiApproval approval={approval} requestId={request.id} ticketId={ticket.id} aiName={aiName} canDecide={canDecide} deciderName={decider ? decider.full_name || decider.email || null : null} />
      )}
      </div>
    )
  }

  if (!canEdit) return null

  const failed = request?.status === 'failed'
  const done = request?.status === 'done'
  const stopped = request?.status === 'cancelled'

  // Idle / done / failed: offer to (re)hand it off.
  return (
    <div data-tour="ticket-ai" className="inline-flex items-center gap-2">
      <button
        onClick={hand}
        disabled={requestWork.isPending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-primary-300 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-950/20 px-3 py-1.5 text-sm font-medium text-primary-700 dark:text-primary-300 hover:bg-primary-100/70 dark:hover:bg-primary-900/30 transition-colors disabled:opacity-50 cursor-pointer"
        title={t('ticketExtra.ai.handoffTitle', { name: aiName })}
      >
        <Spark />
        {requestWork.isPending
          ? t('ticketExtra.ai.sending')
          : done
            ? t('ticketExtra.ai.again', { name: aiName })
            : failed
              ? t('ticketExtra.ai.retry', { name: aiName })
              : t('ticketExtra.ai.hand', { name: aiName })}
      </button>
      {done && <span className="text-xs text-success">✓ {t('ticketExtra.ai.done', { name: aiName })}</span>}
      {stopped && <span data-ai-stopped className="text-xs text-fg-muted" title={request?.detail ?? undefined}>{t('ticketExtra.ai.stopped', { name: aiName })}</span>}
      {failed && (
        <span className="text-xs text-danger" title={request?.detail ?? undefined}>
          {request?.detail
            ? t('ticketExtra.ai.failedWithReason', { name: aiName })
            : t('ticketExtra.ai.failed', { name: aiName })}
        </span>
      )}
    </div>
  )
}
