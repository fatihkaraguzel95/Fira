import { useRef, FormEvent, Suspense, lazy, useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { InvitePeoplePicker } from './InvitePeoplePicker'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { displayTime, useDateFormat } from '../../lib/time'
import {
  useTeamMembers, useUpdateMemberRole, useRemoveMember, useAddMemberByEmail,
  useTeamInvitations, useCreateInvitation, useRevokeInvitation, invitationLink,
  useUpdateTeam, useDeleteTeam, useTeamRole,
} from '../../hooks/useTeams'
import { useTeamColors, useCreateTeamColor, useUpdateTeamColor, useDeleteTeamColor, COLOR_SWATCHES } from '../../hooks/useTeamColors'
import { useAuth } from '../../hooks/useAuth'
import type { Team, InvitableRole, TeamRole } from '../../types'
import { ROLE_LABELS, ROLE_DESCRIPTIONS } from '../../types'
import { UserAvatar } from '../ticket/UserAvatar'
/**
 * Loaded on demand: the backup tab pulls in xlsx, jszip and papaparse — hundreds
 * of kilobytes that every cold load of the board was paying for, to serve a
 * screen most people open a few times a year (#B98717D4).
 */
const BackupTab = lazy(() => import('./BackupTab').then((m) => ({ default: m.BackupTab })))
/** Same reason, bigger: the OneNote converter is ~1.5 MB of WebAssembly (#AAC9D463). */
const OneNoteImportTab = lazy(() => import('./OneNoteImportTab').then((m) => ({ default: m.OneNoteImportTab })))
import { useTransferOwnership } from '../../hooks/useTeams'
import { useAgents } from '../../hooks/useAgents'
import { TrashTab } from './TrashTab'
import { blurAfterEscape, isEditableTarget } from '../../lib/keys'
import { AgentRulesTab } from './AgentRulesTab'
// `t` is taken by the tab/member loops in this file, so the hook is aliased.
import { useT } from '../../i18n'
import { LoadingLine } from '../ui/Spinner'

export type TeamSettingsTab = 'members' | 'invites' | 'colors' | 'rules' | 'backup' | 'onenote' | 'trash' | 'general'
type Tab = TeamSettingsTab

interface Props {
  team: Team
  initialTab?: Tab
  onClose: () => void
  onDeleted?: () => void
}

const inputCls = 'border border-line bg-field text-fg rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500'
const roleBadge: Record<TeamRole, string> = {
  owner: 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300',
  admin: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  member: 'bg-raised text-fg-2',
  viewer: 'bg-raised text-fg-muted',
}

function RoleSelect({ value, onChange, allowAdmin, disabled }: { value: InvitableRole; onChange: (r: InvitableRole) => void; allowAdmin: boolean; disabled?: boolean }) {
  const tr = useT()
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as InvitableRole)} className={`${inputCls} py-1.5 disabled:opacity-60`} title={tr(ROLE_DESCRIPTIONS[value])}>
      {allowAdmin && <option value="admin">{tr(ROLE_LABELS.admin)}</option>}
      <option value="member">{tr(ROLE_LABELS.member)}</option>
      <option value="viewer">{tr(ROLE_LABELS.viewer)}</option>
    </select>
  )
}

export function TeamSettingsModal({ team, initialTab = 'members', onClose, onDeleted }: Props) {
  const tr = useT()
  // The window carried no dialog role and no focus trap (noticed while QA'ing
  // the import job): keyboard users tabbed straight out of it into the board.
  const boxRef = useRef<HTMLDivElement>(null)
  useDialogFocus(boxRef)
  const [tab, setTab] = useState<Tab>(initialTab)
  const { user } = useAuth()
  const { perms } = useTeamRole(team.id)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // In a field, Esc leaves the field first and the window stays (#f10b0cf7): the
      // rule picker's search box closed the whole window with it. The field's own
      // handler still runs; if it does nothing, the field is blurred.
      if (isEditableTarget(e.target)) { blurAfterEscape(e, e.target); return }
      e.stopPropagation(); onClose()
    }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [onClose])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'members', label: tr('team.settings.tab.members') },
    { id: 'invites', label: tr('team.settings.tab.invites') },
    { id: 'colors', label: tr('team.settings.tab.colors') },
    { id: 'rules', label: tr('team.settings.tab.rules') },
    { id: 'backup', label: tr('team.settings.tab.backup') },
    { id: 'onenote', label: tr('onenote.tab') },
    { id: 'trash', label: tr('page.trash.tab') },
    { id: 'general', label: tr('team.settings.tab.general') },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-label={tr('team.settings.title', { name: team.name })} className="bg-surface rounded-xl shadow-2xl w-full max-w-2xl h-[min(88vh,680px)] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line-soft flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center flex-shrink-0 shadow-sm">
              <span className="text-white text-sm font-bold">{team.name.charAt(0).toUpperCase()}</span>
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-fg truncate">{team.name}</h2>
              <p className="text-xs text-fg-muted">{tr('team.settings.manage')} · {tr('team.settings.yourRole')} <span className="font-medium">{perms.role ? tr(ROLE_LABELS[perms.role]) : '—'}</span></p>
            </div>
          </div>
          <button onClick={onClose} aria-label={tr('common.close')} className="w-8 h-8 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised">
            <Icon name="close" />
          </button>
        </div>

        {/* Tabs: sized to fit the window; on a narrow screen the row still
            scrolls sideways (swipe/wheel) but shows no scrollbar. overflow-y is
            pinned — the tabs' -mb-px underline otherwise made a vertical one. */}
        <div className="flex gap-0.5 px-4 pt-3 border-b border-line-soft flex-shrink-0 overflow-x-auto overflow-y-hidden scrollbar-none"
          // No bar to drag: a plain mouse wheel scrolls the row sideways (German labels overflow).
          onWheel={(e) => { const el = e.currentTarget; if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={(e) => { setTab(t.id); e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }}
              className={`px-2.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                tab === t.id ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-6">
          {tab === 'members' && <MembersTab team={team} perms={perms} myId={user?.id ?? null} />}
          {tab === 'invites' && <InvitesTab team={team} canManage={perms.canManage} isOwner={perms.isOwner} />}
          {tab === 'colors' && <ColorsTab team={team} canManage={perms.canManage} />}
          {tab === 'rules' && <AgentRulesTab team={team} canManage={perms.canManage} onClose={onClose} />}
          {tab === 'backup' && (
            <Suspense fallback={<p className="text-sm text-fg-faint">{tr('common.loading')}</p>}>
              <BackupTab team={team} canManage={perms.canManage} />
            </Suspense>
          )}
          {tab === 'onenote' && (
            <Suspense fallback={<p className="text-sm text-fg-faint">{tr('common.loading')}</p>}>
              <OneNoteImportTab team={team} canManage={perms.canManage} />
            </Suspense>
          )}
          {tab === 'trash' && <TrashTab team={team} />}
          {tab === 'general' && <GeneralTab team={team} perms={perms} onClose={onClose} onDeleted={onDeleted} />}
        </div>
      </div>
    </div>
  )
}

// ─── Members ─────────────────────────────────────────────────────────────────
function MembersTab({ team, perms, myId }: { team: Team; perms: ReturnType<typeof useTeamRole>['perms']; myId: string | null }) {
  const tr = useT()
  const { data: members = [], isLoading } = useTeamMembers(team.id)
  const { data: agents = [] } = useAgents()
  const updateRole = useUpdateMemberRole()
  const removeMember = useRemoveMember()
  const addByEmail = useAddMemberByEmail()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitableRole>('member')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  // Pending invitations belong next to the members: "davet edildi" is a state of
  // the roster, not a separate world (the Davetler tab keeps the links).
  const { data: pending = [] } = useTeamInvitations(perms.canManage ? team.id : null)
  const revokeInvite = useRevokeInvitation()

  const canEditRow = (r: TeamRole) => r !== 'owner' && (perms.isOwner || (perms.canManage && r !== 'admin'))

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setMsg(null)
    try {
      const p = await addByEmail.mutateAsync({ teamId: team.id, email, role })
      setMsg({ ok: true, text: tr('team.members.added', { name: p.full_name || p.email || '' }) })
      setEmail('')
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : tr('team.members.addFailed') })
    }
  }

  return (
    <div className="space-y-5">
      {perms.canManage && (
        <form onSubmit={handleAdd} className="rounded-xl border border-line bg-raised/50 p-4 space-y-2">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-wider">{tr('team.members.addRegistered')}</p>
          <div className="flex flex-wrap gap-2">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tr('team.members.emailPlaceholder')} className={`${inputCls} flex-1 min-w-[200px]`} />
            <RoleSelect value={role} onChange={setRole} allowAdmin={perms.isOwner} />
            <button type="submit" disabled={addByEmail.isPending || !email.trim()} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50">{tr('common.add')}</button>
          </div>
          <p className="text-xs text-fg-faint">{tr('team.members.addHint')}</p>
          {msg && <p className={`text-xs ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</p>}
        </form>
      )}

      {/* Invite registered people, several at once — the invitation lands in
          their Fira inbox (#4B5442B6). */}
      {perms.canManage && <InvitePeoplePicker teamId={team.id} role={role} disabled={!perms.canManage} />}

      <div>
        <p className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-2">{tr('team.members.count', { n: members.length })}</p>
        {isLoading ? (
          <p className="text-xs"><LoadingLine text={tr('common.loading')} /></p>
        ) : (
          <ul className="divide-y divide-line-soft rounded-xl border border-line overflow-hidden">
            {members.map((m) => {
              const editable = canEditRow(m.role)
              const isMe = m.user_id === myId
              return (
                <li key={m.user_id} className="flex items-center gap-3 px-3 py-2.5 bg-surface">
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <UserAvatar user={m.user ?? null} size="sm" showName />
                    {isMe && <span className="text-2xs text-fg-faint">{tr('team.members.you')}</span>}
                  </div>
                  {/* An agent has no e-mail; whose it is says more (105). */}
                  <p className="hidden sm:block text-xs text-fg-faint truncate max-w-[180px]" data-member-agent={m.user?.is_ai || undefined}>
                    {m.user?.is_ai
                      ? (() => { const owner = agents.find((a) => a.profile_id === m.user_id)?.owner?.full_name; return owner ? tr('team.members.agentOf', { name: owner }) : tr('team.members.agent') })()
                      : m.user?.email}
                  </p>
                  {editable ? (
                    <RoleSelect
                      value={m.role as InvitableRole}
                      allowAdmin={perms.isOwner}
                      disabled={updateRole.isPending}
                      onChange={(r) => updateRole.mutate({ teamId: team.id, userId: m.user_id, role: r })}
                    />
                  ) : (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge[m.role]}`} title={tr(ROLE_DESCRIPTIONS[m.role])}>{tr(ROLE_LABELS[m.role])}</span>
                  )}
                  {(editable || (isMe && m.role !== 'owner')) && (
                    confirmRemove === m.user_id ? (
                      <span className="flex items-center gap-1">
                        <button type="button" onClick={() => { removeMember.mutate({ teamId: team.id, userId: m.user_id }); setConfirmRemove(null) }} className="text-xs px-2 py-1 rounded-md bg-danger text-white">{isMe ? tr('team.members.leave') : tr('team.members.remove')}</button>
                        <button type="button" onClick={() => setConfirmRemove(null)} className="text-xs px-2 py-1 rounded-md text-fg-muted hover:bg-raised">{tr('common.giveUp')}</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmRemove(m.user_id)} title={isMe ? tr('team.members.leaveTitle') : tr('team.members.removeTitle')} className="w-7 h-7 flex items-center justify-center rounded-md text-fg-faint hover:text-danger hover:bg-danger/10">
                        <Icon name="userRemove" />
                      </button>
                    )
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {/* Invited but not yet joined: same list, muted row, "davet edildi" */}
        {perms.canManage && pending.length > 0 && (
          <ul className="divide-y divide-line-soft rounded-xl border border-line border-dashed overflow-hidden mt-2">
            {pending.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-3 py-2.5 bg-surface/60">
                <span className="w-6 h-6 rounded-full bg-raised text-fg-faint flex items-center justify-center text-2xs font-semibold flex-shrink-0" aria-hidden>
                  {(inv.email ?? '?').slice(0, 2).toUpperCase()}
                </span>
                <span className="flex-1 min-w-0 text-sm text-fg-2 truncate">{inv.email ?? tr('team.invites.linkInvite')}</span>
                <span className="text-2xs px-2 py-0.5 rounded-full bg-warning/15 text-warning font-medium flex-shrink-0">{tr('team.invitePeople.invited')}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge[inv.role]}`}>{tr(ROLE_LABELS[inv.role])}</span>
                <button
                  type="button"
                  onClick={() => revokeInvite.mutate({ id: inv.id, teamId: team.id })}
                  title={tr('team.invites.revoke')}
                  aria-label={tr('team.invites.revoke')}
                  className="w-7 h-7 flex items-center justify-center rounded-md text-fg-faint hover:text-danger hover:bg-danger/10"
                >
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {updateRole.error && <p className="text-xs text-danger mt-2">{(updateRole.error as Error).message}</p>}
        {removeMember.error && <p className="text-xs text-danger mt-2">{(removeMember.error as Error).message}</p>}
      </div>

      <div className="rounded-xl bg-raised/50 p-4 text-xs text-fg-muted space-y-1">
        {(Object.keys(ROLE_LABELS) as TeamRole[]).map((r) => (
          <p key={r}><span className={`inline-block w-16 font-semibold ${r === 'owner' ? 'text-primary-600 dark:text-primary-300' : 'text-fg-2'}`}>{tr(ROLE_LABELS[r])}</span> {tr(ROLE_DESCRIPTIONS[r])}</p>
        ))}
      </div>
    </div>
  )
}

// ─── Invitations ─────────────────────────────────────────────────────────────
function InvitesTab({ team, canManage, isOwner }: { team: Team; canManage: boolean; isOwner: boolean }) {
  const tr = useT()
  useDateFormat()   // repaint when the chosen date format changes
  const { data: invitations = [] } = useTeamInvitations(team.id)
  const createInvitation = useCreateInvitation()
  const revoke = useRevokeInvitation()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitableRole>('member')
  const [lastLink, setLastLink] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500) } catch { /* ignore */ }
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    const inv = await createInvitation.mutateAsync({ teamId: team.id, email: email.trim() || undefined, role })
    setLastLink(invitationLink(inv.token))
    setEmail('')
  }

  if (!canManage) return <p className="text-sm text-fg-muted">{tr('team.invites.onlyAdmins')}</p>

  return (
    <div className="space-y-5">
      <form onSubmit={handleCreate} className="rounded-xl border border-line bg-raised/50 p-4 space-y-2">
        <p className="text-xs font-semibold text-fg-muted uppercase tracking-wider">{tr('team.invites.create')}</p>
        <div className="flex flex-wrap gap-2">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tr('team.invites.emailPlaceholder')} className={`${inputCls} flex-1 min-w-[200px]`} />
          <RoleSelect value={role} onChange={setRole} allowAdmin={isOwner} />
          <button type="submit" disabled={createInvitation.isPending} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50">{tr('team.invites.create')}</button>
        </div>
        <p className="text-xs text-fg-faint">
          {tr('team.invites.hint')}
        </p>
        {createInvitation.error && <p className="text-xs text-danger">{(createInvitation.error as Error).message}</p>}
        {lastLink && (
          <div className="flex items-center gap-2 rounded-lg bg-surface border border-line px-3 py-2">
            <p className="text-xs font-mono text-fg-2 flex-1 break-all">{lastLink}</p>
            <button type="button" onClick={() => copy(lastLink, 'last')} className="text-xs px-2.5 py-1 rounded-md bg-raised hover:bg-line text-fg-2 whitespace-nowrap">{copied === 'last' ? `${tr('common.copied')} ✓` : tr('common.copy')}</button>
          </div>
        )}
      </form>

      <div>
        <p className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-2">{tr('team.invites.pending', { n: invitations.length })}</p>
        {invitations.length === 0 ? (
          <p className="text-xs text-fg-faint">{tr('team.invites.none')}</p>
        ) : (
          <ul className="divide-y divide-line-soft rounded-xl border border-line overflow-hidden">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-3 py-2.5 bg-surface">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-fg truncate">{inv.email ?? <span className="text-fg-muted italic">{tr('team.invites.linkInvite')}</span>}</p>
                  <p className="text-xs text-fg-faint">{displayTime(inv.created_at)}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge[inv.role]}`}>{tr(ROLE_LABELS[inv.role])}</span>
                <button type="button" onClick={() => copy(invitationLink(inv.token), inv.id)} className="text-xs px-2.5 py-1 rounded-md bg-raised hover:bg-line text-fg-2 whitespace-nowrap">{copied === inv.id ? `${tr('common.copied')} ✓` : tr('team.invites.copyLink')}</button>
                <button type="button" onClick={() => revoke.mutate({ id: inv.id, teamId: team.id })} title={tr('team.invites.revoke')} className="w-7 h-7 flex items-center justify-center rounded-md text-fg-faint hover:text-danger hover:bg-danger/10">
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl bg-raised/50 p-4">
        <p className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1">{tr('team.invites.teamCode')}</p>
        <div className="flex items-center gap-3">
          <p className="text-lg font-bold font-mono tracking-widest text-fg">{team.code}</p>
          <button type="button" onClick={() => copy(team.code, 'code')} className="text-xs px-2.5 py-1 rounded-md bg-surface border border-line hover:bg-line text-fg-2">{copied === 'code' ? `${tr('common.copied')} ✓` : tr('common.copy')}</button>
        </div>
        <p className="text-xs text-fg-faint mt-1">{tr('team.invites.codeHint', { role: tr(ROLE_LABELS.member) })}</p>
      </div>
    </div>
  )
}

// ─── Colours ─────────────────────────────────────────────────────────────────
function ColorsTab({ team, canManage }: { team: Team; canManage: boolean }) {
  const tr = useT()
  const { data: colors = [] } = useTeamColors(team.id)
  const create = useCreateTeamColor()
  const update = useUpdateTeamColor()
  const remove = useDeleteTeamColor()
  const [hex, setHex] = useState(COLOR_SWATCHES[10].hex)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    await create.mutateAsync({ teamId: team.id, name: name.trim() || ((() => { const s = COLOR_SWATCHES.find((x) => x.hex === hex); return s ? tr(s.nameKey) : tr('team.palette.fallbackName') })()), hex })
    setName('')
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-fg-muted">{tr('team.colors.intro')}</p>

      {canManage && (
        <form onSubmit={handleCreate} className="rounded-xl border border-line bg-raised/50 p-4 space-y-3">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-wider">{tr('team.colors.new')}</p>
          <div className="grid grid-cols-10 gap-1.5">
            {COLOR_SWATCHES.map((s) => (
              <button key={s.hex} type="button" title={tr(s.nameKey)} onClick={() => { setHex(s.hex); if (!name) setName(tr(s.nameKey)) }}
                className={`h-7 rounded-md transition-transform hover:scale-110 ${hex === s.hex ? 'ring-2 ring-offset-2 ring-offset-surface ring-fg' : ''}`} style={{ backgroundColor: s.hex }} />
            ))}
          </div>
          <div className="flex gap-2">
            <span className="w-9 h-9 rounded-lg flex-shrink-0" style={{ backgroundColor: hex }} />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('team.colors.namePlaceholder')} className={`${inputCls} flex-1`} />
            <button type="submit" disabled={create.isPending} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50">{tr('common.add')}</button>
          </div>
        </form>
      )}

      <div>
        <p className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-2">{tr('team.colors.paletteCount', { n: colors.length })}</p>
        {colors.length === 0 ? (
          <p className="text-xs text-fg-faint">{tr('team.colors.empty')}</p>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-2">
            {colors.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2">
                <span className="w-7 h-7 rounded-lg flex-shrink-0" style={{ backgroundColor: c.hex }} />
                {editing === c.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => { if (editName.trim() && editName !== c.name) update.mutate({ id: c.id, teamId: team.id, input: { name: editName.trim() } }); setEditing(null) }}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }}
                    className={`${inputCls} flex-1 py-1`}
                  />
                ) : (
                  <button type="button" disabled={!canManage} onClick={() => { setEditing(c.id); setEditName(c.name) }} className="flex-1 text-left text-sm text-fg truncate disabled:cursor-default" title={canManage ? tr('team.colors.editName') : undefined}>
                    {c.name} <span className="text-2xs text-fg-faint font-mono ml-1">{c.hex}</span>
                  </button>
                )}
                {canManage && (
                  <button type="button" onClick={() => remove.mutate({ id: c.id, teamId: team.id })} title={tr('team.colors.deleteTitle')} className="w-7 h-7 flex items-center justify-center rounded-md text-fg-faint hover:text-danger hover:bg-danger/10">
                    <Icon name="close" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ─── General ─────────────────────────────────────────────────────────────────
function GeneralTab({ team, perms, onClose, onDeleted }: { team: Team; perms: ReturnType<typeof useTeamRole>['perms']; onClose: () => void; onDeleted?: () => void }) {
  const tr = useT()
  const updateTeam = useUpdateTeam()
  const deleteTeam = useDeleteTeam()
  const [name, setName] = useState(team.name)
  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)
  const expected = `${tr('team.general.deleteConfirmWord')} ${team.name}`

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{tr('team.general.nameLabel')}</label>
        <div className="flex gap-2">
          <input value={name} disabled={!perms.canManage} onChange={(e) => setName(e.target.value)} aria-label={tr('team.general.nameLabel')} className={`${inputCls} flex-1 disabled:opacity-60`} />
          {perms.canManage && (
            <button type="button" disabled={updateTeam.isPending || !name.trim() || name.trim() === team.name} onClick={() => updateTeam.mutate({ id: team.id, name: name.trim() })} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50">{tr('common.save')}</button>
          )}
        </div>
        {updateTeam.error && <p className="text-xs text-danger mt-1">{(updateTeam.error as Error).message}</p>}
      </div>

      {perms.isOwner && <TransferOwnership team={team} onDone={onClose} />}

      {perms.isOwner && (
        <div className="rounded-xl border border-danger/40 p-4 space-y-3">
          <p className="text-sm font-semibold text-danger">{tr('team.general.delete')}</p>
          <p className="text-xs text-fg-muted">{tr('team.general.deleteWarning', { phrase: expected })}</p>
          <div className="flex gap-2">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={expected} className={`${inputCls} flex-1`} />
            <button
              type="button"
              disabled={typed.trim().toLowerCase() !== expected.toLowerCase() || deleting}
              onClick={async () => { setDeleting(true); try { await deleteTeam.mutateAsync(team.id); onDeleted?.(); onClose() } finally { setDeleting(false) } }}
              className="px-4 py-2 bg-danger text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              {deleting ? tr('team.general.deleting') : tr('team.general.delete')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TransferOwnership({ team, onDone }: { team: Team; onDone: () => void }) {
  const tr = useT()
  const { data: members = [] } = useTeamMembers(team.id)
  const transfer = useTransferOwnership()
  const [target, setTarget] = useState('')
  const [confirming, setConfirming] = useState(false)
  const candidates = members.filter((m) => m.role !== 'owner' && !m.user?.is_ai).sort((a, b) => (a.role === 'admin' ? -1 : 1) - (b.role === 'admin' ? -1 : 1))
  const chosen = candidates.find((m) => m.user_id === target)
  return (
    <div className="rounded-xl border border-line p-4 space-y-3">
      <p className="text-sm font-semibold text-fg">{tr('team.transfer.title')}</p>
      <p className="text-xs text-fg-muted">{tr('team.transfer.hint')}</p>
      <div className="flex gap-2">
        <select value={target} onChange={(e) => { setTarget(e.target.value); setConfirming(false) }} aria-label={tr('team.transfer.title')} className={`${inputCls} flex-1`}>
          <option value="">{tr('team.transfer.pickMember')}</option>
          {candidates.map((m) => <option key={m.user_id} value={m.user_id}>{(m.user?.full_name || m.user?.email) ?? m.user_id}{m.role === 'admin' ? ` ${tr('team.transfer.adminSuffix')}` : ''}</option>)}
        </select>
        {!confirming ? (
          <button type="button" disabled={!target} onClick={() => setConfirming(true)} className="px-4 py-2 border border-line text-fg-2 text-sm font-medium rounded-lg hover:bg-raised disabled:opacity-50">{tr('team.transfer.action')}</button>
        ) : (
          <button type="button" disabled={transfer.isPending} onClick={async () => { await transfer.mutateAsync({ teamId: team.id, userId: target }); onDone() }} className="px-4 py-2 bg-danger text-white text-sm font-medium rounded-lg disabled:opacity-50">
            {transfer.isPending ? tr('team.transfer.pending') : tr('team.transfer.confirm', { name: (chosen?.user?.full_name || chosen?.user?.email) ?? '' })}
          </button>
        )}
      </div>
      {transfer.error && <p className="text-xs text-danger">{(transfer.error as Error).message}</p>}
    </div>
  )
}
