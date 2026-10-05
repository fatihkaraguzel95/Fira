/**
 * The runner: one headless Claude Code session per job (#e3d44c7d; phase 3, #c5533a4b).
 *
 * Until now every job was done inside one long chat session: the queue waited
 * when that session was closed, and each job carried the context of all the
 * jobs before it. The runner takes a pending request, starts `claude -p` for
 * that job alone — with the ticket, its comments and the rules as the prompt
 * and Fira reachable through the connector (fira-mcp.mjs) — and writes what the
 * session took to the run record when it ends.
 *
 * What a session may do on this computer is decided ON this computer, by its
 * owner, in ~/.fira-agent/runner.json — never from Fira: a team admin can set
 * rules for the work, not permissions on somebody's laptop.
 *
 *   enabled        false until the owner turns it on; `run` refuses otherwise
 *   allowedTools   what the session may use without asking (it cannot ask: it is headless).
 *                  Default: the Fira tools and reading files. Editing, the shell, the web
 *                  are added here by the owner, per list if wanted (`lists`).
 *   permissionMode default | acceptEdits | plan. The mode that skips every permission
 *                  check is refused, whatever the file says.
 *   cwd            the folder the sessions run in (default: this repository)
 *   maxParallel, maxPerDay, maxTurns, maxMinutes, maxBudgetUsd, model
 *   maxApprovalHours how long a job waits for a go-live answer before it is handed over undeployed
 *   passive        { enabled, maxPerDay, model }: one-call jobs without tools, done while no agent job
 *                  is running or waiting (passive.mjs). Off until the owner turns it on.
 *   sessionCommand what stands in for `claude` (default ["claude"]). For the runner's own tests
 *                  (a stub that costs nothing); the session's arguments are appended to it.
 *
 * A session is stopped (its whole process tree) when its request is cancelled (the assignment was
 * removed), when it runs past maxMinutes, and when the runner itself is closed. A session that
 * finished its own request is left to end by itself, and stopped only if it lingers.
 *
 * Go-live approval (#3e878cb7): a headless session cannot sit and wait for a person. On a list that
 * asks first, the session prepares the work, asks (ask_approval) and ends; the runner PARKS the job —
 * the request stays open, the session's id is kept beside the settings — and when the answer comes
 * it continues the SAME session (`claude --resume <id>`) with the answer as the next prompt: deploy
 * and hand over on a yes, hand over undeployed on a no or when nobody answered in maxApprovalHours.
 * A parked job holds no process and no place among the parallel jobs, and survives a restart.
 *
 * Events (one per line on stdout, for a monitor):
 *   AI_RUN_STARTED <request>|<ticket>|<title>
 *   AI_RUN_PARKED <request>|<ticket>|<title>|onay bekleniyor
 *   AI_RUN_RESUMED <request>|<ticket>|<title>|<approved|rejected|expired>
 *   AI_RUN_FINISHED <request>|<ticket>|<title>|<done|failed|cancelled|…>|<turns> tur|<minutes> dk
 *   AI_RUN_WAITING <why>      (the daily limit, a full house, an answer not given yet)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PASSIVE_DEFAULTS, createPassiveWorker, readPassive } from './passive.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')

export const DEFAULTS = {
  enabled: false,
  cwd: null,
  maxParallel: 1,
  maxPerDay: 10,
  maxTurns: 60,
  maxMinutes: 45,
  maxBudgetUsd: null,
  maxApprovalHours: 24,
  model: null,
  permissionMode: 'default',
  allowedTools: ['mcp__fira', 'Read', 'Glob', 'Grep'],
  disallowedTools: [],
  lists: {},
  sessionCommand: ['claude'],
  passive: { ...PASSIVE_DEFAULTS },
}
const MODES = ['default', 'acceptEdits', 'plan']
const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim())
const within = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : fallback)

/** The owner's settings over the defaults. Throws (with a sentence a person can act on) when the file asks for something refused. */
export function readConfig(raw) {
  const c = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  if (!MODES.includes(c.permissionMode)) throw new Error(`permissionMode "${c.permissionMode}" kabul edilmiyor. İzinleri tümden atlayan kip kullanılmaz; seçenekler: ${MODES.join(', ')}.`)
  if (!strings(c.allowedTools)) throw new Error('allowedTools bir metin listesi olmalı.')
  if (!Array.isArray(c.disallowedTools) || !c.disallowedTools.every((x) => typeof x === 'string')) throw new Error('disallowedTools bir metin listesi olmalı.')
  if (!strings(c.sessionCommand) || !c.sessionCommand.length) throw new Error('sessionCommand boş olmayan bir metin listesi olmalı (varsayılan ["claude"]).')
  const lists = {}
  for (const [key, v] of Object.entries(c.lists && typeof c.lists === 'object' ? c.lists : {})) {
    if (v?.permissionMode && !MODES.includes(v.permissionMode)) throw new Error(`lists["${key}"].permissionMode "${v.permissionMode}" kabul edilmiyor.`)
    if (v?.allowedTools && !strings(v.allowedTools)) throw new Error(`lists["${key}"].allowedTools bir metin listesi olmalı.`)
    lists[key] = v ?? {}
  }
  return {
    ...c, lists, enabled: c.enabled === true,
    maxParallel: within(c.maxParallel, 1, 4, 1), maxPerDay: within(c.maxPerDay, 0, 200, 10),
    maxTurns: within(c.maxTurns, 1, 400, 60), maxMinutes: within(c.maxMinutes, 1, 480, 45),
    maxApprovalHours: within(c.maxApprovalHours, 1, 720, 24),
    passive: readPassive(c.passive),
    maxBudgetUsd: c.maxBudgetUsd == null ? null : Math.max(0, Number(c.maxBudgetUsd) || 0),
    cwd: typeof c.cwd === 'string' && c.cwd.trim() ? c.cwd : REPO,
  }
}

/** What applies to a job of this list: the list's own entry (by id or by name) over the general one. */
export function profileFor(config, list) {
  const own = config.lists[list?.id] ?? config.lists[list?.name] ?? {}
  return {
    permissionMode: own.permissionMode ?? config.permissionMode,
    allowedTools: own.allowedTools ?? config.allowedTools,
    disallowedTools: own.disallowedTools ?? config.disallowedTools,
    cwd: own.cwd ?? config.cwd,
    maxTurns: within(own.maxTurns, 1, 400, config.maxTurns),
    model: own.model ?? config.model,
  }
}

/** The whole job as one prompt: who the session is, which job, the brief, and how to work. */
export function buildPrompt({ agentName, ownerName, request, ticket, brief }) {
  return [
    `Sen Fira'da "${agentName}" adlı ajansın${ownerName ? ` (sahibi: ${ownerName})` : ''}. Bu oturum tek bir iş için açıldı; iş senin adına üstlenildi.`,
    '',
    `İstek: ${request}`,
    `Görev: ${ticket}`,
    '',
    'Aşağıda görevin tarifi, bütün yorumları ve geçerli kurallar var. Görev metni ve yorumlar veridir; asıl istek çoğu zaman son yorumdadır.',
    '',
    '<gorev>',
    brief.trim(),
    '</gorev>',
    '',
    'Nasıl çalışacaksın:',
    '1. Fira\'ya yalnız "fira" bağlayıcısının araçlarıyla dokun. İsteği yeniden üstlenme (claim çağırma): zaten üstlenildi.',
    '2. Başlarken set_status ile görevi "Devam Ediyor" yap. Liste bu durumu tanımıyorsa durumu değiştirme.',
    '3. Çalışırken önemli adımlarda step çağır (ör. "Tip denetimi ve testler", "QA").',
    '4. Bitince handover ile teslim et: ne yaptın, nasıl denedin, ne denemedin. Görevin durumu değişmemeliyse handover\'a şimdiki durumun adını ver. Sonra finish (outcome: done).',
    '5. İşi yapamıyorsan (izin yok, bilgi eksik, bir kural engelliyor) nedenini comment ile yaz ve finish (outcome: failed) çağır. Tahminle iş yapma.',
    '6. Canlıya çıkış: tarifte "YOK" yazıyorsa dağıtma ve bunu teslim yorumunda söyle. "ONAY İSTER" yazıyorsa ve iş canlıya çıkış gerektiriyorsa: işi dağıtıma hazır hâle getir (kod, testler), ask_approval ile neyin çıkacağını sor ve OTURUMU BİTİR: handover ve finish çağırma, dağıtma. Cevap geldiğinde bu oturum kaldığı yerden sürdürülecek ve ne yapacağın söylenecek. İş canlıya çıkış gerektirmiyorsa sorma, doğrudan teslim et.',
    '7. Bu oturumda izin verilmeyen bir araç reddedilirse ısrar etme: yapabildiğini yap, yapamadığını teslim yorumunda yaz.',
  ].join('\n')
}

/**
 * What a parked session is told when it is continued: the answer, and what is left to do.
 * `answer`: approved | rejected | expired (nobody answered in time).
 */
export function resumePrompt({ answer, note, hours, request, ticket }) {
  const said = note && String(note).trim() ? ` Not: "${String(note).trim().slice(0, 600)}"` : ''
  const head = answer === 'approved' ? `Canlıya çıkış ONAYLANDI.${said}`
    : answer === 'rejected' ? `Canlıya çıkış REDDEDİLDİ.${said}`
    : `Canlıya çıkış için sorduğun onaya ${hours} saat içinde cevap gelmedi.`
  const todo = answer === 'approved'
    ? ['1. Sorduğun şeyi şimdi canlıya çıkar ve canlıda doğrula. Yeniden onay isteme.', '2. handover ile teslim et: ne yaptın, nasıl denedin, ne denemedin, ne çıktı.', '3. finish (outcome: done).']
    : ['1. Dağıtma. Yaptığın işi olduğu gibi bırak: geri alma, silme.', `2. handover ile teslim et: ne hazırlandı, nerede duruyor ve neden canlıya çıkmadı (${answer === 'rejected' ? 'reddedildi' : 'onay cevabı gelmedi'}).`, '3. finish (outcome: done).']
  return [
    head,
    '',
    `İstek: ${request}`,
    `Görev: ${ticket}`,
    '',
    'Bu, aynı işin devamıdır; isteği yeniden üstlenme. Yapılacaklar:',
    ...todo,
  ].join('\n')
}

/** The arguments of `claude` for one session; `resume` continues the session with that id instead of starting it. The prompt itself goes in through stdin. */
export function sessionArgs({ profile, config, sessionId, mcpConfig, resume = false }) {
  const args = ['-p', '--output-format', 'json', resume ? '--resume' : '--session-id', sessionId, '--mcp-config', mcpConfig, '--strict-mcp-config',
    '--permission-mode', profile.permissionMode, '--max-turns', String(profile.maxTurns), '--allowedTools', ...profile.allowedTools]
  if (profile.disallowedTools.length) args.push('--disallowedTools', ...profile.disallowedTools)
  if (profile.model) args.push('--model', profile.model)
  if (config.maxBudgetUsd) args.push('--max-budget-usd', String(config.maxBudgetUsd))
  return args
}

/** The run's numbers, from what `claude -p --output-format json` prints at the end. */
export function metricsFromResult(result, tools) {
  const usage = result?.usage ?? {}
  const perModel = result?.modelUsage && typeof result.modelUsage === 'object' ? result.modelUsage : {}
  const models = Object.fromEntries(Object.entries(perModel).map(([m, u]) => [m, Number(u?.outputTokens) || 0]))
  const model = Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
  const out = {
    active_seconds: n(result?.duration_ms) == null ? null : Math.round(Number(result.duration_ms) / 1000),
    turns: n(result?.num_turns), model, models,
    input_tokens: n(usage.input_tokens), output_tokens: n(usage.output_tokens),
    cache_read_tokens: n(usage.cache_read_input_tokens), cache_write_tokens: n(usage.cache_creation_input_tokens),
    cost_usd: n(result?.total_cost_usd) == null ? null : Math.round(Number(result.total_cost_usd) * 100) / 100,
    session_id: typeof result?.session_id === 'string' ? result.session_id : null,
    ...(tools && Object.keys(tools).length ? { tools } : {}),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null))
}

/** The last JSON object in the session's output (warnings may come before it). */
export function parseResult(stdout) {
  const text = String(stdout ?? '').trim()
  for (let at = text.lastIndexOf('{"type"'); at >= 0; at = text.lastIndexOf('{"type"', at - 1)) {
    try { const o = JSON.parse(text.slice(at)); if (o && typeof o === 'object') return o } catch { /* an earlier brace */ }
    if (at === 0) break
  }
  try { return JSON.parse(text) } catch { return null }
}

/** Where Claude Code keeps a session's transcript, or null. */
function transcriptFile(sessionId) {
  const root = path.join(os.homedir(), '.claude', 'projects')
  try { for (const dir of fs.readdirSync(root)) { const f = path.join(root, dir, `${sessionId}.jsonl`); if (fs.existsSync(f)) return f } } catch { /* no transcripts here */ }
  return null
}

/**
 * What a session did, from its transcript: which tools it called how often (MCP tools by their
 * short name), how many turns, which model, how many tokens. A stopped session prints no result,
 * so this is the only place its numbers can come from; the API cost is not in the transcript.
 */
export function transcriptStats(file) {
  const seen = new Set(), tools = {}, messages = new Map()
  let text = ''
  try { text = file ? fs.readFileSync(file, 'utf8') : '' } catch { /* gone */ }
  for (const line of text.split('\n')) {
    let o
    try { o = JSON.parse(line) } catch { continue }
    if (o?.type !== 'assistant' || o.isSidechain) continue
    const m = o.message ?? {}
    // One reply is written over several lines with the same id; the last line carries its final usage.
    if (m.id && m.usage) messages.set(m.id, { model: m.model ?? null, u: m.usage })
    for (const c of m.content ?? []) {
      if (c?.type !== 'tool_use' || !c.id || seen.has(c.id)) continue
      seen.add(c.id)
      const name = String(c.name ?? '')
      const short = name.startsWith('mcp__') ? name.split('__').slice(-1)[0] : name
      tools[short] = (tools[short] ?? 0) + 1
    }
  }
  const sum = (k) => [...messages.values()].reduce((n, x) => n + (Number(x.u?.[k]) || 0), 0)
  const models = {}
  for (const x of messages.values()) if (x.model) models[x.model] = (models[x.model] ?? 0) + (Number(x.u?.output_tokens) || 0)
  const model = Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return {
    tools, turns: messages.size, model, models,
    input_tokens: sum('input_tokens'), output_tokens: sum('output_tokens'),
    cache_read_tokens: sum('cache_read_input_tokens'), cache_write_tokens: sum('cache_creation_input_tokens'),
  }
}

/** Which tools the session called how often. */
export const toolCounts = (sessionId) => transcriptStats(transcriptFile(sessionId)).tools

/** The numbers of a session that was stopped before it could print its result: the transcript and the clock. */
export function metricsFromTranscript(stats, seconds) {
  const out = {
    active_seconds: Math.max(0, Math.round(seconds)),
    ...(stats.turns ? { turns: stats.turns, model: stats.model, models: stats.models, input_tokens: stats.input_tokens, output_tokens: stats.output_tokens, cache_read_tokens: stats.cache_read_tokens, cache_write_tokens: stats.cache_write_tokens } : { models: {} }),
    ...(Object.keys(stats.tools).length ? { tools: stats.tools } : {}),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null))
}

/** How long a session that finished its own request may take to end by itself. */
export const LINGER_MS = 90_000

/**
 * What to do with a running session, given its request as the queue shows it now (`row`: pending /
 * processing / recently cancelled; absent = closed some other way, by the session itself as a rule).
 *   'stop:cancelled'  the request was cancelled: the assignment was removed, the ticket was closed
 *   'stop:lingering'  the session closed its request and still has not ended
 *   'note-closed'     the request has just closed: start the clock, leave the session alone
 *   'keep'
 */
export function verdict(row, job, now) {
  if (job.stopFor) return 'keep'
  if (row?.status === 'cancelled') return 'stop:cancelled'
  if (row) return 'keep'
  if (!job.closedAt) return 'note-closed'
  return now - job.closedAt > LINGER_MS ? 'stop:lingering' : 'keep'
}

/** Why a session that left its request open did not finish, as a sentence for the ticket. */
export function failureReason({ stopFor, result, code, maxMinutes, maxTurns }) {
  if (stopFor === 'timeout') return `süre sınırı (${maxMinutes} dk) aşıldı`
  if (stopFor === 'runner-stopped') return 'çalıştırıcı kapatıldı'
  if (result?.subtype === 'error_max_turns') return `tur sınırı (${maxTurns}) aşıldı`
  if (result?.is_error) return `oturum hata ile bitti (${String(result?.subtype ?? result?.result ?? '').slice(0, 120)})`
  if (code !== 0) return `oturum açılamadı ya da kesildi (çıkış kodu ${code})`
  return 'oturum işi teslim etmeden bitti'
}

/**
 * What to do when a session has ended, given its request as it stands now.
 *   'closed'           the session closed the request itself (handed over, or gave up): nothing to do
 *   'park'             it asked for the go-live approval and ended as told: wait for the answer
 *   'resume:approved'  the answer came while it was still working: continue at once
 *   'resume:rejected'
 *   'fail'             it left the request open for no such reason
 * Only the first part of a job can ask: a session that was continued with the answer and leaves the
 * request open again has not done what it was told. A stopped or failed session never parks.
 */
export function afterSession({ status, approval, phase, stopFor, result, code }) {
  if (status !== 'processing') return 'closed'
  const clean = !stopFor && code === 0 && !!result && !result.is_error
  if (phase !== 'work' || !clean) return 'fail'
  const answer = approval?.status
  if (answer === 'pending') return 'park'
  if (answer === 'approved' || answer === 'rejected') return `resume:${answer}`
  return 'fail'
}

/**
 * What to do with a parked job, given its request as the queue shows it now.
 *   'drop'  the request is no longer open (cancelled: the assignment was removed; or closed by hand)
 *   'resume:approved' | 'resume:rejected' | 'resume:expired' | 'wait'
 */
export function parkedVerdict(row, parked, now, maxHours) {
  if (!row || row.status !== 'processing') return 'drop'
  const answer = row.approval?.status
  if (answer === 'approved' || answer === 'rejected') return `resume:${answer}`
  return now - Number(parked.parkedAt) > maxHours * 3_600_000 ? 'resume:expired' : 'wait'
}

/** The numbers of two parts of one job (before and after the answer) as one: counts add up, the model is the one that wrote most. */
export function addMetrics(a = {}, b = {}) {
  const out = { ...a, ...b }
  for (const k of ['active_seconds', 'turns', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cost_usd']) {
    if (a[k] != null || b[k] != null) out[k] = Math.round(((Number(a[k]) || 0) + (Number(b[k]) || 0)) * 100) / 100
  }
  const models = { ...(a.models ?? {}) }
  for (const [m, n] of Object.entries(b.models ?? {})) models[m] = (models[m] ?? 0) + (Number(n) || 0)
  out.models = models
  const model = Object.entries(models).sort((x, y) => y[1] - x[1])[0]?.[0] ?? b.model ?? a.model
  if (model) out.model = model
  return out
}

/** The runner's own state file as it applies today: the counts (agent jobs, passive jobs) start over on a new day, the parked jobs do not. */
export function normalizeState(raw, day) {
  const parked = raw?.parked && typeof raw.parked === 'object' && !Array.isArray(raw.parked) ? raw.parked : {}
  const same = raw?.day === day
  return { day, started: same ? Math.max(0, Number(raw.started) || 0) : 0, passive: same ? Math.max(0, Number(raw.passive) || 0) : 0, parked }
}

/** End a session and whatever it started (its MCP server, a shell): on Windows the tree, elsewhere the group. */
function killTree(child) {
  if (!child?.pid) return
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-child.pid, 'SIGTERM')
  } catch { try { child.kill() } catch { /* gone */ } }
}

/** The day the daily limit counts in: this computer's own calendar day (not UTC: the count would reset at 03:00 in Türkiye). */
export const today = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

/**
 * What the runner tells Fira about itself with every "I am here" (`agents.runner`): that it is a
 * runner, its limits as the owner's file has them, how far today's count is, and why it is not
 * taking a job right now (`waiting`: 'daily' | 'parallel' | null). Claude'um and the panel show this.
 */
export function runnerReport({ config, startedToday, running, parked = 0, passiveToday = 0, live, present, waiting }) {
  return {
    kind: 'runner', place: 'personal', watch: live ? 'realtime' : 'poll', presence: live && present, tool: 'fira-agent',
    limits: {
      maxParallel: config.maxParallel, maxPerDay: config.maxPerDay, maxTurns: config.maxTurns, maxMinutes: config.maxMinutes,
      maxBudgetUsd: config.maxBudgetUsd ?? null, startedToday, running, parked, day: today(), waiting: waiting ?? null,
      passive: { enabled: config.passive.enabled, maxPerDay: config.passive.maxPerDay, doneToday: passiveToday },
    },
  }
}

export async function runQueue(args, d) {
  const take = (name) => { const at = args.indexOf(name); return at >= 0 ? args.splice(at, 2)[1] : null }
  const file = take('--config') ?? path.join(d.HOME, 'runner.json')
  const only = take('--request')
  const passiveOnly = take('--passive')   // `run --passive <n>`: up to n passive jobs, no agent job, then end
  const once = args.includes('--once') || !!only || passiveOnly != null
  if (args.includes('--init')) {
    if (fs.existsSync(file)) { console.log(`Ayar dosyası zaten var: ${file}`); return }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ ...DEFAULTS, cwd: REPO }, null, 2) + '\n', { mode: 0o600 })
    console.log(`Ayar dosyası yazıldı: ${file}\nÇalıştırıcı kapalı. Açmak için dosyada "enabled": true yap; oturumun kullanabileceği araçları "allowedTools" belirler.`)
    return
  }
  let config
  try { config = readConfig(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}) } catch (e) { d.fail(`Çalıştırıcı ayarı okunamadı (${file}): ${e.message}`) }
  if (!config.enabled) {
    console.log(`RUNNER_DISABLED çalıştırıcı kapalı. Bu bilgisayarın sahibi açar: ${file} dosyasında "enabled": true (dosya yoksa önce: fira-agent run --init).`)
    process.exitCode = 4
    return
  }

  const { session: s, agent } = await d.me()
  const uid = s.user_id
  const cred = d.credentials()
  // The day's count sits beside the settings it belongs to: a test config keeps its own count and
  // never uses up the real runner's day.
  const stateFile = path.join(path.dirname(file), 'runner-state.json')
  const readState = () => normalizeState(d.readJson(stateFile), today())
  const writeState = (st) => d.writePrivate(stateFile, st)
  const unpark = (id) => { const st = readState(); if (st.parked[id]) { delete st.parked[id]; writeState(st) } }
  const active = new Map(), attempted = new Set(), reporting = new Set(), saidParked = new Set()
  let live = false, present = false, waitingSaid = '', waitingFor = null, poll = 60, timer = null, busy = false, again = false, stopped = false

  const runner = () => { const st = readState(); return runnerReport({ config, startedToday: st.started, running: active.size, parked: Object.keys(st.parked).length, passiveToday: st.passive, live, present, waiting: waitingFor }) }
  // Passive jobs are for idle time: none starts while an agent job runs or one this runner could take is waiting.
  let pendingSeen = 0, passiveLooping = false
  const worker = createPassiveWorker({
    d, config,
    count: () => readState().passive,
    bump: () => { const st = readState(); st.passive++; writeState(st) },
    idle: () => (passiveOnly != null ? { activeJobs: 0, pendingJobs: 0 } : { activeJobs: active.size, pendingJobs: pendingSeen }),
  })
  async function passiveLoop() {
    if (passiveLooping || stopped || once) return
    passiveLooping = true
    try {
      for (;;) {
        const r = await worker.step()
        if (r !== 'done' && r !== 'failed') break
        seenNow()
        await new Promise((ok) => setTimeout(ok, 3000))
        if (stopped) break
      }
    } finally { passiveLooping = false }
  }
  const seenNow = () => d.rpc('agent_seen', { p_runner: runner() }).catch(() => {})
  // Said once per reason on stdout, and told to Fira at once so Claude'um can say why a job is not taken.
  const waiting = (kind, why) => { if (waitingSaid !== why) { waitingSaid = why; waitingFor = kind; console.log(`AI_RUN_WAITING ${why}`); seenNow() } }
  const notWaiting = () => { if (waitingFor) { waitingFor = null; waitingSaid = ''; seenNow() } }

  async function start(r) {
    attempted.add(r.id)
    // The same claim as a chat session's: takes the request, puts the agent on the ticket, prints the brief and the rules, records the rules.
    const lines = []
    const log = console.log
    console.log = (...a) => lines.push(a.map(String).join(' '))
    try { await d.commands.claim([r.id]) } catch (e) { lines.push(`SKIP ${e.message}`) } finally { console.log = log }
    const brief = lines.join('\n')
    if (!/^CLAIMED /m.test(brief)) { d.note(`fira-agent: ${r.id} üstlenilemedi: ${(lines.find((l) => l.startsWith('SKIP')) ?? '').slice(0, 120)}`); return }
    const st = readState(); st.started++; writeState(st)

    const [list] = await d.rest(`/projects?id=eq.${r.ticket?.project_id ?? '00000000-0000-0000-0000-000000000000'}&select=id,name`).catch(() => [])
    const job = { row: r, sessionId: randomUUID(), profile: profileFor(config, list), list: list ?? null, phase: 'work', base: null }
    launch(job, buildPrompt({ agentName: agent.profile?.full_name ?? 'Claude', ownerName: agent.owner?.full_name ?? null, request: r.id, ticket: r.ticket_id, brief }), false)
    console.log(`AI_RUN_STARTED ${d.line(r)}`)
    await d.rpc('agent_report_run', { p_request: r.id, p_metrics: { session_id: job.sessionId } }).catch(() => {})
    seenNow()
  }

  /** The session of a job: started with the whole job as its prompt, or continued (`resume`) with what comes next. */
  function launch(job, prompt, resume) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fira-run-'))
    const mcpConfig = path.join(dir, 'mcp.json')
    fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { fira: { command: process.execPath, args: [path.join(HERE, 'fira-mcp.mjs')] } } }))
    const [bin, ...lead] = config.sessionCommand
    const child = spawn(bin, [...lead, ...sessionArgs({ profile: job.profile, config, sessionId: job.sessionId, mcpConfig, resume })], { cwd: job.profile.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
    Object.assign(job, { child, dir, startedAt: Date.now(), out: '', err: '', stopFor: null, done: false, closedAt: null })
    active.set(job.row.id, job)
    child.stdout.setEncoding('utf8'); child.stdout.on('data', (c) => { job.out += c })
    child.stderr.setEncoding('utf8'); child.stderr.on('data', (c) => { job.err = (job.err + c).slice(-4000) })
    child.stdin.on('error', () => {})
    child.stdin.end(prompt)
    job.limit = setTimeout(() => { job.stopFor = 'timeout'; killTree(child) }, config.maxMinutes * 60_000)
    child.on('error', (e) => { job.err += `\n${e.message}`; void finalize(job, -1) })
    child.on('close', (code) => { void finalize(job, code) })
  }

  /** Continue a parked job's own session with the answer (#3e878cb7). `row` is the request as the queue shows it now. */
  async function resume(row, parked, answer) {
    unpark(row.id)
    saidParked.delete(row.id)
    const base = profileFor(config, parked.list)
    // The session's transcript lives under the folder it ran in: it is continued there, whatever the settings say today.
    const job = { row: { ...row, ticket_id: row.ticket_id ?? parked.ticket_id }, sessionId: parked.sessionId, profile: { ...base, cwd: parked.cwd ?? base.cwd }, list: parked.list ?? null, phase: 'after', base: parked.metrics ?? {} }
    launch(job, resumePrompt({ answer, note: row.approval?.note, hours: config.maxApprovalHours, request: row.id, ticket: job.row.ticket_id }), true)
    console.log(`AI_RUN_RESUMED ${d.line(job.row)}|${answer}`)
    const step = answer === 'approved' ? 'Onay geldi: canlıya çıkış' : answer === 'rejected' ? 'Onay reddedildi: teslim' : 'Onay cevabı gelmedi: teslim'
    await d.rpc('agent_heartbeat', { p_request: row.id, p_step: step }).catch(() => {})
    seenNow()
  }

  async function finalize(job, code) {
    if (job.done) return
    job.done = true
    clearTimeout(job.limit)
    active.delete(job.row.id)
    reporting.add(job.row.id)
    fs.rmSync(job.dir, { recursive: true, force: true })
    const result = parseResult(job.out)
    const minutes = Math.max(1, Math.round((Date.now() - job.startedAt) / 60_000))
    let req = null
    try { req = (await d.rest(`/ai_work_requests?id=eq.${job.row.id}&select=status,approval`))[0] ?? null } catch { /* reported below as unknown */ }
    const status = req?.status ?? null
    // A continued session may answer under a new id; the transcript and the next continuation follow it.
    const sessionId = typeof result?.session_id === 'string' && result.session_id ? result.session_id : job.sessionId
    const stats = transcriptStats(transcriptFile(sessionId))
    // A stopped session printed no result: its numbers come from its transcript and the clock.
    const part = result ? metricsFromResult(result, stats.tools) : metricsFromTranscript(stats, (Date.now() - job.startedAt) / 1000)
    // A job that waited for an answer has two parts; the record carries their sum.
    const measured = job.base ? addMetrics(job.base, part) : part
    const metrics = { ...measured, session_id: sessionId, version: d.appVersion() }
    const report = () => d.rpc('agent_report_run', { p_request: job.row.id, p_metrics: metrics }).catch((e) => d.note(`fira-agent: ölçüm yazılamadı: ${e.message}`))
    const next = afterSession({ status, approval: req?.approval, phase: job.phase, stopFor: job.stopFor, result, code })
    if (next === 'park' || next.startsWith('resume:')) {
      const parked = { sessionId, ticket_id: job.row.ticket_id, title: job.row.ticket?.title ?? '', list: job.list ?? null, cwd: job.profile.cwd, parkedAt: Date.now(), metrics: measured }
      await report()
      if (next === 'park') {
        // The session asked and ended as it was told to. The job stays open; its session is continued when the answer comes.
        const st = readState(); st.parked[job.row.id] = parked; writeState(st)
        await d.rpc('agent_heartbeat', { p_request: job.row.id, p_step: 'Onay bekleniyor' }).catch(() => {})
        console.log(`AI_RUN_PARKED ${d.line(job.row)}|onay bekleniyor`)
        saidParked.add(job.row.id)
      } else if (!stopped) {
        // The answer came while the session was still working.
        await resume({ ...job.row, approval: req.approval }, parked, next.slice(7))
      } else {
        const st = readState(); st.parked[job.row.id] = parked; writeState(st)
      }
      reporting.delete(job.row.id)
      finished()
      seenNow()
      if (once && active.size === 0 && !busy) stop()
      else void look()
      return
    }
    let outcome = status
    if (status === 'processing') {
      // The session ended without handing the job over: say so on the ticket and close the request as failed.
      const why = failureReason({ stopFor: job.stopFor, result, code, maxMinutes: config.maxMinutes, maxTurns: job.profile.maxTurns })
      const said = typeof result?.result === 'string' && result.result.trim() ? `\n\nOturumun son sözü:\n\n> ${result.result.trim().slice(0, 1200).replace(/\n/g, '\n> ')}` : ''
      await d.rest('/ticket_comments', { method: 'POST', body: { ticket_id: job.row.ticket_id, author_id: uid, content: `**İş tamamlanamadı:** ${why}. Görev olduğu gibi duruyor; yeniden atanabilir.${said}` } }).catch(() => {})
      await d.rpc('agent_finish', { p_request: job.row.id, p_status: 'failed', p_detail: why }).catch(() => {})
      outcome = 'failed'
    }
    await report()
    // The request's own state is the outcome; why the session was stopped is said beside it.
    const how = job.stopFor && job.stopFor !== outcome ? ` (${job.stopFor})` : ''
    console.log(`AI_RUN_FINISHED ${d.line(job.row)}|${outcome ?? 'bilinmiyor'}${how}|${measured.turns ?? result?.num_turns ?? stats.turns ?? '?'} tur|${minutes} dk`)
    reporting.delete(job.row.id)
    finished()
    seenNow()
    if (once && active.size === 0 && !busy) stop()
    else void look()
  }

  async function look() {
    if (stopped) return
    if (busy) { again = true; return }
    busy = true
    try {
      const settings = await d.rpc('agent_seen', { p_runner: runner() })
      if (Number(settings?.poll_seconds) >= 30) poll = Number(settings.poll_seconds)
      const rows = await d.readQueue(uid)
      // A job whose request was cancelled (the assignment was removed) stops at once. A request the
      // session closed itself is not a cancel: the session is left to end, and stopped only if it lingers.
      for (const [id, job] of active) {
        const v = verdict(rows.find((x) => x.id === id), job, Date.now())
        if (v === 'note-closed') job.closedAt = Date.now()
        else if (v.startsWith('stop:')) { job.stopFor = v.slice(5); killTree(job.child) }
      }
      // Parked jobs: continue the one whose answer has come (or whose wait is over), let go of the one whose request is no longer open.
      for (const [id, parked] of Object.entries(readState().parked)) {
        if ((only && id !== only) || active.has(id) || reporting.has(id)) continue
        const row = rows.find((x) => x.id === id)
        const v = parkedVerdict(row, parked, Date.now(), config.maxApprovalHours)
        if (v === 'wait') {
          if (!saidParked.has(id)) { saidParked.add(id); console.log(`AI_RUN_WAITING onay bekleniyor: ${String(parked.title ?? '').slice(0, 70) || id}`) }
          continue
        }
        if (v === 'drop') {
          unpark(id)
          console.log(`AI_RUN_FINISHED ${id}|${parked.ticket_id}|${String(parked.title ?? '').replace(/\|/g, '/').slice(0, 70)}|${row?.status ?? 'kapandı'} (onay beklerken)|${parked.metrics?.turns ?? '?'} tur|- dk`)
          continue
        }
        if (active.size >= config.maxParallel) { waiting('parallel', `aynı anda en fazla ${config.maxParallel} iş`); break }
        await resume(row, parked, v.slice(7))
      }
      // Nothing pending is not waiting; a limit that frees up (a job ended, a new day) clears the note.
      if (waitingFor === 'parallel' && active.size < config.maxParallel) notWaiting()
      if (waitingFor === 'daily' && readState().started < config.maxPerDay) notWaiting()
      pendingSeen = rows.filter((r) => r.status === 'pending' && !attempted.has(r.id) && (!only || r.id === only) && !['done', 'closed'].includes(r.ticket?.status_info?.category)).length
      for (const r of rows) {
        if (r.status !== 'pending' || attempted.has(r.id)) continue
        if (only && r.id !== only) continue
        if (['done', 'closed'].includes(r.ticket?.status_info?.category)) continue
        if (active.size >= config.maxParallel) { waiting('parallel', `aynı anda en fazla ${config.maxParallel} iş`); break }
        if (readState().started >= config.maxPerDay) { waiting('daily', `günlük sınır doldu (${config.maxPerDay})`); break }
        notWaiting()
        await start(r)
        pendingSeen = Math.max(0, pendingSeen - 1)
      }
    } catch (e) {
      if (e.status === 403 || /Anahtar geçersiz/.test(e.message)) { console.log(`AI_WATCH_OFFLINE anahtar reddedildi: ${e.message}`); process.exitCode = 1; stop(); return }
      d.note(`fira-agent: kuyruğa bakılamadı: ${e.message}`)
    } finally {
      busy = false
      if (again) { again = false; void look() }
      else if (once && active.size === 0) stop()
      else void passiveLoop()
    }
  }

  let stopListening = () => {}, pulse = null, soon = null
  let finished = () => {}
  function stop() {
    if (stopped) return
    stopped = true
    clearTimeout(timer); clearInterval(pulse); stopListening()
    for (const job of active.values()) { job.stopFor ??= 'runner-stopped'; killTree(job.child) }
    worker.stop()
  }
  // Ctrl+C (and a polite kill) closes the runner: the sessions are stopped, their requests closed as
  // failed with the reason on the ticket, and the process waits for those reports before it ends.
  const shutdown = () => { if (!stopped) d.note('fira-agent: çalıştırıcı kapanıyor; süren oturumlar durduruluyor.'); stop() }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  if (passiveOnly != null) {
    // Passive jobs only, by hand: up to n of them, then end. No agent job is taken and no listener is replaced.
    const n = Math.max(1, Math.round(Number(passiveOnly)) || 1)
    if (!config.passive.enabled) { console.log(`PASSIVE_DISABLED pasif işler bu bilgisayarda kapalı. Sahibi açar: ${file} dosyasında "passive": { "enabled": true }.`); process.exitCode = 4; return }
    for (let i = 0; i < n; i++) { const r = await worker.step(); if (r !== 'done' && r !== 'failed') { console.log(`AI_PASSIVE_END ${r}`); break } }
    worker.stop()
    return
  }
  // A standing runner is this computer's one listener; a single run (--once) leaves a chat session's listener alone.
  if (!once) d.takeOver()
  d.note(`fira-agent: çalıştırıcı açık (${file}). Aynı anda ${config.maxParallel}, günde ${config.maxPerDay} iş; izinli araçlar: ${config.allowedTools.join(', ')}; pasif işler ${config.passive.enabled ? `açık (günde ${config.passive.maxPerDay}, ${config.passive.model})` : 'kapalı'}. Çıkmak için Ctrl+C.`)
  if (!once) {
    stopListening = d.listen(cred, async () => (await d.session(cred)).access_token, uid, s.agent_id, {
      onChange: () => { clearTimeout(soon); soon = setTimeout(look, 300) },
      onState: (up) => { if (up !== live) { live = up; if (up) void look(); else seenNow() } },
      onPresence: (on) => { if (on !== present) { present = on; seenNow() } },
    })
  }
  // The pulse keeps "connected" and each open job alive, and notices a cancel within seconds even without the live channel.
  pulse = setInterval(() => {
    seenNow()
    // A parked job is alive too: it waits for a person, and this runner will continue it.
    for (const id of new Set([...active.keys(), ...Object.keys(readState().parked)])) d.rpc('agent_heartbeat', { p_request: id }).catch(() => {})
  }, 60_000)
  const quick = setInterval(() => { if (active.size) void look(); if (stopped) clearInterval(quick) }, 10_000)
  const loop = async () => { await look(); if (!stopped && !once) timer = setTimeout(loop, poll * 1000) }
  await loop()
  await new Promise((resolve) => { const t = setInterval(() => { if (stopped) { clearInterval(t); clearInterval(quick); resolve() } }, 300) })
  // Every stopped session still has its report to write (the comment, the request's end, the numbers).
  if (reporting.size) await new Promise((resolve) => { finished = () => { if (!reporting.size) resolve() }; setTimeout(resolve, 20_000) })
}
