import type { Agent } from '../types'

/**
 * What the agent's presence channel says (104): the listener is in it, is not
 * in it, or this screen has not joined the channel (yet).
 */
export type AgentPresence = 'present' | 'absent' | 'unknown'

/**
 * Whether the agent's listener counts as connected.
 *
 * The listener sits in a presence channel; the moment its process ends it is
 * gone from there, so presence answers at once (#c813e104 — closing the
 * terminal used to show "Dinliyor" for three more minutes).
 *
 * The heartbeat is the fallback: the listener says "I am here" once a minute,
 * and three minutes without a word — two missed beats and some slack — is
 * offline. It decides when presence cannot: this screen has not joined the
 * channel, or the listener does not use it (it reports `presence` and a live
 * `watch` only while it is in the channel; a listener whose live connection
 * dropped but which is still running reports `watch: 'poll'`).
 */
export const ONLINE_WINDOW_MS = 180_000
export function agentOnline(agent: Pick<Agent, 'last_seen_at'> & { runner?: Agent['runner'] | null }, now: number = Date.now(), presence: AgentPresence = 'unknown'): boolean {
  if (presence === 'present') return true
  if (presence === 'absent' && agent.runner?.presence === true && agent.runner?.watch === 'realtime') return false
  if (!agent.last_seen_at) return false
  const seen = new Date(agent.last_seen_at).getTime()
  if (Number.isNaN(seen)) return false
  return now - seen <= ONLINE_WINDOW_MS
}

/**
 * The limits a runner works under, as it reports them (`agents.runner.limits`, #2252823c): they are
 * set on the runner's computer, in its owner's file, and only shown here. Null when the agent is not
 * a runner (a chat session has no such limits) or reports nothing usable.
 */
export interface RunnerLimits {
  maxParallel: number
  maxPerDay: number
  startedToday: number
  running: number
  maxTurns: number | null
  maxMinutes: number | null
  maxBudgetUsd: number | null
  /** Why no new job is taken right now. */
  waiting: 'daily' | 'parallel' | null
  /** Passive jobs (110) on this runner: allowed here or not, today's share and how much of it is used. Null for a runner that does not say. */
  passive: { enabled: boolean; maxPerDay: number; doneToday: number; full: boolean } | null
}
export function runnerLimits(runner: Agent['runner'] | null | undefined): RunnerLimits | null {
  if (runner?.kind !== 'runner') return null
  const l = runner.limits as Record<string, unknown> | undefined
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const maxParallel = num(l?.maxParallel), maxPerDay = num(l?.maxPerDay)
  if (!l || maxParallel === null || maxPerDay === null) return null
  const startedToday = num(l.startedToday) ?? 0
  // The count is the runner's own; "full" is also read off the numbers, in case an older runner does not say why it waits.
  const waiting = l.waiting === 'daily' || startedToday >= maxPerDay ? 'daily' : l.waiting === 'parallel' ? 'parallel' : null
  const p = l.passive as Record<string, unknown> | undefined
  const pMax = num(p?.maxPerDay), pDone = num(p?.doneToday) ?? 0
  const passive = p && typeof p.enabled === 'boolean' && pMax !== null ? { enabled: p.enabled, maxPerDay: pMax, doneToday: pDone, full: p.enabled && pDone >= pMax } : null
  return { maxParallel, maxPerDay, startedToday, running: num(l.running) ?? 0, maxTurns: num(l.maxTurns), maxMinutes: num(l.maxMinutes), maxBudgetUsd: num(l.maxBudgetUsd), waiting, passive }
}

/**
 * May an agent put its work live (109)? `auto` by itself, `ask` after a person's
 * yes, `never` not at all. Said for a list and for a person; the stricter one
 * applies — the same rule as the server's `ai_deploy_policy`.
 */
export type DeployPolicy = 'auto' | 'ask' | 'never'
export const DEPLOY_POLICIES: DeployPolicy[] = ['auto', 'ask', 'never']
export const asDeployPolicy = (v: unknown): DeployPolicy => (DEPLOY_POLICIES as unknown[]).includes(v) ? (v as DeployPolicy) : 'auto'
export function effectiveDeploy(list: unknown, person: unknown): DeployPolicy {
  return DEPLOY_POLICIES[Math.max(DEPLOY_POLICIES.indexOf(asDeployPolicy(list)), DEPLOY_POLICIES.indexOf(asDeployPolicy(person)))]
}

/**
 * What the agent is doing right now, for every place that says it (#c8be788f):
 * not connected, working on a job, or listening for one. A job left open by a
 * listener that is gone is not "working" — nobody is on it until the agent is back.
 */
export type AgentState = 'offline' | 'working' | 'online'
export function agentState(online: boolean, hasOpenJob: boolean): AgentState {
  return !online ? 'offline' : hasOpenJob ? 'working' : 'online'
}

/**
 * The name offered for a person's new agent: their given names followed by
 * "Claude" ("Yavuz Selim Dogdu" → "Yavuz Selim Claude"), the shape the first
 * agent has. The last word stays "Claude" so the hand-off button reads
 * "Claude'a yaptır" (`agentShortName`).
 */
export function defaultAgentName(ownerFullName: string | null | undefined): string {
  const words = (ownerFullName ?? '').trim().split(/\s+/).filter(Boolean)
  const given = words.length > 1 ? words.slice(0, -1) : words
  return [...given, 'Claude'].join(' ')
}

/**
 * Where a new agent's setup stands — the four things that have to be true
 * before "assign it and it works" holds. Each is read from what really is, not
 * from a checklist someone ticks.
 */
export type SetupStep = 'identity' | 'key' | 'listener' | 'firstTask'
export const SETUP_STEPS: SetupStep[] = ['identity', 'key', 'listener', 'firstTask']
export function setupProgress(facts: { hasAgent: boolean; activeKeys: number; everSeen: boolean; online: boolean; finishedRuns: number }): Record<SetupStep, boolean> {
  return {
    identity: facts.hasAgent,
    key: facts.hasAgent && facts.activeKeys > 0,
    // Connected now, or has been: a setup that worked yesterday is not "undone" because the laptop is closed today.
    listener: facts.hasAgent && (facts.online || facts.everSeen),
    firstTask: facts.hasAgent && facts.finishedRuns > 0,
  }
}

/** The agent's short name: the last word of the account name ("Ali İlker Claude" → "Claude"). */
export const agentShortName = (fullName: string | null | undefined) => fullName?.trim().split(/\s+/).pop() || 'AI'

/**
 * What `fira-agent login` takes (101): where Fira is, the public key of its API
 * and the agent key, as one string — so setting an agent up is one paste, not
 * three values to carry over. `tools/agent/fira-agent.mjs` reads the same shape;
 * the prefix is the version of the format.
 */
export const CONNECTION_PREFIX = 'fira1.'
export function connectionCode({ url, anon, key }: { url: string; anon: string; key: string }): string {
  const json = JSON.stringify({ u: url, a: anon, k: key })
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
  return CONNECTION_PREFIX + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
/** The inverse, for the test (and a mirror of what the tool does). */
export function parseConnectionCode(code: string): { url: string; anon: string; key: string } | null {
  const text = code.trim()
  if (!text.startsWith(CONNECTION_PREFIX)) return null
  try {
    const b64 = text.slice(CONNECTION_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const o = JSON.parse(new TextDecoder().decode(bytes)) as { u?: string; a?: string; k?: string }
    return o.u && o.a && o.k ? { url: o.u, anon: o.a, key: o.k } : null
  } catch { return null }
}
