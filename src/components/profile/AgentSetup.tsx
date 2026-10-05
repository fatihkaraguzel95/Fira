import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../ui/Icon'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useCreateAgent, useAgentTeams, useSetAgentTeams } from '../../hooks/useAgents'
import { useAgentTokens } from '../../hooks/useAgentTokens'
import { useMyTeams } from '../../hooks/useTeams'
import { SETUP_STEPS, defaultAgentName, setupProgress, type SetupStep } from '../../lib/agents'
import { friendlyError } from '../../lib/errorMessage'
import { copyText } from '../../lib/files'
import { Spark } from '../ticket/AiSpark'
import { useT, type TranslationKey } from '../../i18n'
import type { Agent } from '../../types'

/**
 * "Claude'unu bağla" (105, #8a7c1847): what a person does once to get an agent
 * of their own working — create it, give it a key, start its listener, hand it
 * a first task. Three pieces of Ayarlar › Claude'um live here:
 *
 *   CreateAgentForm   for someone who has no agent yet
 *   SetupSteps        the four steps, each ticked from what really is
 *   AgentTeams        which of the owner's teams the agent is in
 */

const button = 'text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-raised transition-colors disabled:opacity-50 cursor-pointer'
const primary = 'text-sm font-medium px-3.5 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50 cursor-pointer'

/** Team checkboxes: the teams I am in; where I am only a viewer the agent will be one too. */
function TeamChecks({ value, onChange, disabled }: { value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const t = useT()
  const { data: teams = [], isLoading } = useMyTeams()
  if (isLoading) return <p className="text-xs text-fg-muted">{t('common.loading')}</p>
  if (!teams.length) return <p className="text-xs text-fg-muted">{t('settings.agent.teams.none')}</p>
  return (
    <ul className="space-y-1" data-agent-team-checks>
      {teams.map((team) => {
        const on = value.includes(team.id)
        return (
          <li key={team.id}>
            <label className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-fg hover:bg-raised ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={() => onChange(on ? value.filter((id) => id !== team.id) : [...value, team.id])}
                className="h-4 w-4 rounded-md border-line accent-primary-600"
              />
              <span className="min-w-0 flex-1 truncate">{team.name}</span>
              {team.my_role === 'viewer' && <span className="flex-shrink-0 text-xs text-fg-muted">{t('settings.agent.teams.viewerOnly')}</span>}
            </label>
          </li>
        )
      })}
    </ul>
  )
}

export function CreateAgentForm({ ownerName }: { ownerName: string | null }) {
  const t = useT()
  const create = useCreateAgent()
  const { data: teams = [] } = useMyTeams()
  const [name, setName] = useState(() => defaultAgentName(ownerName))
  const [touched, setTouched] = useState(false)
  const [teamIds, setTeamIds] = useState<string[] | null>(null)
  // The owner's name and teams arrive after the first paint: fill the defaults once they do, unless the person already typed.
  useEffect(() => { if (!touched) setName(defaultAgentName(ownerName)) }, [ownerName, touched])
  const picked = teamIds ?? teams.map((x) => x.id)
  const clean = name.trim().replace(/\s+/g, ' ')
  const valid = clean.length >= 2 && clean.length <= 60
  const error = create.error ? friendlyError(create.error) : null

  return (
    <section data-agent-create className="rounded-xl border border-line bg-surface">
      <header className="flex items-start gap-3 border-b border-line-soft px-4 py-3">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300"><Spark /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">{t('settings.agent.create.title')}</p>
          <p className="text-xs text-fg-muted">{t('settings.agent.create.intro')}</p>
        </div>
      </header>
      <form
        className="space-y-4 px-4 py-4"
        onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate({ name: clean, teamIds: picked }) }}
      >
        <div>
          <label htmlFor="agent-name" className="block text-sm text-fg">{t('settings.agent.create.name')}</label>
          <input
            id="agent-name"
            data-agent-name
            value={name}
            maxLength={60}
            onChange={(e) => { setTouched(true); setName(e.target.value) }}
            className="mt-1 w-full rounded-lg border border-line bg-field px-3 py-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
          <p className="mt-1 text-xs text-fg-muted">{t('settings.agent.create.nameHint')}</p>
        </div>
        <div>
          <p className="text-sm text-fg">{t('settings.agent.create.teams')}</p>
          <p className="mb-1.5 text-xs text-fg-muted">{t('settings.agent.create.teamsHint')}</p>
          <TeamChecks value={picked} onChange={setTeamIds} disabled={create.isPending} />
        </div>
        {error && <p role="alert" data-agent-create-error className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error.title}{error.detail ? ` ${error.detail}` : ''}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" data-agent-create-submit className={primary} disabled={!valid || create.isPending}>
            {create.isPending ? t('settings.agent.create.creating') : t('settings.agent.create.submit')}
          </button>
          <p className="text-xs text-fg-muted">{t('settings.agent.create.next')}</p>
        </div>
      </form>
    </section>
  )
}

const STEP_TITLE: Record<SetupStep, TranslationKey> = {
  identity: 'settings.agent.setup.identity', key: 'settings.agent.setup.key', listener: 'settings.agent.setup.listener', firstTask: 'settings.agent.setup.firstTask',
}
const STEP_HINT: Record<SetupStep, TranslationKey> = {
  identity: 'settings.agent.setup.identityHint', key: 'settings.agent.setup.keyHint', listener: 'settings.agent.setup.listenerHint', firstTask: 'settings.agent.setup.firstTaskHint',
}
const WATCH_COMMAND = 'node tools/agent/fira-agent.mjs watch'
/** The connector (MCP): Fira as tools inside Claude Code, with the same key (#3e02be05). */
const CONNECTOR_COMMAND = 'claude mcp add fira -- node tools/agent/fira-mcp.mjs'

/** One finished run is enough to know the agent has done a task end to end. */
function useHasFinishedRun(agentId: string) {
  return useQuery({
    queryKey: ['ai_runs', 'first', agentId],
    queryFn: async () => {
      const { data, error } = await supabase.from('ai_runs').select('id').eq('agent_id', agentId).eq('outcome', 'done').limit(1)
      if (error) throw error
      return (data ?? []).length
    },
    refetchInterval: 30_000,
  })
}

/**
 * The setup, step by step. Shown while something is still missing; once all
 * four are true it folds into one line that can be opened again.
 */
export function SetupSteps({ agent, online, canEdit }: { agent: Agent; online: boolean; canEdit: boolean }) {
  const t = useT()
  const { data: tokens = [] } = useAgentTokens(agent.id, canEdit)
  const { data: finished = 0 } = useHasFinishedRun(agent.id)
  const done = useMemo(() => setupProgress({
    hasAgent: true,
    activeKeys: tokens.filter((k) => !k.revoked_at).length,
    everSeen: !!agent.last_seen_at,
    online,
    finishedRuns: finished,
  }), [tokens, agent.last_seen_at, online, finished])
  const count = SETUP_STEPS.filter((s) => done[s]).length
  const complete = count === SETUP_STEPS.length
  const [open, setOpen] = useState<boolean | null>(null)
  const shown = open ?? !complete
  const [copied, setCopied] = useState(false)
  const [copiedConnector, setCopiedConnector] = useState(false)
  const current = SETUP_STEPS.find((s) => !done[s])

  // Only the owner sets the agent up; someone looking at it has nothing to do here.
  if (!canEdit) return null
  return (
    <div data-agent-setup={complete ? 'complete' : 'open'} className="border-b border-line-soft px-4 py-3">
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setOpen(!shown)}
        className="flex w-full items-center gap-2 rounded-lg text-left cursor-pointer"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-faint">{t('settings.agent.setup.title')}</span>
        <span data-agent-setup-count className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${complete ? 'bg-success/10 text-success' : 'bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300'}`}>
          {t('settings.agent.setup.count', { done: count, all: SETUP_STEPS.length })}
        </span>
        <Icon name="chevronDown" className={`ml-auto text-fg-muted transition-transform ${shown ? 'rotate-180' : ''}`} />
      </button>
      {shown && (
        <ol className="mt-3 space-y-3">
          {SETUP_STEPS.map((step, i) => {
            const ok = done[step]
            const now = step === current
            return (
              <li key={step} data-setup-step={step} data-done={ok || undefined} className="flex gap-3">
                <span
                  className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    ok ? 'bg-success/10 text-success' : now ? 'bg-primary-600 text-white' : 'bg-raised text-fg-muted'
                  }`}
                  aria-hidden="true"
                >
                  {ok ? <Icon name="check" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${ok ? 'text-fg-2' : 'font-medium text-fg'}`}>
                    {t(STEP_TITLE[step])}
                    <span className="sr-only"> — {ok ? t('settings.agent.setup.stepDone') : t('settings.agent.setup.stepOpen')}</span>
                  </p>
                  <p className="text-xs text-fg-muted">{t(STEP_HINT[step])}</p>
                  {step === 'listener' && !ok && (
                    <span className="mt-1.5 flex items-center gap-2">
                      <span className="flex-shrink-0 text-xs text-fg-muted">{t('settings.agent.setup.listenerManual')}</span>
                      <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-field px-2 py-1.5 text-xs text-fg select-all">{WATCH_COMMAND}</code>
                      <button type="button" className={button} onClick={() => { void copyText(WATCH_COMMAND); setCopied(true); window.setTimeout(() => setCopied(false), 2000) }}>
                        {copied ? t('common.copied') : t('common.copy')}
                      </button>
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {/* Not a step: nothing here can tell whether it was done. It makes the agent's work
          shell-free — the queue, tickets and pages become tools of the Claude Code session. */}
      {shown && (
        <div data-setup-connector className="mt-3 rounded-lg bg-raised/60 px-3 py-2.5">
          <p className="text-sm text-fg">{t('settings.agent.setup.connector')}</p>
          <p className="text-xs text-fg-muted">{t('settings.agent.setup.connectorHint')}</p>
          <span className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-field px-2 py-1.5 text-xs text-fg select-all">{CONNECTOR_COMMAND}</code>
            <button type="button" className={button} onClick={() => { void copyText(CONNECTOR_COMMAND); setCopiedConnector(true); window.setTimeout(() => setCopiedConnector(false), 2000) }}>
              {copiedConnector ? t('common.copied') : t('common.copy')}
            </button>
          </span>
        </div>
      )}
    </div>
  )
}

/** Which teams the agent is in. The owner edits; everyone else reads the names. */
export function AgentTeams({ agent, isOwner }: { agent: Agent; isOwner: boolean }) {
  const t = useT()
  const { data: memberships = [] } = useAgentTeams(agent.profile_id)
  const { data: teams = [] } = useMyTeams()
  const save = useSetAgentTeams()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string[]>([])
  const names = memberships.map((m) => teams.find((x) => x.id === m.team_id)?.name).filter((x): x is string => !!x)
  // The agent may be in teams this reader is not; those are not listed and not touched.
  const mine = memberships.filter((m) => teams.some((x) => x.id === m.team_id)).map((m) => m.team_id)

  if (editing) {
    return (
      <div data-agent-teams="editing" className="space-y-2">
        <TeamChecks value={draft} onChange={setDraft} disabled={save.isPending} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-agent-teams-save
            className={`${button} border-primary-600 bg-primary-600 text-white hover:bg-primary-700`}
            disabled={save.isPending}
            onClick={() => save.mutate({ agentId: agent.id, profileId: agent.profile_id, teamIds: draft }, { onSuccess: () => setEditing(false) })}
          >
            {t('common.save')}
          </button>
          <button type="button" className={button} onClick={() => setEditing(false)}>{t('common.cancel')}</button>
        </div>
        <p className="text-xs text-fg-muted">{t('settings.agent.teams.hint')}</p>
      </div>
    )
  }
  return (
    <div data-agent-teams="view" className="flex flex-wrap items-center gap-1.5">
      {names.length
        ? names.map((n) => <span key={n} className="rounded-md bg-raised px-2 py-0.5 text-xs text-fg-2">{n}</span>)
        : <span className="text-sm text-fg-muted">{t('settings.agent.teams.empty')}</span>}
      {isOwner && (
        <button type="button" data-agent-teams-edit className={`${button} ml-1`} onClick={() => { setDraft(mine); setEditing(true) }}>
          {t('settings.agent.teams.edit')}
        </button>
      )}
    </div>
  )
}
