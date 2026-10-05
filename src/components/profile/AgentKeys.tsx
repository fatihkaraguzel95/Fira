import { useState } from 'react'
import { useAgentTokens, useCreateAgentToken, useRevokeAgentToken, type AgentToken } from '../../hooks/useAgentTokens'
import { copyText } from '../../lib/files'
import { displayTime, exactTime, humanTime } from '../../lib/time'
import { useT } from '../../i18n'

/**
 * The agent's keys (101), inside its card in Ayarlar › Claude'um.
 *
 * A key is what the listener on someone's computer signs in with, instead of
 * SSH and the database password. Creating one ends in a single connection code
 * that is shown once and pasted into `fira-agent login`; from then on the list
 * tells when each key was last used, and a key that should no longer work is
 * revoked here. Only the owner sees this section.
 */
const button = 'text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-raised transition-colors disabled:opacity-50 cursor-pointer'
const LOGIN_COMMAND = 'node tools/agent/fira-agent.mjs login'

function KeyRow({ token, agentId }: { token: AgentToken; agentId: string }) {
  const t = useT()
  const revoke = useRevokeAgentToken()
  const [confirm, setConfirm] = useState(false)
  const revoked = !!token.revoked_at
  return (
    <li data-agent-key={token.id} data-revoked={revoked || undefined} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-b border-line-soft last:border-b-0">
      <code className={`text-xs px-1.5 py-0.5 rounded-md bg-field border border-line ${revoked ? 'text-fg-faint line-through' : 'text-fg'}`}>{token.prefix}…</code>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm truncate ${revoked ? 'text-fg-muted' : 'text-fg'}`}>{token.label || t('settings.agent.keys.unnamed')}</span>
        <span className="block text-xs text-fg-muted">
          <span title={exactTime(token.created_at)}>{t('settings.agent.keys.created', { when: displayTime(token.created_at) })}</span>
          {' · '}
          {revoked
            ? <span title={exactTime(token.revoked_at!)}>{t('settings.agent.keys.revokedAt', { when: displayTime(token.revoked_at!) })}</span>
            : token.last_used_at
              ? <span title={exactTime(token.last_used_at)}>{t('settings.agent.keys.lastUsed', { when: humanTime(token.last_used_at) })}</span>
              : t('settings.agent.keys.neverUsed')}
        </span>
      </span>
      {!revoked && (confirm ? (
        <span className="flex items-center gap-1.5">
          <button type="button" className={`${button} text-danger border-danger/40 hover:bg-danger/10`} disabled={revoke.isPending} onClick={() => revoke.mutate({ tokenId: token.id, agentId })}>
            {t('settings.agent.keys.revokeYes')}
          </button>
          <button type="button" className={button} onClick={() => setConfirm(false)}>{t('common.cancel')}</button>
        </span>
      ) : (
        <button type="button" className={button} onClick={() => setConfirm(true)}>{t('settings.agent.keys.revoke')}</button>
      ))}
    </li>
  )
}

export function AgentKeys({ agentId }: { agentId: string }) {
  const t = useT()
  const { data: tokens = [], isLoading } = useAgentTokens(agentId, true)
  const create = useCreateAgentToken()
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [fresh, setFresh] = useState<{ code: string; prefix: string } | null>(null)
  const [copied, setCopied] = useState<'code' | 'cmd' | null>(null)
  const copy = (what: 'code' | 'cmd', text: string) => { void copyText(text); setCopied(what); window.setTimeout(() => setCopied(null), 2000) }
  const active = tokens.filter((k) => !k.revoked_at).length

  const submit = () => create.mutate({ agentId, label }, {
    onSuccess: (out) => { setFresh({ code: out.code, prefix: out.prefix }); setAdding(false); setLabel('') },
  })

  return (
    <div className="px-4 py-3 border-t border-line-soft space-y-3" data-agent-keys>
      <div>
        <p className="text-xs font-semibold text-fg-faint uppercase tracking-wider">{t('settings.agent.keys.title')}</p>
        <p className="text-xs text-fg-muted mt-1">{t('settings.agent.keys.hint')}</p>
      </div>

      {fresh && (
        <div data-agent-key-fresh className="rounded-lg border border-primary-300 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-950/30 p-3 space-y-2.5">
          <p className="text-sm font-medium text-fg">{t('settings.agent.keys.freshTitle')}</p>
          <ol className="text-xs text-fg-2 space-y-2 list-decimal pl-4">
            <li>
              {t('settings.agent.keys.step1')}
              <span className="mt-1 flex items-center gap-2">
                {/* The code is long and of no use to the eye: one line, cut off, copied whole. */}
                <code data-agent-code className="min-w-0 flex-1 truncate text-xs px-2 py-1.5 rounded-lg bg-field border border-line text-fg select-all">{fresh.code}</code>
                <button type="button" className={button} onClick={() => copy('code', fresh.code)}>{copied === 'code' ? t('common.copied') : t('common.copy')}</button>
              </span>
            </li>
            <li>
              {t('settings.agent.keys.step2')}
              <span className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate text-xs px-2 py-1.5 rounded-lg bg-field border border-line text-fg select-all">{LOGIN_COMMAND}</code>
                <button type="button" className={button} onClick={() => copy('cmd', LOGIN_COMMAND)}>{copied === 'cmd' ? t('common.copied') : t('common.copy')}</button>
              </span>
            </li>
            <li>{t('settings.agent.keys.step3', { prefix: `${fresh.prefix}…` })}</li>
          </ol>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-warning">{t('settings.agent.keys.onceOnly')}</p>
            <button type="button" data-agent-key-done className={button} onClick={() => setFresh(null)}>{t('settings.agent.keys.done')}</button>
          </div>
        </div>
      )}

      {tokens.length > 0 && <ul>{tokens.map((k) => <KeyRow key={k.id} token={k} agentId={agentId} />)}</ul>}
      {!isLoading && tokens.length === 0 && !fresh && <p className="text-xs text-fg-muted">{t('settings.agent.keys.none')}</p>}

      {adding ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <input
            autoFocus
            data-agent-key-label
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
            aria-label={t('settings.agent.keys.labelField')}
            placeholder={t('settings.agent.keys.labelPlaceholder')}
            className="min-w-0 flex-1 text-sm bg-field border border-line rounded-lg px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-primary-500 text-fg"
          />
          <button type="submit" data-agent-key-create className={`${button} bg-primary-600 border-primary-600 text-white hover:bg-primary-700`} disabled={create.isPending}>
            {create.isPending ? t('settings.agent.keys.creating') : t('settings.agent.keys.create')}
          </button>
          <button type="button" className={button} onClick={() => { setAdding(false); setLabel('') }}>{t('common.cancel')}</button>
        </form>
      ) : (
        <button type="button" data-agent-key-new className={button} disabled={active >= 5} title={active >= 5 ? t('settings.agent.keys.limit') : undefined} onClick={() => setAdding(true)}>
          {t('settings.agent.keys.new')}
        </button>
      )}
    </div>
  )
}
