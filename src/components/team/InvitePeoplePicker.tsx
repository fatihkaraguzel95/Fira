import { useState } from 'react'
import { useInviteCandidates, useInviteUsers } from '../../hooks/useTeams'
import type { InvitableRole } from '../../types'
import { UserAvatar } from '../ticket/UserAvatar'
import { LoadingLine } from '../ui/Spinner'
import { useT } from '../../i18n'

/**
 * Invite people who already use Fira, several at a time (#4B5442B6): search,
 * tick the ones you mean, pick a role, send. Each invitation lands in that
 * person's inbox — no link to copy and paste into another channel — and until
 * they accept they are listed here as "davet edildi".
 *
 * Profiles are not public (052), so the candidate list comes from an RPC that
 * only a team admin may call and that never shows people already in the team.
 */
export function InvitePeoplePicker({ teamId, role, disabled }: { teamId: string; role: InvitableRole; disabled?: boolean }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<string | null>(null)
  const { data: people = [], isPending } = useInviteCandidates(teamId, query, !disabled)
  const invite = useInviteUsers()

  const toggle = (id: string) => {
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setMsg(null)
  }

  const send = async () => {
    const ids = [...picked]
    if (!ids.length) return
    const r = await invite.mutateAsync({ teamId, userIds: ids, role })
    setPicked(new Set())
    setMsg(t('team.invitePeople.sent', { n: r.invited }) + (r.skipped ? ` · ${t('team.invitePeople.skipped', { n: r.skipped })}` : ''))
  }

  if (disabled) return null

  return (
    <div className="rounded-xl border border-line bg-raised/50 p-4 space-y-2">
      <p className="text-xs font-semibold text-fg-muted uppercase tracking-wider">{t('team.invitePeople.title')}</p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('team.invitePeople.search')}
        className="w-full bg-field border border-line rounded-lg px-3 py-2 text-sm text-fg placeholder:text-fg-faint"
      />
      <div className="max-h-56 overflow-y-auto scrollbar-thin rounded-lg border border-line bg-surface divide-y divide-line-soft">
        {isPending ? (
          <p className="px-3 py-2 text-xs"><LoadingLine text={t('common.loading')} /></p>
        ) : people.length === 0 ? (
          <p className="px-3 py-3 text-xs text-fg-faint">{query ? t('team.invitePeople.noMatch') : t('team.invitePeople.empty')}</p>
        ) : (
          people.map((p) => (
            <label
              key={p.id}
              className={`flex items-center gap-2.5 px-3 py-2 text-sm ${p.invited ? 'opacity-60' : 'cursor-pointer hover:bg-raised/60'}`}
            >
              <input
                type="checkbox"
                checked={picked.has(p.id)}
                disabled={p.invited}
                onChange={() => toggle(p.id)}
                className="w-4 h-4 flex-shrink-0"
              />
              <UserAvatar user={{ id: p.id, full_name: p.full_name, email: p.email, avatar_url: p.avatar_url } as never} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block text-fg truncate">{p.full_name || p.email}</span>
                {p.full_name && <span className="block text-xs text-fg-faint truncate">{p.email}</span>}
              </span>
              {p.invited && <span className="text-2xs px-2 py-0.5 rounded-full bg-warning/15 text-warning font-medium flex-shrink-0">{t('team.invitePeople.invited')}</span>}
            </label>
          ))
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={send}
          disabled={!picked.size || invite.isPending}
          className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          {picked.size ? t('team.invitePeople.sendN', { n: picked.size }) : t('team.invitePeople.send')}
        </button>
        {msg && <span className="text-xs text-success">{msg}</span>}
        {invite.error && <span className="text-xs text-danger">{(invite.error as Error).message}</span>}
      </div>
      <p className="text-xs text-fg-faint">{t('team.invitePeople.hint')}</p>
    </div>
  )
}
