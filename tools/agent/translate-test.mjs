// Run with: node --test tools/agent/translate-test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_TRANSLATE_CHARS, TRANSLATE_SCHEMA, foreign, guessLang, protect, restore, translateJob, translateMessage } from './translate.mjs'
import { createPassiveWorker, passiveArgs, parseTranslation, readPassive } from './passive.mjs'

const SAMPLE = [
  'Please check `npm run build` before merging, see [the guide](https://docs.example.com/build "Build") and ping [@Elif Kaya](fira://u/1e11ee2f-0000-4000-8000-000000000001).',
  '',
  '```ts',
  'const answer = 42 // do not translate me',
  '```',
  '',
  '![screenshot.png](https://fira.example/api/storage/v1/object/public/a/b.png "w=360")',
  '',
  '| Step | Result |',
  '|---|---|',
  '| Open https://example.com/login. | ok |',
  '{width=900px}',
  'Mail me: ops@example.com or <https://status.example.com>.<br>',
].join('\n')

test('what must not be translated is taken out, and what is left has no code and no address', () => {
  const { masked, parts } = protect(SAMPLE)
  assert.equal(parts.length, 10)
  for (const gone of ['npm run build', 'https://', 'fira://', 'const answer', '```', 'Elif Kaya', 'width=', 'ops@example.com', '<br>']) assert.ok(!masked.includes(gone), `"${gone}" is still in the text`)
  // the words of a link, the table and the prose stay
  for (const kept of ['Please check', '[the guide](⟦', 'before merging', '| Step | Result |', 'Mail me:']) assert.ok(masked.includes(kept), `"${kept}" is gone`)
  // the full stop after a bare address is the sentence's, not the address's
  assert.match(masked, /Open ⟦\d+⟧\. \|/)
  assert.deepEqual(parts.filter((p) => p.kind === 'code').map((p) => p.text.split('\n')[0]), ['```ts', '`npm run build`', '{width=900px}'])
})

test('putting the parts back gives the text again, also when the marks changed places', () => {
  const { masked, parts } = protect(SAMPLE)
  assert.deepEqual(restore(masked, parts), { ok: true, text: SAMPLE })
  const two = protect('Run `a` then `b`.')
  assert.equal(restore('Önce ⟦1⟧, sonra ⟦0⟧ çalıştır.', two.parts).text, 'Önce `b`, sonra `a` çalıştır.')
})

test('a code block that is never closed, an empty one and one inside a list are code', () => {
  assert.equal(protect('Before\n```\n```\nAfter').masked, 'Before\n⟦0⟧\nAfter')
  assert.equal(protect('Before\n```js\nlet a\n\nlet b\n```\nAfter `x`').masked, 'Before\n⟦0⟧\nAfter ⟦1⟧')
  assert.equal(protect('Text\n~~~\nopen to the end').masked, 'Text\n⟦0⟧')
  assert.equal(protect('- item\n  ```\n  code\n  ```\n- next').masked, '- item\n⟦0⟧\n- next')
})

test('a translation that lost, repeated or invented a mark is refused', () => {
  const { parts } = protect('Run `a` then `b`.')
  assert.match(restore('Önce ⟦0⟧ çalıştır.', parts).error, /eksik \(⟦1⟧\)/)
  assert.match(restore('⟦0⟧ ⟦0⟧ ⟦1⟧', parts).error, /yinelenmiş/)
  assert.match(restore('⟦0⟧ ⟦1⟧ ⟦2⟧', parts).error, /kaynakta olmayan yer tutucu/)
  assert.match(restore('⟦0⟧ ⟦1⟧ ⟦x', parts).error, /bozuk/)
})

test('a translation cannot carry a link, a picture, a mention or a tag the text did not have', () => {
  const { parts } = protect('See [the guide](https://docs.example.com).')
  assert.equal(restore('Bkz. [kılavuz](⟦0⟧).', parts).text, 'Bkz. [kılavuz](https://docs.example.com).')
  for (const planted of [
    'Bkz. [kılavuz](⟦0⟧). Ayrıca https://evil.test/a',
    'Bkz. [kılavuz](⟦0⟧) ve [buraya tıkla](https://evil.test)',
    'Bkz. [kılavuz](⟦0⟧) ![x](https://evil.test/p.png)',
    'Bkz. [kılavuz](⟦0⟧) [@Yönetici](fira://u/123)',
    'Bkz. [kılavuz](⟦0⟧) <a href="x">tık</a>',
    'Bkz. [kılavuz](⟦0⟧) www.evil.test',
    'Bkz. [kılavuz](⟦0⟧ "başlık")',
    'Bkz. [kılavuz](⟦0⟧), yaz: destek@evil.test',
  ]) assert.match(restore(planted, parts).error ?? '', /kaynakta olmayan bağlantı/, planted)
  assert.deepEqual(foreign('Düz metin, `kod` da olur.'), [])
})

test('the guess is sure only when the text is plainly in one language', () => {
  const sure = (s) => { const g = guessLang(s); return g.sure ? g.lang : `?${g.lang ?? ''}` }
  assert.equal(sure('Bu görev için açıklama yazıldı, lütfen kontrol edin ve onaylayın.'), 'tr')
  assert.equal(sure('Giriş ekranındaki düğme çalışmıyor, yarın bakacağım.'), 'tr')
  assert.equal(sure('Please check that the build is green before we merge this.'), 'en')
  assert.equal(sure('Looks good to me.'), 'en')
  assert.equal(sure('Bitte prüfen, ob das stimmt und nicht nur auf dem Testsystem.'), 'de')
  // short Turkish sentences without a single small word: the endings and the letters say it
  for (const s of ['Tüm görselleri WebP\'ye çevir, boyutları küçült.', 'Eski adreslerden yeni sayfalara kalıcı yönlendirme.', 'Yasal metinle birlikte çerez tercih penceresi, yeni tasarımla.',
    'Taslak ekte; geri bildirimlerinizi bekliyorum.', 'Görselleri güncelledim; yeni taslak Dosyalar bölümünde.']) assert.equal(sure(s), 'tr', s)
  // a word is one sign, however many ways it shows its language
  assert.match(sure('yapıldı'), /^\?/)
  // neighbours and look-alikes of Turkish are not Turkish
  assert.match(sure('Bu gün hava çox yaxşıdır, mən işləyirəm və sonra gələcəyəm.'), /^\?/)
  assert.match(sure('Las galerías de la señora Lara están cerradas por obras.'), /^\?/)
  assert.match(sure('Le gallerie sono chiuse per lavori, torneremo presto.'), /^\?/)
  assert.match(sure('The controller and the handler are similar in this compiler.'), /^en$/)
  // short, mixed or in a fourth language: not sure, the model is asked
  assert.match(sure('Tamam'), /^\?/)
  assert.match(sure('ok'), /^\?/)
  assert.match(sure('LGTM 👍'), /^\?/)
  assert.match(sure('Merci de ne pas modifier ce fichier.'), /^\?/)
  assert.match(sure('De wijziging is klaar en staat op de testserver.'), /^\?/)
  assert.match(sure('Bu kısım tamam. The rest of the work is not done and we should talk about it.'), /^\?/)
  assert.match(sure('Det här är en svensk mening med många ord, är det så?'), /^\?/)
  assert.deepEqual(guessLang(''), { lang: null, sure: false })
  // an English "I" is not a Turkish letter
  assert.equal(sure('I think it is fine and we can ship it.'), 'en')
})

test('the call asks for the language and a translation, and names the languages to leave alone', () => {
  const line = JSON.parse(translateMessage('Hello ⟦0⟧', 'tr', ['tr', 'en']))
  const text = line.message.content[0].text
  assert.equal(line.message.content.length, 1)
  assert.match(text, /şunlardan biriyse çevirme, "translation" = null yaz: tr, en\./)
  assert.match(text, /Türkçe \(tr\) çevirisi/)
  assert.match(text, /<metin>\nHello ⟦0⟧\n<\/metin>$/)
  const args = passiveArgs({ model: 'haiku' }, 'translate')
  assert.equal(args[args.indexOf('--tools') + 1], '', 'no tool')
  assert.deepEqual(JSON.parse(args[args.indexOf('--json-schema') + 1]), TRANSLATE_SCHEMA)
  assert.match(args[args.indexOf('--system-prompt') + 1], /çevirmensin/)
  assert.ok(args.includes('--no-session-persistence') && args.includes('--strict-mcp-config'))
})

const answer = (value, extra = {}) => async () => ({ ok: true, value, model: 'stub-model', usage: { ms: 7, cost_usd: 0.001 }, ...extra })
const never = async () => { throw new Error('the model was called') }

test('a text in a language its readers read is settled without a call', async () => {
  const job = { target: 'tr', skip: ['tr'], text: 'Bu görev için açıklama yazıldı, lütfen kontrol edin ve onaylayın.' }
  assert.deepEqual(await translateJob(job, never), { save: { lang: 'tr', text: null }, called: false })
  // English is fine for the German readers of this team
  assert.deepEqual(await translateJob({ target: 'de', skip: ['de', 'en'], text: 'Please check that the build is green before we merge this.' }, never), { save: { lang: 'en', text: null }, called: false })
  // nothing but code and a picture: nothing to translate
  assert.deepEqual(await translateJob({ target: 'tr', skip: ['tr'], text: '`x = 1`\n\n![a.png](https://x.test/a.png)' }, never), { save: { lang: null, text: null }, called: false })
})

test('a text in another language is translated, with its code and links put back', async () => {
  const job = { target: 'tr', skip: ['tr'], text: 'Please run `npm test` and read [the guide](https://docs.example.com) before we merge this.' }
  let asked = null
  const out = await translateJob(job, async (input) => { asked = JSON.parse(input).message.content[0].text; return answer({ lang: 'en', translation: 'Birleştirmeden önce lütfen ⟦0⟧ çalıştırın ve [kılavuzu](⟦1⟧) okuyun.' })() })
  assert.ok(!asked.includes('npm test') && !asked.includes('docs.example.com'), 'the code and the address never reach the model')
  assert.deepEqual(out, { save: { lang: 'en', text: 'Birleştirmeden önce lütfen `npm test` çalıştırın ve [kılavuzu](https://docs.example.com) okuyun.', model: 'stub-model', ms: 7, cost_usd: 0.001 }, called: true })
})

test('what the model says decides when the guess was not sure', async () => {
  const short = { target: 'tr', skip: ['tr'], text: 'Tamamdır.' }
  assert.deepEqual(await translateJob(short, answer({ lang: 'TR', translation: null })), { save: { lang: 'tr', text: null, model: 'stub-model', ms: 7, cost_usd: 0.001 }, called: true })
  // it translated although the language is one to skip: the translation is not kept
  assert.equal((await translateJob(short, answer({ lang: 'tr', translation: 'Tamamdır.' }))).save.text, null)
  // no translation and a language that needs one: a failure, to be tried again
  assert.deepEqual(await translateJob({ target: 'tr', skip: ['tr'], text: 'Hallo zusammen' }, answer({ lang: 'de', translation: null })), { fail: 'çeviri gelmedi (dil: de)', skip: false, called: true })
  assert.match((await translateJob({ target: 'tr', skip: ['tr'], text: 'Hallo zusammen' }, answer({ lang: 'de', translation: 'Hallo zusammen' }))).fail, /kaynakla aynı/)
  assert.match((await translateJob({ target: 'tr', skip: ['tr'], text: 'Run `a` now, bitte.' }, answer({ lang: 'en', translation: 'Şimdi çalıştır.' }))).fail, /yer tutucu eksik/)
  assert.deepEqual(await translateJob({ target: 'tr', skip: ['tr'], text: 'Hallo zusammen' }, async () => ({ ok: false, error: 'süre sınırı aşıldı' })), { fail: 'süre sınırı aşıldı', skip: false, called: true })
  // a language code with a region is its language
  assert.equal((await translateJob({ target: 'tr', skip: ['tr'], text: 'Olá a todos' }, answer({ lang: 'pt-BR', translation: 'Herkese merhaba' }))).save.lang, 'pt')
})

test('a text that cannot be a job is left alone for good, without a call', async () => {
  assert.deepEqual(await translateJob({ target: 'tr', skip: [], text: 'x'.repeat(MAX_TRANSLATE_CHARS + 1) }, never), { fail: `metin çok uzun (${MAX_TRANSLATE_CHARS + 1} karakter)`, skip: true, called: false })
  assert.equal((await translateJob({ target: 'tr', skip: [], text: 'Bu metinde ⟦0⟧ işareti var, bitte.' }, never)).skip, true)
  assert.equal((await translateJob({ target: '', skip: [], text: 'Hello there' }, never)).skip, true)
})

test('the answer of a translation call is read from the result line', () => {
  const line = (o) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 900, total_cost_usd: 0.002, modelUsage: { 'claude-haiku-4-5': { outputTokens: 40 } }, ...o })
  assert.deepEqual(parseTranslation(line({ structured_output: { lang: 'en', translation: 'Merhaba' } })), { ok: true, value: { lang: 'en', translation: 'Merhaba' }, model: 'claude-haiku-4-5', usage: { cost_usd: 0.002, ms: 900 } })
  assert.equal(parseTranslation(line({ structured_output: { text: 'a picture answer', description: '', lang: 'tr' } })).ok, false)
  assert.equal(parseTranslation('').ok, false)
})

test('the owner can lend the subscription to one kind of job only', () => {
  assert.deepEqual(readPassive({ enabled: true }).jobs, ['image_text', 'translate'])
  assert.deepEqual(readPassive({ enabled: true, jobs: ['translate'] }).jobs, ['translate'])
  assert.deepEqual(readPassive({ enabled: true, jobs: [] }).jobs, [])
  assert.throws(() => readPassive({ jobs: ['delete_everything'] }), /passive\.jobs/)
  assert.throws(() => readPassive({ jobs: 'translate' }), /passive\.jobs/)
})

// ── The worker, with the stub session and a made-up server ───────────────────────────────────────
const STUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runner-stub.mjs')
function setup(queue, { how = 'ok', lang = 'en', jobs, pictures = [] } = {}) {
  const calls = [], said = []
  const d = {
    rpc: async (fn, args) => {
      calls.push([fn, args])
      if (fn === 'agent_passive_next') return pictures.shift() ?? null
      if (fn === 'agent_translate_next') return queue.shift() ?? null
      if (fn === 'agent_translate_save' && args.p_id === 'gone') throw new Error('Bu iş sende değil ya da artık sürmüyor.')
      return true
    },
    note: (m) => said.push(m),
  }
  let done = 0
  const worker = createPassiveWorker({
    d, config: { sessionCommand: [process.execPath, STUB, '--stub-passive', how, '--stub-lang', lang], passive: readPassive({ enabled: true, maxPerDay: 5, ...(jobs ? { jobs } : {}) }) },
    count: () => done, bump: () => { done++ }, idle: () => ({ activeJobs: 0, pendingJobs: 0 }),
  })
  const lines = []
  const log = console.log
  const step = async () => { console.log = (...a) => lines.push(a.join(' ')); try { return await worker.step() } finally { console.log = log } }
  return { worker, step, calls, lines, share: () => done, saves: () => calls.filter(([fn]) => fn === 'agent_translate_save').map(([, a]) => a), fails: () => calls.filter(([fn]) => fn === 'agent_translate_fail').map(([, a]) => a) }
}
const TR = 'Bu görev için açıklama yazıldı, lütfen kontrol edin ve onaylayın.'
const job = (id, text, more = {}) => ({ id, kind: 'translate', field: 'comment', target: 'tr', skip: ['tr'], text, ticket_title: 'Deneme görevi', ...more })

test('worker: texts that need no call are settled in a row and use none of the day\'s share; the first that needs one gets it', async () => {
  const s = setup([job('a', TR), job('b', `${TR} Evet.`), job('c', 'Please run `npm test` before we merge this.'), job('d', TR)])
  try {
    assert.equal(await s.step(), 'done')
    assert.deepEqual(s.saves().map((a) => [a.p_id, a.p_result.lang, a.p_result.text]), [['a', 'tr', null], ['b', 'tr', null], ['c', 'en', 'ÇEVİRİ: Please run `npm test` before we merge this.']])
    assert.equal(s.saves()[0].p_result.ms, undefined, 'no call, no time')
    assert.equal(s.saves()[2].p_result.ms, 5)
    assert.equal(s.share(), 1, 'one call, one of the day\'s share')
    assert.deepEqual(s.lines, ['AI_PASSIVE_NONE translate|2', 'AI_PASSIVE_DONE translate|yorum → tr|Deneme görevi'])
    assert.equal(await s.step(), 'done')   // d settles by itself, then the queue is empty
    assert.equal(await s.step(), 'none')
    assert.equal(s.share(), 1)
  } finally { s.worker.stop() }
})

test('worker: a translation that dropped a mark or planted a link is written as a failure, not as a translation', async () => {
  for (const [how, why] of [['lost', /yer tutucu eksik/], ['link', /kaynakta olmayan bağlantı/], ['bad', /beklenen biçimde değil/], ['error', /hata ile bitti/]]) {
    const s = setup([job('x', 'Please run `npm test` before we merge this.')], { how })
    try {
      assert.equal(await s.step(), 'failed', how)
      assert.equal(s.saves().length, 0, how)
      assert.match(s.fails()[0].p_error, why, how)
      assert.equal(s.fails()[0].p_skip, false)
      assert.equal(s.share(), 1)
    } finally { s.worker.stop() }
  }
})

test('worker: "needs no translation" from the model is kept with what the call took', async () => {
  const s = setup([job('x', 'Tamamdır.')], { how: 'same', lang: 'tr' })
  try {
    assert.equal(await s.step(), 'done')
    assert.deepEqual(s.saves()[0].p_result, { lang: 'tr', text: null, model: 'stub-model', ms: 5, cost_usd: 0 })
    assert.deepEqual(s.lines, ['AI_PASSIVE_DONE translate|yorum → tr|Deneme görevi|çeviri gerekmiyor (tr)'])
  } finally { s.worker.stop() }
})

test('worker: a text too long is left for good and the next one is taken; a result for a text that changed is a failure', async () => {
  const s = setup([job('long', 'x'.repeat(MAX_TRANSLATE_CHARS + 1)), job('gone', 'Please run the tests before we merge this.')])
  try {
    assert.equal(await s.step(), 'failed')
    assert.deepEqual(s.fails().map((a) => [a.p_id, a.p_skip]), [['long', true]])
    assert.match(s.lines[0], /^AI_PASSIVE_FAILED translate\|yorum → tr\|Deneme görevi\|metin çok uzun .* \(bir daha denenmez\)$/)
    assert.match(s.lines[1], /sonuç yazılamadı/)
  } finally { s.worker.stop() }
})

test('worker: pictures come first; a kind the owner did not lend to is not asked for', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fira-translate-test-'))
  const s = setup([job('t', 'Please run the tests before we merge this.')], { pictures: [{ id: 'p', kind: 'image_text', file_name: 'a.png', file_url: 'data:image/png;base64,iVBORw0KGgo=', ticket_title: 'Deneme' }] })
  const only = setup([job('t', TR)], { jobs: ['image_text'] })
  try {
    assert.equal(await s.step(), 'done')
    assert.deepEqual(s.calls.map(([fn]) => fn), ['agent_passive_next', 'agent_passive_save'])
    assert.equal(await s.step(), 'done')
    assert.deepEqual(s.calls.slice(2).map(([fn]) => fn), ['agent_passive_next', 'agent_translate_next', 'agent_translate_save'])
    assert.equal(await only.step(), 'none')
    assert.deepEqual(only.calls.map(([fn]) => fn), ['agent_passive_next'])
  } finally { s.worker.stop(); only.worker.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('worker: when the way to the jobs fails the step says so and the loop rests', async () => {
  const said = []
  const worker = createPassiveWorker({
    d: { rpc: async () => { throw new Error('fetch failed') }, note: (m) => said.push(m) },
    config: { sessionCommand: [process.execPath, STUB], passive: readPassive({ enabled: true }) },
    count: () => 0, bump: () => {}, idle: () => ({ activeJobs: 0, pendingJobs: 0 }),
  })
  assert.equal(await worker.step(), 'error')
  assert.match(said[0], /pasif iş yapılamadı: fetch failed/)
})
