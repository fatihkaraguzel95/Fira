import { describe, expect, it } from 'vitest'
import { agentOnline, agentShortName, agentState, effectiveDeploy, connectionCode, defaultAgentName, parseConnectionCode, runnerLimits, setupProgress } from './agents'

describe('connectionCode', () => {
  const parts = { url: 'https://fira.example/api', anon: 'eyJ.public.key', key: 'fira_agt_' + 'a1'.repeat(32) }

  it('packs the three values into one pasteable string and back', () => {
    const code = connectionCode(parts)
    expect(code).toMatch(/^fira1\.[A-Za-z0-9_-]+$/)
    expect(parseConnectionCode(`  ${code}\n`)).toEqual(parts)
  })

  it('refuses anything that is not a connection code', () => {
    expect(parseConnectionCode('fira_agt_abc')).toBeNull()
    expect(parseConnectionCode('fira1.not-base64-json')).toBeNull()
    expect(parseConnectionCode('fira1.' + btoa('{"u":"x"}'))).toBeNull()
  })
})

const NOW = Date.parse('2026-10-01T12:00:00Z')
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()

describe('agentOnline', () => {
  it('is offline until the listener has been seen once', () => {
    expect(agentOnline({ last_seen_at: null }, NOW)).toBe(false)
    expect(agentOnline({ last_seen_at: 'not a date' }, NOW)).toBe(false)
  })

  it('tolerates two missed beats of the one-a-minute heartbeat', () => {
    expect(agentOnline({ last_seen_at: ago(170) }, NOW)).toBe(true)
    expect(agentOnline({ last_seen_at: ago(190) }, NOW)).toBe(false)
  })

  const live = { kind: 'session', watch: 'realtime', presence: true }

  it('is offline the moment a listener that uses presence leaves the channel', () => {
    // seen ten seconds ago: the heartbeat alone would still say "listening" for minutes
    expect(agentOnline({ last_seen_at: ago(10), runner: live }, NOW, 'absent')).toBe(false)
  })

  it('is online while the listener is in the channel, whatever the heartbeat says', () => {
    expect(agentOnline({ last_seen_at: ago(900), runner: live }, NOW, 'present')).toBe(true)
    expect(agentOnline({ last_seen_at: null }, NOW, 'present')).toBe(true)
  })

  it('goes by the heartbeat when presence cannot answer', () => {
    // this screen has not joined the channel yet
    expect(agentOnline({ last_seen_at: ago(10), runner: live }, NOW, 'unknown')).toBe(true)
    // a listener without the live connection (or one that lost it and said so) is not in the channel by design
    expect(agentOnline({ last_seen_at: ago(10), runner: { watch: 'poll', presence: false } }, NOW, 'absent')).toBe(true)
    expect(agentOnline({ last_seen_at: ago(200), runner: { watch: 'poll', presence: false } }, NOW, 'absent')).toBe(false)
    // an older listener that never reports presence
    expect(agentOnline({ last_seen_at: ago(10), runner: { watch: 'realtime' } }, NOW, 'absent')).toBe(true)
  })
})

describe('agentShortName', () => {
  it('takes the last word of the account name', () => {
    expect(agentShortName('Ali İlker Claude')).toBe('Claude')
    expect(agentShortName('  Claude  ')).toBe('Claude')
  })

  it('falls back when the account has no name', () => {
    expect(agentShortName(null)).toBe('AI')
    expect(agentShortName('   ')).toBe('AI')
  })
})

describe('defaultAgentName', () => {
  it('offers the given names followed by Claude', () => {
    expect(defaultAgentName('Yavuz Selim Dogdu')).toBe('Yavuz Selim Claude')
    expect(defaultAgentName('Halil')).toBe('Halil Claude')
    expect(defaultAgentName('  ')).toBe('Claude')
    expect(defaultAgentName(null)).toBe('Claude')
  })

  it('keeps the hand-off button reading "Claude"', () => {
    expect(agentShortName(defaultAgentName('Yavuz Selim Dogdu'))).toBe('Claude')
  })
})

describe('setupProgress', () => {
  const base = { hasAgent: true, activeKeys: 0, everSeen: false, online: false, finishedRuns: 0 }

  it('has nothing done before the agent exists', () => {
    expect(setupProgress({ ...base, hasAgent: false, activeKeys: 2, online: true, finishedRuns: 3 })).toEqual({ identity: false, key: false, listener: false, firstTask: false })
  })

  it('ticks each step from what is really there', () => {
    expect(setupProgress(base)).toEqual({ identity: true, key: false, listener: false, firstTask: false })
    expect(setupProgress({ ...base, activeKeys: 1 })).toMatchObject({ key: true, listener: false })
    expect(setupProgress({ ...base, activeKeys: 1, online: true, finishedRuns: 1 })).toEqual({ identity: true, key: true, listener: true, firstTask: true })
  })

  it('keeps the listener step done for an agent that has connected before and is off now', () => {
    expect(setupProgress({ ...base, activeKeys: 1, everSeen: true, online: false }).listener).toBe(true)
  })
})

describe('agentState', () => {
  it('is one answer for every screen: offline, working or listening', () => {
    expect(agentState(true, false)).toBe('online')
    expect(agentState(true, true)).toBe('working')
  })
  it('does not call a job working while its listener is gone', () => {
    expect(agentState(false, true)).toBe('offline')
    expect(agentState(false, false)).toBe('offline')
  })
})

describe('effectiveDeploy', () => {
  it('applies the stricter of the list and the person', () => {
    expect(effectiveDeploy('auto', 'auto')).toBe('auto')
    expect(effectiveDeploy('ask', 'auto')).toBe('ask')
    expect(effectiveDeploy('auto', 'never')).toBe('never')
    expect(effectiveDeploy('never', 'ask')).toBe('never')
  })
  it('reads a missing or unknown setting as auto', () => {
    expect(effectiveDeploy(undefined, null)).toBe('auto')
    expect(effectiveDeploy('sometimes', 'ask')).toBe('ask')
  })
})

describe('runnerLimits', () => {
  const limits = { maxParallel: 1, maxPerDay: 10, maxTurns: 60, maxMinutes: 45, maxBudgetUsd: null, startedToday: 3, running: 1, waiting: null }
  it('reads what a runner reports', () => {
    expect(runnerLimits({ kind: 'runner', limits })).toEqual({ maxParallel: 1, maxPerDay: 10, startedToday: 3, running: 1, maxTurns: 60, maxMinutes: 45, maxBudgetUsd: null, waiting: null, passive: null })
  })
  it('is nothing for a chat session, or for a runner that reports no limits', () => {
    expect(runnerLimits({ kind: 'session' })).toBeNull()
    expect(runnerLimits({ kind: 'session', limits })).toBeNull()
    expect(runnerLimits({ kind: 'runner' })).toBeNull()
    expect(runnerLimits({ kind: 'runner', limits: { maxParallel: '1' } })).toBeNull()
    expect(runnerLimits(null)).toBeNull()
  })
  it('says the daily limit is reached from the count too, and passes on why it waits', () => {
    expect(runnerLimits({ kind: 'runner', limits: { ...limits, startedToday: 10 } })?.waiting).toBe('daily')
    expect(runnerLimits({ kind: 'runner', limits: { ...limits, waiting: 'daily' } })?.waiting).toBe('daily')
    expect(runnerLimits({ kind: 'runner', limits: { ...limits, waiting: 'parallel' } })?.waiting).toBe('parallel')
    expect(runnerLimits({ kind: 'runner', limits: { ...limits, waiting: 'something else' } })?.waiting).toBeNull()
  })
  it('an older runner that reports only the four counts still shows', () => {
    expect(runnerLimits({ kind: 'runner', limits: { maxParallel: 2, maxPerDay: 5, startedToday: 1, running: 0 } })).toEqual({ maxParallel: 2, maxPerDay: 5, startedToday: 1, running: 0, maxTurns: null, maxMinutes: null, maxBudgetUsd: null, waiting: null, passive: null })
  })
  it('reads the passive share: allowed or not, how much of the day is used, and when it is full', () => {
    expect(runnerLimits({ kind: 'runner', limits: { ...limits, passive: { enabled: true, maxPerDay: 40, doneToday: 12 } } })?.passive).toEqual({ enabled: true, maxPerDay: 40, doneToday: 12, full: false })
    expect(runnerLimits({ kind: 'runner', limits: { ...limits, passive: { enabled: true, maxPerDay: 40, doneToday: 40 } } })?.passive?.full).toBe(true)
    // not allowed on that computer: never "full", whatever the count says
    expect(runnerLimits({ kind: 'runner', limits: { ...limits, passive: { enabled: false, maxPerDay: 0, doneToday: 0 } } })?.passive).toEqual({ enabled: false, maxPerDay: 0, doneToday: 0, full: false })
    expect(runnerLimits({ kind: 'runner', limits: { ...limits, passive: { enabled: 'yes', maxPerDay: 40 } } })?.passive).toBeNull()
  })
})
