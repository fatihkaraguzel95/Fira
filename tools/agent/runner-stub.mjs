/**
 * A stand-in for `claude` in the runner's own tests: it costs nothing and behaves the way the
 * test asks, so stopping a session (cancel, time limit) can be tried end to end against Fira.
 *
 * Put it in a TEST config's `sessionCommand`, never in ~/.fira-agent/runner.json:
 *   "sessionCommand": ["node", "<repo>/tools/agent/runner-stub.mjs", "--stub-mode", "sleep", "--stub-seconds", "300", "--stub-pids", "<file>"]
 *
 *   --stub-mode sleep    read the prompt, start a child process of its own (so the test can see
 *                        the whole tree being stopped), wait --stub-seconds, print a result, end
 *   --stub-mode finish   hand the job over and finish the request through fira-agent, linger
 *                        --stub-seconds, then end by itself (the runner must not stop it)
 *   --stub-mode ask      the go-live approval: started fresh, ask for the approval and end without
 *                        handing over (the runner parks the job); continued (`--resume <id>`), do what
 *                        the answer in the prompt says — hand over as deployed on a yes, as not
 *                        deployed otherwise — and finish the request
 *   --stub-passive ok|bad|error|same|lost|link
 *                        a passive call (the runner passes --input-format stream-json): answer with a
 *                        structured result, with something that is not the asked shape, or with an error.
 *                        A translation call (told apart by the asked answer) gets "ÇEVİRİ: <the text>";
 *                        same = "needs no translation", lost = a mark dropped, link = a link added
 *   --stub-lang <code>   the language a translation call says the text is in (default en)
 *   --stub-pids <file>   where to write { pid, child, request, ticket } and, at a normal end, "ended": true;
 *                        in `ask` mode also every invocation: { resumed, session, answer };
 *                        in a passive call: { passive, cwd, entries } (where it was opened, what was there)
 *
 * Everything else on the command line is the runner's arguments for claude and is ignored.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback }
const mode = arg('--stub-mode', 'sleep')
const seconds = Number(arg('--stub-seconds', '30'))
const pidFile = arg('--stub-pids', null)
const resumed = arg('--resume', null)
const sessionId = arg('--session-id', resumed)

let prompt = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) prompt += chunk

// A passive call: one message in, one result line out; no child process, no Fira call.
if (process.argv.includes('--input-format')) {
  const how = arg('--stub-passive', 'ok')
  let picture = false
  try { picture = JSON.parse(prompt).message.content.some((c) => c.type === 'image' && c.source?.data?.length > 0) } catch { /* not the expected line */ }
  const base = { type: 'result', subtype: how === 'error' ? 'error_during_execution' : 'success', is_error: how === 'error', duration_ms: 5, num_turns: 1, total_cost_usd: 0, modelUsage: { 'stub-model': { outputTokens: 1 } } }
  // A translation call is told apart by the answer it asks for; the text is between the <metin> lines.
  const translating = (arg('--json-schema', '') ?? '').includes('"translation"')
  let source = ''
  try { source = JSON.parse(prompt).message.content.find((c) => c.type === 'text').text.match(/<metin>\n([\s\S]*)\n<\/metin>/)?.[1] ?? '' } catch { /* not the expected line */ }
  const lang = arg('--stub-lang', 'en')
  const answer = !translating ? { text: picture ? 'TAKLİT METİN' : '', description: 'Taklit oturumun anlatımı.', lang: 'tr' }
    : how === 'same' ? { lang, translation: null }                                              // "this language needs no translation"
    : how === 'lost' ? { lang, translation: `ÇEVİRİ: ${source.replace(/⟦\d+⟧/, '')}` }            // one mark dropped
    : how === 'link' ? { lang, translation: `ÇEVİRİ: ${source} [buraya tıkla](https://ornek.test/x)` }   // a link the text did not have
    : { lang, translation: `ÇEVİRİ: ${source}` }
  const out = how === 'bad' ? { ...base, result: 'bir şey okuyamadım' } : how === 'error' ? base : { ...base, structured_output: answer }
  if (pidFile) fs.writeFileSync(pidFile, JSON.stringify({ passive: true, cwd: process.cwd(), entries: fs.readdirSync(process.cwd()).length }))
  console.log(JSON.stringify({ type: 'system', subtype: 'init' }))
  console.log(JSON.stringify(out))
  process.exit(0)
}
const request = prompt.match(/^İstek: (\S+)/m)?.[1] ?? null
const ticket = prompt.match(/^Görev: (\S+)/m)?.[1] ?? null

// A process of its own, as a real session has (its MCP server, a shell).
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
const note = (extra = {}) => { if (pidFile) fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, child: child.pid, request, ticket, ...extra })) }
note()

const fira = (...args) => spawnSync(process.execPath, [path.join(HERE, 'fira-agent.mjs'), ...args], { encoding: 'utf8' })
if (mode === 'finish' && request && ticket) {
  const md = path.join(os.tmpdir(), `fira-stub-${process.pid}.md`)
  fs.writeFileSync(md, 'Deneme oturumu (taklit): işi teslim ediyorum.\n')
  fira('handover', ticket, md)
  fira('finish', request, 'done', 'taklit oturum')
  fs.rmSync(md, { force: true })
}
if (mode === 'ask' && request && ticket) {
  const answer = !resumed ? null : /ONAYLANDI/.test(prompt) ? 'approved' : /REDDEDİLDİ/.test(prompt) ? 'rejected' : 'expired'
  // Every invocation is noted, so the test can see that the second one continued the first one's session.
  if (pidFile) {
    const log = `${pidFile}.calls.json`
    let calls = []
    try { calls = JSON.parse(fs.readFileSync(log, 'utf8')) } catch { /* the first call */ }
    calls.push({ resumed: !!resumed, session: sessionId, answer })
    fs.writeFileSync(log, JSON.stringify(calls))
  }
  if (!resumed) {
    const asked = fira('approval', request, 'taklit oturum: deneme sürümü canlıya çıkacak')
    note({ asked: (asked.stdout || asked.stderr || '').trim().split('\n').slice(-1)[0] })
  } else {
    const md = path.join(os.tmpdir(), `fira-stub-${process.pid}.md`)
    fs.writeFileSync(md, answer === 'approved' ? 'Deneme oturumu (taklit): onay geldi, dağıtıldı sayıldı ve teslim ediyorum.\n' : `Deneme oturumu (taklit): canlıya çıkmadı (${answer === 'rejected' ? 'reddedildi' : 'onay cevabı gelmedi'}); iş olduğu gibi teslim.\n`)
    fira('handover', ticket, md)
    fira('finish', request, 'done', `taklit oturum: ${answer}`)
    fs.rmSync(md, { force: true })
  }
}

await new Promise((ok) => setTimeout(ok, seconds * 1000))
child.kill()
note({ ended: true })
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: seconds * 1000, num_turns: 1, total_cost_usd: 0, session_id: sessionId, result: 'taklit oturum bitti', usage: {}, modelUsage: {} }))
