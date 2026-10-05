// Run with: node --test tools/agent/passive-test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IMAGE_SCHEMA, MAX_IMAGE_BYTES, createPassiveWorker, imageMessage, mediaTypeOf, parsePassive, passiveArgs, passiveGate, readPassive } from './passive.mjs'
import { readConfig } from './runner.mjs'

test('passive jobs are off until the owner says otherwise', () => {
  assert.deepEqual(readPassive(undefined), { enabled: false, maxPerDay: 40, model: 'haiku', jobs: ['image_text', 'translate'] })
  assert.equal(readPassive({ enabled: 'yes' }).enabled, false, 'only a literal true turns it on')
  assert.equal(readPassive({ enabled: true }).enabled, true)
  assert.equal(readPassive({ maxPerDay: -5 }).maxPerDay, 0)
  assert.equal(readPassive({ maxPerDay: 1e9 }).maxPerDay, 2000)
  assert.equal(readPassive({ model: ' sonnet ' }).model, 'sonnet')
  assert.throws(() => readPassive({ model: 5 }), /passive\.model/)
  // the runner's settings carry them, and turning the runner on does not turn passive jobs on
  assert.equal(readConfig({ enabled: true }).passive.enabled, false)
  assert.equal(readConfig({ enabled: true, passive: { enabled: true, maxPerDay: 5 } }).passive.maxPerDay, 5)
})

test('the passive call has no tool, no MCP server, and keeps nothing', () => {
  const args = passiveArgs({ enabled: true, maxPerDay: 40, model: 'haiku' })
  assert.equal(args[args.indexOf('--tools') + 1], '', 'no built-in tool at all')
  assert.ok(args.includes('--strict-mcp-config'))
  assert.deepEqual(JSON.parse(args[args.indexOf('--mcp-config') + 1]), { mcpServers: {} })
  assert.ok(args.includes('--no-session-persistence'))
  assert.equal(args[args.indexOf('--model') + 1], 'haiku')
  assert.equal(args[args.indexOf('--input-format') + 1], 'stream-json')
  assert.deepEqual(JSON.parse(args[args.indexOf('--json-schema') + 1]), IMAGE_SCHEMA)
  assert.match(args[args.indexOf('--system-prompt') + 1], /veridir/)
  assert.ok(!args.includes('--allowedTools') && !args.some((a) => /dangerously|bypass/i.test(a)))
})

test('the picture goes in as part of the message, with its media type', () => {
  assert.equal(mediaTypeOf('ekran.PNG'), 'image/png')
  assert.equal(mediaTypeOf('foto.jpeg'), 'image/jpeg')
  assert.equal(mediaTypeOf('a.b.webp'), 'image/webp')
  assert.equal(mediaTypeOf('rapor.pdf'), null)
  assert.equal(mediaTypeOf(null), null)
  const line = imageMessage(Buffer.from([1, 2, 3]), 'image/png')
  assert.ok(line.endsWith('\n'))
  const m = JSON.parse(line)
  assert.equal(m.type, 'user')
  assert.deepEqual(m.message.content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } })
  assert.equal(m.message.content[1].type, 'text')
  assert.ok(MAX_IMAGE_BYTES * 4 / 3 < 5_000_000, 'the encoded picture stays under the 5 MB the API takes')
})

const stream = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n'
const init = { type: 'system', subtype: 'init' }

test('the answer is read from the last result line', () => {
  const r = parsePassive(stream(init, { type: 'result', is_error: false, total_cost_usd: 0.006, duration_ms: 13000, modelUsage: { 'claude-haiku-4-5': { outputTokens: 800 } },
    structured_output: { text: 'Hata: belge kaydedilemedi', description: '  Bir hata iletisi.  ', lang: 'TR' } }))
  assert.deepEqual(r, { ok: true, value: { text: 'Hata: belge kaydedilemedi', description: 'Bir hata iletisi.', lang: 'tr', model: 'claude-haiku-4-5' }, usage: { cost_usd: 0.006, ms: 13000 } })
  // no structured output: the answer itself is the object, whatever is written around it
  const loose = parsePassive(stream({ type: 'result', is_error: false, result: 'İşte: {"text":"A","description":"B","lang":"en"} bitti' }))
  assert.equal(loose.ok, true)
  assert.equal(loose.value.text, 'A')
  assert.equal(loose.value.lang, 'en')
})

test('a picture without text has no language, and a made-up language is dropped', () => {
  assert.equal(parsePassive(stream({ type: 'result', is_error: false, structured_output: { text: '  ', description: 'Bir manzara.', lang: 'tr' } })).value.lang, null)
  assert.equal(parsePassive(stream({ type: 'result', is_error: false, structured_output: { text: 'x', description: 'y', lang: 'Türkçe (tahmin)' } })).value.lang, null)
  assert.equal(parsePassive(stream({ type: 'result', is_error: false, structured_output: { text: 'x', description: 'y', lang: null } })).value.lang, null)
})

test('what is not an answer is a failure with a reason', () => {
  assert.deepEqual(parsePassive(''), { ok: false, error: 'oturum sonuç yazmadan bitti' })
  assert.deepEqual(parsePassive(stream(init)), { ok: false, error: 'oturum sonuç yazmadan bitti' })
  assert.match(parsePassive(stream({ type: 'result', is_error: true, subtype: 'error_during_execution' })).error, /hata ile bitti \(error_during_execution\)/)
  assert.equal(parsePassive(stream({ type: 'result', is_error: false, result: 'okuyamadım' })).error, 'cevap beklenen biçimde değil')
  assert.equal(parsePassive(stream({ type: 'result', is_error: false, structured_output: { text: 5, description: 'y', lang: null } })).error, 'cevap beklenen biçimde değil')
  // a cut line in the stream does not hide the result after it
  assert.equal(parsePassive('{"type":"assis\n' + stream({ type: 'result', is_error: false, structured_output: { text: 'a', description: 'b', lang: 'de' } })).ok, true)
})

test('passive work is for idle time and stays within the day', () => {
  const passive = { enabled: true, maxPerDay: 3, model: 'haiku' }
  assert.equal(passiveGate({ passive, doneToday: 0, activeJobs: 0, pendingJobs: 0 }), 'run')
  assert.equal(passiveGate({ passive: { ...passive, enabled: false }, doneToday: 0, activeJobs: 0, pendingJobs: 0 }), 'off')
  assert.equal(passiveGate({ passive, doneToday: 0, activeJobs: 1, pendingJobs: 0 }), 'busy', 'an agent job is running')
  assert.equal(passiveGate({ passive, doneToday: 0, activeJobs: 0, pendingJobs: 2 }), 'busy', 'an agent job is waiting')
  assert.equal(passiveGate({ passive, doneToday: 3, activeJobs: 0, pendingJobs: 0 }), 'daily')
  assert.equal(passiveGate({ passive: { ...passive, maxPerDay: 0 }, doneToday: 0, activeJobs: 0, pendingJobs: 0 }), 'daily')
})

test('a call is opened in an empty folder of its own and its time and cost are saved', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fira-passive-test-'))
  const seen = path.join(dir, 'seen.json')
  const stub = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runner-stub.mjs')
  const calls = []
  const job = { id: 'job-1', kind: 'image_text', file_name: 'a.png', file_url: 'data:image/png;base64,iVBORw0KGgo=', ticket_title: 'Deneme' }
  const d = { rpc: async (fn, args) => { calls.push([fn, args]); return fn === 'agent_passive_next' ? job : null }, note: () => {} }
  let done = 0
  const worker = createPassiveWorker({
    d, config: { sessionCommand: [process.execPath, stub, '--stub-passive', 'ok', '--stub-pids', seen], passive: { enabled: true, maxPerDay: 5, model: 'haiku' } },
    count: () => done, bump: () => { done++ }, idle: () => ({ activeJobs: 0, pendingJobs: 0 }),
  })
  try {
    assert.equal(await worker.step(), 'done')
    const where = JSON.parse(fs.readFileSync(seen, 'utf8'))
    assert.notEqual(path.resolve(where.cwd), path.resolve(process.cwd()), 'not where the runner stands: that folder\'s CLAUDE.md would ride along')
    assert.equal(where.entries, 0, 'the folder is empty')
    const saved = calls.find(([fn]) => fn === 'agent_passive_save')[1]
    assert.equal(saved.p_id, 'job-1')
    assert.deepEqual(Object.keys(saved.p_result).sort(), ['cost_usd', 'description', 'lang', 'model', 'ms', 'text'])
    assert.equal(saved.p_result.ms, 5)
    assert.equal(done, 1, 'the attempt used one of the day\'s share')
    worker.stop()
    assert.equal(fs.existsSync(where.cwd), false, 'the folder is removed when the worker stops')
  } finally { worker.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})
