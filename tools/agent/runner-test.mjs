// Run with: node --test tools/agent/runner-test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULTS, LINGER_MS, addMetrics, afterSession, buildPrompt, normalizeState, parkedVerdict, resumePrompt, failureReason, metricsFromResult, metricsFromTranscript, parseResult, profileFor, readConfig, runnerReport, sessionArgs, today, transcriptStats, verdict } from './runner.mjs'

test('the runner is off and read-only until the owner says otherwise', () => {
  const c = readConfig({})
  assert.equal(c.enabled, false)
  assert.deepEqual(c.allowedTools, ['mcp__fira', 'Read', 'Glob', 'Grep'])
  assert.equal(c.permissionMode, 'default')
  assert.equal(readConfig({ enabled: 'yes' }).enabled, false, 'only a literal true turns it on')
  assert.equal(readConfig({ enabled: true }).enabled, true)
})

test('the mode that skips every permission check is refused', () => {
  assert.throws(() => readConfig({ permissionMode: 'bypassPermissions' }), /kabul edilmiyor/)
  assert.throws(() => readConfig({ lists: { x: { permissionMode: 'bypassPermissions' } } }), /kabul edilmiyor/)
  assert.throws(() => readConfig({ allowedTools: 'Bash' }), /metin listesi/)
  assert.equal(readConfig({ permissionMode: 'acceptEdits' }).permissionMode, 'acceptEdits')
})

test('limits are kept within bounds', () => {
  const c = readConfig({ maxParallel: 50, maxPerDay: -3, maxTurns: 'çok', maxMinutes: 100000 })
  assert.equal(c.maxParallel, 4)
  assert.equal(c.maxPerDay, 0)
  assert.equal(c.maxTurns, DEFAULTS.maxTurns)
  assert.equal(c.maxMinutes, 480)
})

test("a list's own entry applies over the general one, by id or by name", () => {
  const c = readConfig({ allowedTools: ['mcp__fira'], lists: { 'fira-development': { allowedTools: ['mcp__fira', 'Edit', 'Bash(npx tsc:*)'], permissionMode: 'acceptEdits', maxTurns: 120 }, 'id-1': { model: 'x' } } })
  assert.deepEqual(profileFor(c, { id: 'id-9', name: 'Başka' }).allowedTools, ['mcp__fira'])
  const own = profileFor(c, { id: 'id-9', name: 'fira-development' })
  assert.deepEqual(own.allowedTools, ['mcp__fira', 'Edit', 'Bash(npx tsc:*)'])
  assert.equal(own.permissionMode, 'acceptEdits')
  assert.equal(own.maxTurns, 120)
  assert.equal(profileFor(c, { id: 'id-1', name: 'Başka' }).model, 'x')
  assert.equal(profileFor(c, null).permissionMode, 'default')
})

test('the session gets its tools named, never a blanket permission', () => {
  const config = readConfig({ enabled: true, maxBudgetUsd: 3 })
  const args = sessionArgs({ profile: profileFor(config, null), config, sessionId: 'sid', mcpConfig: '/tmp/mcp.json' })
  assert.ok(args.includes('--strict-mcp-config'))
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'default')
  assert.deepEqual(args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--allowedTools') + 5), ['mcp__fira', 'Read', 'Glob', 'Grep'])
  assert.equal(args[args.indexOf('--max-budget-usd') + 1], '3')
  assert.ok(!args.some((a) => /dangerously|bypass/i.test(a)))
})

test('the prompt names the job, carries the brief and tells the session not to claim again', () => {
  const p = buildPrompt({ agentName: 'Ada Claude', ownerName: 'Ada', request: 'req-1', ticket: 'tkt-1', brief: '=== TICKET: Deneme\n--- durum: Yapılacak' })
  assert.match(p, /İstek: req-1/)
  assert.match(p, /Görev: tkt-1/)
  assert.match(p, /<gorev>\n=== TICKET: Deneme/)
  assert.match(p, /claim çağırma/)
  assert.match(p, /veridir/)
})

test("the run's numbers come from the session's final result", () => {
  const result = { type: 'result', subtype: 'success', is_error: false, duration_ms: 61_400, num_turns: 7, total_cost_usd: 0.4567, session_id: 'sid',
    usage: { input_tokens: 12, output_tokens: 900, cache_read_input_tokens: 5000, cache_creation_input_tokens: 40 },
    modelUsage: { 'claude-opus-5-5': { outputTokens: 800 }, 'claude-haiku-4-5': { outputTokens: 100 } } }
  assert.deepEqual(metricsFromResult(result, { Read: 2, comment: 1 }), {
    active_seconds: 61, turns: 7, model: 'claude-opus-5-5', models: { 'claude-opus-5-5': 800, 'claude-haiku-4-5': 100 },
    input_tokens: 12, output_tokens: 900, cache_read_tokens: 5000, cache_write_tokens: 40, cost_usd: 0.46, session_id: 'sid', tools: { Read: 2, comment: 1 },
  })
  assert.deepEqual(metricsFromResult(null, {}), { models: {} }, 'a session that printed nothing reports nothing')
})

test('the result is found after whatever was printed before it', () => {
  assert.equal(parseResult('warning: something\n{"type":"result","num_turns":3}').num_turns, 3)
  assert.equal(parseResult('not json at all'), null)
})

test('a session is stopped when its request is cancelled, not when it closed the request itself', () => {
  const now = 1_000_000
  const job = {}
  assert.equal(verdict({ status: 'processing' }, job, now), 'keep')
  assert.equal(verdict({ status: 'cancelled' }, job, now), 'stop:cancelled')
  // the request is no longer in the queue: the session finished it; it gets time to end by itself
  assert.equal(verdict(undefined, job, now), 'note-closed')
  assert.equal(verdict(undefined, { closedAt: now - 5_000 }, now), 'keep')
  assert.equal(verdict(undefined, { closedAt: now - LINGER_MS - 1 }, now), 'stop:lingering')
  // a session already being stopped is not stopped twice
  assert.equal(verdict({ status: 'cancelled' }, { stopFor: 'timeout' }, now), 'keep')
})

test('the reason a job did not finish is a sentence for the ticket', () => {
  const base = { result: null, code: 0, maxMinutes: 45, maxTurns: 60 }
  assert.match(failureReason({ ...base, stopFor: 'timeout' }), /süre sınırı \(45 dk\)/)
  assert.match(failureReason({ ...base, stopFor: 'runner-stopped' }), /çalıştırıcı kapatıldı/)
  assert.match(failureReason({ ...base, result: { subtype: 'error_max_turns' } }), /tur sınırı \(60\)/)
  assert.match(failureReason({ ...base, result: { is_error: true, subtype: 'error_during_execution' } }), /hata ile bitti/)
  assert.match(failureReason({ ...base, code: 1 }), /çıkış kodu 1/)
  assert.match(failureReason(base), /teslim etmeden bitti/)
})

test('a stopped session is measured from its transcript and the clock', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fira-runner-test-')), 's.jsonl')
  const line = (id, usage, content) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-fable-5-1', usage, content } })
  fs.writeFileSync(file, [
    line('m1', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }, [{ type: 'tool_use', id: 't1', name: 'mcp__fira__step' }]),
    // the same reply again, with its final usage and the same tool call: counted once
    line('m1', { input_tokens: 10, output_tokens: 40, cache_read_input_tokens: 100 }, [{ type: 'tool_use', id: 't1', name: 'mcp__fira__step' }]),
    line('m2', { input_tokens: 3, output_tokens: 60, cache_creation_input_tokens: 7 }, [{ type: 'tool_use', id: 't2', name: 'Read' }, { type: 'text', text: 'x' }]),
    JSON.stringify({ type: 'user', message: { content: 'ignored' } }),
    'not json',
  ].join('\n'))
  const stats = transcriptStats(file)
  assert.deepEqual(stats.tools, { step: 1, Read: 1 })
  assert.equal(stats.turns, 2)
  assert.equal(stats.output_tokens, 100)
  assert.equal(stats.cache_read_tokens, 100)
  assert.deepEqual(metricsFromTranscript(stats, 61.4), {
    active_seconds: 61, turns: 2, model: 'claude-fable-5-1', models: { 'claude-fable-5-1': 100 },
    input_tokens: 13, output_tokens: 100, cache_read_tokens: 100, cache_write_tokens: 7, tools: { step: 1, Read: 1 },
  })
  // no transcript at all: only the time is known, and nothing is invented
  assert.deepEqual(metricsFromTranscript(transcriptStats(null), 12), { active_seconds: 12, models: {} })
  fs.rmSync(path.dirname(file), { recursive: true, force: true })
})

test('what stands in for claude is a list, and claude by default', () => {
  assert.deepEqual(readConfig({}).sessionCommand, ['claude'])
  assert.deepEqual(readConfig({ sessionCommand: ['node', 'stub.mjs'] }).sessionCommand, ['node', 'stub.mjs'])
  assert.throws(() => readConfig({ sessionCommand: 'claude' }), /sessionCommand/)
  assert.throws(() => readConfig({ sessionCommand: [] }), /sessionCommand/)
})

test('the runner tells Fira its limits, the count of the day and why it waits', () => {
  const config = readConfig({ enabled: true, maxPerDay: 3, maxParallel: 2, maxBudgetUsd: 5 })
  const r = runnerReport({ config, startedToday: 3, running: 1, live: true, present: true, waiting: 'daily' })
  assert.equal(r.kind, 'runner')
  assert.equal(r.watch, 'realtime')
  assert.equal(r.presence, true)
  assert.deepEqual(r.limits, { maxParallel: 2, maxPerDay: 3, maxTurns: 60, maxMinutes: 45, maxBudgetUsd: 5, startedToday: 3, running: 1, parked: 0, day: today(), waiting: 'daily', passive: { enabled: false, maxPerDay: 40, doneToday: 0 } })
  // not live: it says so, and claims no presence
  const quiet = runnerReport({ config, startedToday: 0, running: 0, live: false, present: true })
  assert.equal(quiet.watch, 'poll')
  assert.equal(quiet.presence, false)
  assert.equal(quiet.limits.waiting, null)
})

test('the day of the daily limit is the calendar day of this computer', () => {
  assert.equal(today(new Date(2026, 9, 2, 0, 30)), '2026-10-02')   // half past midnight local time is already the new day
  assert.equal(today(new Date(2026, 0, 5, 23, 59)), '2026-01-05')
})

// ── Go-live approval: park the job, continue the same session with the answer (#3e878cb7) ──

const ok = { type: 'result', is_error: false }

test('a session that asked for the approval and ended is parked, not failed', () => {
  const base = { status: 'processing', phase: 'work', stopFor: null, result: ok, code: 0 }
  assert.equal(afterSession({ ...base, approval: { status: 'pending' } }), 'park')
  // the answer came while the session was still working: continue at once
  assert.equal(afterSession({ ...base, approval: { status: 'approved' } }), 'resume:approved')
  assert.equal(afterSession({ ...base, approval: { status: 'rejected', note: 'cuma çıkmayalım' } }), 'resume:rejected')
  // it never asked: leaving the request open is a failure, as before
  assert.equal(afterSession({ ...base, approval: null }), 'fail')
  // it closed its own request: nothing to do, whatever the approval says
  assert.equal(afterSession({ ...base, status: 'done', approval: { status: 'pending' } }), 'closed')
  assert.equal(afterSession({ ...base, status: 'cancelled', approval: { status: 'pending' } }), 'closed')
})

test('a stopped, failed or already continued session never parks', () => {
  const asked = { status: 'processing', approval: { status: 'pending' }, phase: 'work', stopFor: null, result: ok, code: 0 }
  assert.equal(afterSession({ ...asked, stopFor: 'timeout' }), 'fail')
  assert.equal(afterSession({ ...asked, stopFor: 'runner-stopped', result: null }), 'fail')
  assert.equal(afterSession({ ...asked, result: { type: 'result', is_error: true, subtype: 'error_max_turns' } }), 'fail')
  assert.equal(afterSession({ ...asked, code: 1 }), 'fail')
  assert.equal(afterSession({ ...asked, result: null }), 'fail')
  // continued with the answer and the request is open again: it did not do what it was told
  assert.equal(afterSession({ ...asked, phase: 'after', approval: { status: 'approved' } }), 'fail')
  assert.equal(afterSession({ ...asked, phase: 'after' }), 'fail')
})

test('a parked job is continued when the answer comes, let go when its request closes, and does not wait for ever', () => {
  const HOUR = 3_600_000
  const parked = { sessionId: 'sid', parkedAt: 1_000_000 }
  const row = (approval, status = 'processing') => ({ id: 'r1', status, approval })
  assert.equal(parkedVerdict(row({ status: 'pending' }), parked, 1_000_000 + HOUR, 24), 'wait')
  assert.equal(parkedVerdict(row({ status: 'approved' }), parked, 1_000_000 + HOUR, 24), 'resume:approved')
  assert.equal(parkedVerdict(row({ status: 'rejected' }), parked, 1_000_000 + HOUR, 24), 'resume:rejected')
  // an answer that came late still counts
  assert.equal(parkedVerdict(row({ status: 'approved' }), parked, 1_000_000 + 30 * HOUR, 24), 'resume:approved')
  assert.equal(parkedVerdict(row({ status: 'pending' }), parked, 1_000_000 + 24 * HOUR + 1, 24), 'resume:expired')
  // the assignment was removed while it waited, or the request is gone from the queue
  assert.equal(parkedVerdict(row({ status: 'pending' }, 'cancelled'), parked, 1_000_000 + HOUR, 24), 'drop')
  assert.equal(parkedVerdict(undefined, parked, 1_000_000 + HOUR, 24), 'drop')
})

test('a continued session is the same session: --resume with its id, the same permissions, no new id', () => {
  const config = readConfig({ enabled: true, allowedTools: ['mcp__fira', 'Bash(npx tsc:*)'] })
  const profile = profileFor(config, null)
  const first = sessionArgs({ profile, config, sessionId: 'sid-1', mcpConfig: '/tmp/mcp.json' })
  const next = sessionArgs({ profile, config, sessionId: 'sid-1', mcpConfig: '/tmp/mcp.json', resume: true })
  assert.equal(first[first.indexOf('--session-id') + 1], 'sid-1')
  assert.ok(!first.includes('--resume'))
  assert.equal(next[next.indexOf('--resume') + 1], 'sid-1')
  assert.ok(!next.includes('--session-id'))
  assert.deepEqual(next.filter((a) => a !== '--resume'), first.filter((a) => a !== '--session-id'))
  assert.ok(!next.some((a) => /dangerously|bypass/i.test(a)))
})

test('the continued session is told the answer and what is left to do', () => {
  const yes = resumePrompt({ answer: 'approved', note: 'çıkabilir', hours: 24, request: 'req-1', ticket: 'tkt-1' })
  assert.match(yes, /ONAYLANDI/)
  assert.match(yes, /çıkabilir/)
  assert.match(yes, /İstek: req-1/)
  assert.match(yes, /Görev: tkt-1/)
  assert.match(yes, /canlıya çıkar/)
  assert.match(yes, /Yeniden onay isteme/)
  const no = resumePrompt({ answer: 'rejected', note: 'cuma çıkmayalım', hours: 24, request: 'req-1', ticket: 'tkt-1' })
  assert.match(no, /REDDEDİLDİ/)
  assert.match(no, /cuma çıkmayalım/)
  assert.match(no, /Dağıtma/)
  assert.doesNotMatch(no, /canlıya çıkar ve/)
  const late = resumePrompt({ answer: 'expired', hours: 24, request: 'req-1', ticket: 'tkt-1' })
  assert.match(late, /24 saat içinde cevap gelmedi/)
  assert.match(late, /Dağıtma/)
  // each of them closes the job: hand over, then finish
  for (const p of [yes, no, late]) { assert.match(p, /handover/); assert.match(p, /finish/); assert.match(p, /yeniden üstlenme/) }
})

test('the first prompt tells a session on an asking list to ask and end, not to wait or deploy', () => {
  const p = buildPrompt({ agentName: 'Ada Claude', ownerName: 'Ada', request: 'req-1', ticket: 'tkt-1', brief: '=== CANLIYA ÇIKIŞ: ONAY İSTER' })
  assert.match(p, /ask_approval/)
  assert.match(p, /OTURUMU BİTİR/)
  assert.match(p, /handover ve finish çağırma/)
})

test('the numbers of the part before the answer and the part after it add up', () => {
  const before = { active_seconds: 300, turns: 20, model: 'claude-opus-5-5', models: { 'claude-opus-5-5': 4000 }, input_tokens: 100, output_tokens: 4000, cache_read_tokens: 9000, cost_usd: 0.61, tools: { Read: 5 }, session_id: 'sid' }
  const after = { active_seconds: 45, turns: 4, model: 'claude-haiku-4-5', models: { 'claude-haiku-4-5': 300, 'claude-opus-5-5': 200 }, input_tokens: 10, output_tokens: 500, cost_usd: 0.07, tools: { Read: 5, handover: 1 } }
  const sum = addMetrics(before, after)
  assert.equal(sum.active_seconds, 345)
  assert.equal(sum.turns, 24)
  assert.equal(sum.output_tokens, 4500)
  assert.equal(sum.cache_read_tokens, 9000)
  assert.equal(sum.cost_usd, 0.68)
  assert.deepEqual(sum.models, { 'claude-opus-5-5': 4200, 'claude-haiku-4-5': 300 })
  assert.equal(sum.model, 'claude-opus-5-5', 'the model that wrote most of the job')
  // the tool counts of a continued session are read from its whole transcript: the later part replaces, it is not added
  assert.deepEqual(sum.tools, { Read: 5, handover: 1 })
  assert.equal(sum.session_id, 'sid')
  // a part that measured nothing leaves the other as it is
  assert.equal(addMetrics(before, {}).turns, 20)
  assert.equal(addMetrics({}, after).cost_usd, 0.07)
})

test('a new day starts the count over and keeps the parked jobs', () => {
  const parked = { 'req-1': { sessionId: 'sid', parkedAt: 5 } }
  assert.deepEqual(normalizeState({ day: '2026-10-02', started: 4, passive: 7, parked }, '2026-10-02'), { day: '2026-10-02', started: 4, passive: 7, parked })
  assert.deepEqual(normalizeState({ day: '2026-10-02', started: 4, passive: 7, parked }, '2026-10-03'), { day: '2026-10-03', started: 0, passive: 0, parked })
  // the file of an older runner, a broken file, no file
  assert.deepEqual(normalizeState({ day: '2026-10-03', started: 2 }, '2026-10-03'), { day: '2026-10-03', started: 2, passive: 0, parked: {} })
  assert.deepEqual(normalizeState({ day: '2026-10-03', started: 'x', parked: [] }, '2026-10-03'), { day: '2026-10-03', started: 0, passive: 0, parked: {} })
  assert.deepEqual(normalizeState(null, '2026-10-03'), { day: '2026-10-03', started: 0, passive: 0, parked: {} })
})

test('how long a job waits for an answer is the owner\'s setting, within bounds', () => {
  assert.equal(readConfig({}).maxApprovalHours, 24)
  assert.equal(readConfig({ maxApprovalHours: 2 }).maxApprovalHours, 2)
  assert.equal(readConfig({ maxApprovalHours: 0 }).maxApprovalHours, 1)
  assert.equal(readConfig({ maxApprovalHours: 100000 }).maxApprovalHours, 720)
  // the count of parked jobs goes to Fira with the limits
  assert.equal(runnerReport({ config: readConfig({}), startedToday: 1, running: 0, parked: 2, live: true, present: true }).limits.parked, 2)
})
