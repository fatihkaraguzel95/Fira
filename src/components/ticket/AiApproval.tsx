import { useState } from 'react'
import type { AiApprovalState } from '../../types'
import { useDecideApproval } from '../../hooks/useAiPolicy'
import { displayTime, exactTime } from '../../lib/time'
import { useT } from '../../i18n'

/**
 * "May this go live?" on the ticket (109, #5621fce5). The agent says what would
 * go live and waits; whoever asked for the work, the agent's owner or a team
 * admin answers here. The server checks who may answer — `canDecide` only
 * decides whether the buttons are drawn.
 */
export function AiApproval({ approval, requestId, ticketId, aiName, canDecide, deciderName }: {
  approval: AiApprovalState
  requestId: string
  ticketId: string
  aiName: string
  canDecide: boolean
  /** Who answered, when it is answered. */
  deciderName: string | null
}) {
  const t = useT()
  const decide = useDecideApproval()
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')

  if (approval.status !== 'pending') {
    const ok = approval.status === 'approved'
    return (
      <p data-ai-approval={approval.status} className="text-xs text-fg-muted">
        <span className={`font-medium ${ok ? 'text-success' : 'text-danger'}`}>{t(ok ? 'ticketExtra.ai.approval.approved' : 'ticketExtra.ai.approval.rejected')}</span>
        {deciderName ? ` · ${deciderName}` : ''}
        {approval.decided_at && <span title={exactTime(approval.decided_at)}> · {displayTime(approval.decided_at)}</span>}
        {!ok && approval.note ? ` · ${approval.note}` : ''}
      </p>
    )
  }

  return (
    <div data-ai-approval="pending" className="max-w-xl rounded-xl border border-warning/40 bg-warning/10 p-3 space-y-2">
      <p className="text-sm font-semibold text-fg">{t('ticketExtra.ai.approval.pending')}</p>
      <p className="text-xs text-fg-muted">{t('ticketExtra.ai.approval.asks', { name: aiName })}</p>
      <p className="text-sm text-fg whitespace-pre-wrap break-words">{approval.summary}</p>
      {!canDecide ? (
        <p className="text-xs text-fg-muted">{t('ticketExtra.ai.approval.who')}</p>
      ) : rejecting ? (
        <div className="space-y-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 1000))}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setRejecting(false) } }}
            placeholder={t('ticketExtra.ai.approval.notePlaceholder')}
            aria-label={t('ticketExtra.ai.approval.notePlaceholder')}
            autoFocus
            className="w-full bg-field border border-line rounded-lg px-3 py-1.5 text-sm text-fg placeholder:text-fg-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
          <div className="flex items-center gap-2">
            <button type="button" data-ai-approval-reject-confirm onClick={() => decide.mutate({ requestId, ticketId, approve: false, note })} disabled={decide.isPending} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-danger text-white disabled:opacity-50 cursor-pointer">{t('ticketExtra.ai.approval.reject')}</button>
            <button type="button" onClick={() => setRejecting(false)} className="px-2 py-1.5 text-xs text-fg-muted hover:text-fg cursor-pointer">{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button type="button" data-ai-approval-approve onClick={() => decide.mutate({ requestId, ticketId, approve: true })} disabled={decide.isPending} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 cursor-pointer">{t('ticketExtra.ai.approval.approve')}</button>
          <button type="button" data-ai-approval-reject onClick={() => setRejecting(true)} disabled={decide.isPending} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-line text-fg-2 hover:bg-raised disabled:opacity-50 cursor-pointer">{t('ticketExtra.ai.approval.reject')}</button>
        </div>
      )}
    </div>
  )
}
