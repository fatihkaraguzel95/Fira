import { useNavigate } from 'react-router-dom'
import { openTicket } from '../../lib/nav'
import { useT, useLang } from '../../i18n'
import { useProjectRecurrences, useClearRecurrence, useSetRecurrence } from '../../hooks/useRecurrence'
import { ruleOf } from '../../lib/recurrence'
import { describeRule } from '../ticket/RecurrenceDialog'

/**
 * Listenin tekrarlayan görevleri (#59e0b75e, TK-4) — liste ayarları penceresinde.
 * Linear'ın takım ayarlarındaki ekranının karşılığı: kural, sıradaki tekrar,
 * durdur/başlat ve şablon göreve gidiş. Kural düzenleme görevin kendi
 * penceresinde (tek giriş noktası orası kalsın).
 */
export function RecurrenceSection({ projectId, canWrite, onNavigate }: { projectId: string; canWrite: boolean; onNavigate?: () => void }) {
  const t = useT()
  const lang = useLang()
  const navigate = useNavigate()
  const { data: series = [], isLoading } = useProjectRecurrences(projectId)
  const clear = useClearRecurrence()
  const setRecurrence = useSetRecurrence()

  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

  if (isLoading) return <p className="text-xs text-fg-faint">{t('common.loading')}</p>
  if (!series.length) return <p className="text-xs text-fg-faint">{t('team.list.recurNone')}</p>

  return (
    <ul className="space-y-1.5" data-recur-list>
      {series.map((r) => (
        <li key={r.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-raised">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => { onNavigate?.(); openTicket(navigate, r.template_ticket_id) }}
              className="text-sm text-fg text-left truncate hover:text-primary-600 dark:hover:text-primary-400 cursor-pointer max-w-full"
            >
              {r.template?.title || t('ticket.untitled')}
            </button>
            <p className="text-xs text-fg-muted truncate">
              {describeRule(ruleOf(r), lang, t as never)}
              {r.active
                ? ` · ${t('team.list.recurNext', { when: fmt.format(new Date(r.next_at)) })}`
                : ` · ${t('team.list.recurPaused')}`}
            </p>
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={() => r.active
                ? clear.mutate(r.template_ticket_id)
                : setRecurrence.mutate({ ticketId: r.template_ticket_id, rule: ruleOf(r) })}
              disabled={clear.isPending || setRecurrence.isPending}
              className="text-xs px-2 h-7 rounded-md text-fg-2 hover:bg-line/60 flex-shrink-0 disabled:opacity-50"
            >
              {r.active ? t('team.list.recurPause') : t('team.list.recurResume')}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
