import { Fragment, type ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { useMyPendingInvitations, useRespondToInvitation } from '../../hooks/useTeams'
import { ROLE_LABELS } from '../../types'
import { useT } from '../../i18n'

/**
 * Fill `{name}` placeholders with nodes instead of text, so the three things the
 * sentence is about stay bold in every language — where the words sit around
 * them differs per language, which is exactly why the sentence is one key.
 */
function fill(template: string, vars: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part)
    return <Fragment key={i}>{m ? vars[m[1]] ?? part : part}</Fragment>
  })
}

/** Invitations addressed to my e-mail — accept/decline in-app (no SMTP needed). */
export function PendingInvitationsBanner() {
  const t = useT()
  const { data: invitations = [] } = useMyPendingInvitations()
  const respond = useRespondToInvitation()
  if (invitations.length === 0) return null

  return (
    <div className="mx-5 mt-3 space-y-2">
      {invitations.map((inv) => (
        <div
          key={inv.id}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-950/40 px-4 py-2.5 animate-fade-in"
        >
          <Icon name="mail" className="text-primary-600 dark:text-primary-300" />
          <p className="text-sm text-fg flex-1 min-w-0">
            {fill(t('team.invite.banner'), {
              inviter: <span className="font-semibold">{inv.invited_by_name ?? t('team.invite.someAdmin')}</span>,
              team: <span className="font-semibold">{inv.team_name}</span>,
              role: <span className="font-medium">{t(ROLE_LABELS[inv.role])}</span>,
            })}
          </p>
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              disabled={respond.isPending}
              onClick={() => respond.mutate({ id: inv.id, accept: true })}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 font-medium"
            >
              {t('team.invite.accept')}
            </button>
            <button
              type="button"
              disabled={respond.isPending}
              onClick={() => respond.mutate({ id: inv.id, accept: false })}
              className="text-xs px-3 py-1.5 rounded-lg text-fg-muted hover:bg-raised disabled:opacity-50"
            >
              {t('team.invite.decline')}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
