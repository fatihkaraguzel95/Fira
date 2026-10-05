import { describe, expect, it } from 'vitest'
import { compactNumber, durationParts, modelLabel, modelSplit, periodStart, runStalled, runTimeline, runsByDay, summarizePassive, firstPassRate, readFirstPass, summarizeRuns, toolUsage, type RunLike, rangeBounds, runRuleViews } from './agentStats'

const run = (over: Partial<RunLike>): RunLike => ({
  outcome: 'done', source: 'transcript', started_at: '2026-09-30T10:00:00', finished_at: '2026-09-30T10:10:00',
  active_seconds: 480, turns: 22, model: 'claude-opus-5-5', output_tokens: 20000, cache_read_tokens: 13_000_000, cost_usd: 6.16,
  ...over,
})

describe('summarizeRuns', () => {
  const runs = [
    run({}),
    run({ started_at: '2026-09-30T14:00:00', active_seconds: 60, turns: 2, output_tokens: 700, cost_usd: 0.3 }),
    run({ started_at: '2026-09-29T09:00:00', active_seconds: 5520, turns: 116, output_tokens: 174000, cost_usd: 13.29, outcome: 'failed' }),
    run({ started_at: '2026-09-10T09:00:00', source: 'queue', active_seconds: null, turns: null, model: null, output_tokens: null, cost_usd: null }),
    run({ started_at: '2026-10-01T09:00:00', outcome: 'running', finished_at: null, active_seconds: null, turns: null, output_tokens: null, cost_usd: null }),
  ]
  const s = summarizeRuns(runs)

  it('counts outcomes apart', () => {
    expect([s.completed, s.failed, s.cancelled, s.running]).toEqual([3, 1, 0, 1])
  })

  it('counts the days work started on', () => {
    expect(s.workingDays).toBe(4)
  })

  it('adds up time, tokens and cost of measured runs only', () => {
    expect(s.measured).toBe(3)
    expect(s.unmeasured).toBe(1)          // the queue-only run; the running one is not closed yet
    expect(s.activeSeconds).toBe(480 + 60 + 5520)
    expect(s.outputTokens).toBe(194700)
    expect(s.costUsd).toBe(19.75)
  })

  it('takes medians over measured runs', () => {
    expect(s.medianActiveSeconds).toBe(480)
    expect(s.medianTurns).toBe(22)
    expect(s.medianCostUsd).toBe(6.16)
  })

  it('has no medians when nothing was measured', () => {
    const none = summarizeRuns([run({ source: 'queue', active_seconds: null })])
    expect(none.medianActiveSeconds).toBeNull()
    expect(none.activeSeconds).toBe(0)
  })
})

describe('runsByDay', () => {
  it('fills the days between the first and the last run with zeros', () => {
    const days = runsByDay([
      run({ started_at: '2026-09-28T10:00:00', active_seconds: 600 }),
      run({ started_at: '2026-09-30T10:00:00', active_seconds: 90 }),
      run({ started_at: '2026-09-30T12:00:00', active_seconds: 150, outcome: 'failed' }),
    ])
    expect(days).toEqual([
      { day: '2026-09-28', tasks: 1, activeMinutes: 10 },
      { day: '2026-09-29', tasks: 0, activeMinutes: 0 },
      { day: '2026-09-30', tasks: 1, activeMinutes: 4 },
    ])
  })

  it('ignores work that is still running and gives nothing for no runs', () => {
    expect(runsByDay([run({ outcome: 'running', finished_at: null })])).toEqual([])
    expect(runsByDay([])).toEqual([])
  })
})

describe('models', () => {
  it('names a model the way people say it', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-opus-5')).toBe('Opus 5')
    expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelLabel('something-else')).toBe('something-else')
    expect(modelLabel(null)).toBe('—')
  })

  it('keeps each model on its own colour slot whatever the mix is', () => {
    const all = modelSplit([run({ model: 'claude-opus-5-5' }), run({ model: 'claude-opus-5' }), run({ model: 'claude-opus-5' }), run({ model: 'claude-fable-5-1' })])
    expect(all).toEqual([
      { model: 'claude-opus-5', slot: 0, count: 2 },
      { model: 'claude-fable-5-1', slot: 1, count: 1 },
      { model: 'claude-opus-5-5', slot: 2, count: 1 },
    ])
    // Opus 5.5 alone is still slot 2: the survivor is not repainted.
    expect(modelSplit([run({ model: 'claude-opus-5-5' })])).toEqual([{ model: 'claude-opus-5-5', slot: 2, count: 1 }])
  })

  it('folds unknown models into "other" and skips runs without a model', () => {
    expect(modelSplit([run({ model: 'claude-next-9' }), run({ model: null }), run({ model: 'claude-opus-5', outcome: 'running' })])).toEqual([{ model: 'other', slot: -1, count: 1 }])
  })
})

describe('runStalled', () => {
  const NOW = Date.parse('2026-10-02T10:00:00Z')
  const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString()

  it('is a running job that has been silent for more than five minutes', () => {
    expect(runStalled({ outcome: 'running', started_at: at(30), heartbeat_at: at(6) }, NOW)).toBe(true)
    expect(runStalled({ outcome: 'running', started_at: at(30), heartbeat_at: at(4) }, NOW)).toBe(false)
  })

  it('goes by the start when there has been no heartbeat at all', () => {
    expect(runStalled({ outcome: 'running', started_at: at(6), heartbeat_at: null }, NOW)).toBe(true)
    expect(runStalled({ outcome: 'running', started_at: at(1) }, NOW)).toBe(false)
  })

  it('never calls a finished run stalled', () => {
    expect(runStalled({ outcome: 'done', started_at: at(600), heartbeat_at: at(590) }, NOW)).toBe(false)
    expect(runStalled({ outcome: 'cancelled', started_at: at(600), heartbeat_at: null }, NOW)).toBe(false)
  })
})

describe('formatting', () => {
  it('reads a duration in the unit it is long enough for', () => {
    expect(durationParts(15)).toMatchObject({ unit: 'sec', s: 15 })
    expect(durationParts(480)).toMatchObject({ unit: 'min', m: 8 })
    expect(durationParts(5520)).toMatchObject({ unit: 'hourMin', h: 1, m: 32 })
    expect(durationParts(3590)).toMatchObject({ unit: 'hourMin', h: 1, m: 0 })
  })

  it('writes token counts as magnitudes', () => {
    expect(compactNumber(737, 'tr-TR')).toBe('737')
    expect(compactNumber(13400, 'tr-TR')).toBe('13 bin')
    expect(compactNumber(2_700_000, 'tr-TR')).toBe('2,7 Mn')
    expect(compactNumber(13400, 'en-US')).toBe('13.4K')
  })

  it('starts a period at local midnight', () => {
    const now = new Date(2026, 9, 1, 15, 30)
    expect(periodStart('today', now)).toEqual(new Date(2026, 9, 1))
    expect(periodStart('7d', now)).toEqual(new Date(2026, 8, 25))
    expect(periodStart('30d', now)).toEqual(new Date(2026, 8, 2))
    expect(periodStart('all', now)).toBeNull()
  })
})

describe('runTimeline', () => {
  const run = { requested_at: '2026-10-02T10:00:00Z', started_at: '2026-10-02T10:00:40Z', finished_at: '2026-10-02T10:17:00Z' }
  const steps = [
    { step: 'QA', at: '2026-10-02T10:10:00Z' },
    { step: 'Devam Ediyor', at: '2026-10-02T10:01:00Z' },
    { step: 'test', at: '2026-10-02T10:05:00Z' },
  ]

  it('orders the path and measures each stretch', () => {
    const t = runTimeline(run, steps)
    expect(t.map((x) => x.label ?? x.kind)).toEqual(['requested', 'claimed', 'Devam Ediyor', 'test', 'QA', 'finished'])
    expect(t[0]).toMatchObject({ sinceStart: -40, duration: 40 })
    expect(t[1]).toMatchObject({ sinceStart: 0, duration: 20 })
    expect(t[3]).toMatchObject({ sinceStart: 260, duration: 300 })
    expect(t[5]).toMatchObject({ kind: 'finished', sinceStart: 980, duration: null })
  })

  it('has no "asked for" when the run knows no separate moment, and no end while it runs', () => {
    const t = runTimeline({ requested_at: run.started_at, started_at: run.started_at, finished_at: null }, [steps[1]])
    expect(t.map((x) => x.kind)).toEqual(['claimed', 'step'])
    expect(t[1].duration).toBeNull()
  })

  it('leaves out steps that are not inside the run', () => {
    const t = runTimeline(run, [{ step: 'önceki deneme', at: '2026-10-02T09:00:00Z' }, { step: 'sonraki', at: '2026-10-02T11:00:00Z' }])
    expect(t.map((x) => x.kind)).toEqual(['requested', 'claimed', 'finished'])
  })
})

describe('toolUsage', () => {
  it('sorts by calls and drops what is not a count', () => {
    expect(toolUsage({ Edit: 3, Bash: 38, Read: 3, Bozuk: 'x', Sıfır: 0 })).toEqual([
      { name: 'Bash', calls: 38 }, { name: 'Edit', calls: 3 }, { name: 'Read', calls: 3 },
    ])
    expect(toolUsage(null)).toEqual([])
  })
})

describe('rangeBounds', () => {
  it('covers both picked days: from the first midnight to the midnight after the last', () => {
    const { since, until } = rangeBounds('2026-09-28', '2026-10-02')
    expect(since).toEqual(new Date(2026, 8, 28))
    expect(until).toEqual(new Date(2026, 9, 3))
  })
  it('leaves an open end open and reads swapped dates in order', () => {
    expect(rangeBounds('2026-10-01', null)).toEqual({ since: new Date(2026, 9, 1), until: null })
    expect(rangeBounds(null, '2026-10-01')).toEqual({ since: null, until: new Date(2026, 9, 2) })
    expect(rangeBounds('2026-10-02', '2026-09-28')).toEqual({ since: new Date(2026, 8, 28), until: new Date(2026, 9, 3) })
    expect(rangeBounds(null, null)).toEqual({ since: null, until: null })
  })
})

describe('runRuleViews', () => {
  const rule = (page_id: string, updated_at: string) => ({ page_id, title: 'Kural', scope: 'team', required: true, updated_at })
  it('says nothing was recorded rather than "no rules"', () => {
    expect(runRuleViews(null, [])).toBeNull()
    expect(runRuleViews([], [])).toEqual([])
  })
  it('tells an unchanged page from one edited since, and from one that is gone', () => {
    const pages = [
      { id: 'a', updated_at: '2026-10-02T10:00:00+00:00', archived_at: null },
      { id: 'b', updated_at: '2026-10-02T12:00:00+00:00', archived_at: null },
      { id: 'c', updated_at: '2026-10-02T10:00:00+00:00', archived_at: '2026-10-02T11:00:00+00:00' },
    ]
    const views = runRuleViews([rule('a', '2026-10-02T10:00:00+00:00'), rule('b', '2026-10-02T10:00:00+00:00'), rule('c', '2026-10-02T10:00:00+00:00'), rule('d', '2026-10-02T10:00:00+00:00')], pages)!
    expect(views.map((v) => v.state)).toEqual(['same', 'changed', 'gone', 'gone'])
  })
  it('does not guess while the pages are still loading', () => {
    expect(runRuleViews([rule('a', '2026-10-02T10:00:00+00:00')], undefined)![0].state).toBe('unknown')
  })
})

describe('summarizePassive', () => {
  it('adds up what the calls took; a job without a time is a job, not time', () => {
    expect(summarizePassive([{ ms: 13472, cost_usd: 0.0061 }, { ms: 9000, cost_usd: '0.0052' }, { ms: null, cost_usd: null }]))
      .toEqual({ count: 3, pictures: 3, translations: 0, seconds: 22, costUsd: 0.01, measured: 2 })
  })
  it('is zero for nothing', () => {
    expect(summarizePassive([])).toEqual({ count: 0, pictures: 0, translations: 0, seconds: 0, costUsd: 0, measured: 0 })
  })
  it('counts pictures and translations apart; a call that found nothing to translate is time, not a translation', () => {
    expect(summarizePassive([
      { ms: 12000, cost_usd: 0.006, kind: 'image_text' },
      { ms: 3000, cost_usd: 0.002, kind: 'translate', translated: true },
      { ms: 2000, cost_usd: 0.001, kind: 'translate', translated: false },
    ])).toEqual({ count: 3, pictures: 1, translations: 1, seconds: 17, costUsd: 0.01, measured: 3 })
  })
})

describe('first-pass approval', () => {
  it('is what was approved the first time, out of what has been decided', () => {
    expect(firstPassRate({ delivered: 131, firstPass: 79, returned: 42, waiting: 10, other: 0 })).toBeCloseTo(79 / 121)
    expect(firstPassRate({ delivered: 3, firstPass: 3, returned: 0, waiting: 0, other: 0 })).toBe(1)
    expect(firstPassRate({ delivered: 2, firstPass: 0, returned: 2, waiting: 0, other: 0 })).toBe(0)
  })
  it('has no rate while nothing is decided: waiting work is not a failure', () => {
    expect(firstPassRate({ delivered: 4, firstPass: 0, returned: 0, waiting: 3, other: 1 })).toBeNull()
    expect(firstPassRate({ delivered: 0, firstPass: 0, returned: 0, waiting: 0, other: 0 })).toBeNull()
  })
  it('reads the server\'s answer and survives an odd one', () => {
    expect(readFirstPass({ delivered: 5, first_pass: 2, returned: 1, waiting: 1, other: 1 })).toEqual({ delivered: 5, firstPass: 2, returned: 1, waiting: 1, other: 1 })
    expect(readFirstPass(null)).toEqual({ delivered: 0, firstPass: 0, returned: 0, waiting: 0, other: 0 })
    expect(readFirstPass({ delivered: '5', first_pass: -1, returned: Number.NaN })).toEqual({ delivered: 0, firstPass: 0, returned: 0, waiting: 0, other: 0 })
  })
})
