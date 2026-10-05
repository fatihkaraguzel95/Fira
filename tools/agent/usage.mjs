/**
 * What a request cost, read from a Claude Code session transcript (the .jsonl
 * under ~/.claude/projects/<project>/). Used in two places: `fira-agent finish`
 * reports the run it just closed, and `fira-agent import-usage` carries the
 * history over.
 *
 * A request's span runs from the tool call that claimed it to the one that
 * closed it. Both generations of markers are recognised:
 *   claim   ai-claim.sh <request>            |  fira-agent.mjs claim|resume <request>  |  mcp__fira__claim { request }
 *   close   update ai_work_requests set status='done' … where id='<request>'
 *                                            |  fira-agent.mjs finish <request> done
 *
 * Inside the span every assistant message counts once (the transcript repeats
 * a message per content block; the last line of a message id wins). Time is
 * "active" time: a gap of more than five minutes between two messages is
 * waiting — for a person, a build, the night — not work.
 *
 * The transcript format is internal to Claude Code and may change; nothing
 * here is trusted beyond "a number to show", and a line that does not parse is
 * skipped.
 */
import fs from 'node:fs'
import readline from 'node:readline'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const CLAIM = new RegExp(`(?:ai-claim\\.sh|fira-agent\\.mjs\\\\?"?\\s+(?:claim|resume))\\s+(${UUID})`, 'g')
// The same through the connector (fira-mcp.mjs): the tool is named mcp__<server>__claim and the request is its argument.
const MCP_TOOL = /^mcp__[A-Za-z0-9_-]*fira[A-Za-z0-9_-]*__(claim|resume|finish)$/
const ONE_UUID = new RegExp(`^${UUID}$`)
const DONE_SQL = new RegExp(`update ai_work_requests set status='(done|failed)'[\\s\\S]*?where id='(${UUID})'`, 'g')
const DONE_TOOL = new RegExp(`fira-agent\\.mjs\\\\?"?\\s+finish\\s+(${UUID})\\s+(done|failed)`, 'g')
const IDLE_GAP_S = 300

/** API list prices per million tokens: input, output, cache read. An estimate for comparison — a subscription does not pay this. */
const PRICE = {
  'claude-opus-5-5': [4, 20, 0.20],
  'claude-opus-5': [5, 25, 0.50],
  'claude-opus-4-8': [5, 25, 0.50],
  'claude-fable-5-1': [10, 50, 0.25],
  'claude-fable-5': [10, 50, 1.00],
}

function usageOf(u) {
  const parts = Array.isArray(u.iterations) && u.iterations.length ? u.iterations : [u]
  const sum = (key) => parts.reduce((n, x) => n + (Number(x?.[key]) || 0), 0)
  const hour = parts.reduce((n, x) => n + (Number(x?.cache_creation?.ephemeral_1h_input_tokens) || 0), 0)
  return { in: sum('input_tokens'), out: sum('output_tokens'), cr: sum('cache_read_input_tokens'), cw: sum('cache_creation_input_tokens'), cw1h: hour }
}
function costOf(model, u) {
  const p = PRICE[model]
  if (!p) return 0
  const short = u.cw - u.cw1h
  return (u.in * p[0] + u.out * p[1] + u.cr * p[2] + short * p[0] * 1.25 + u.cw1h * p[0] * 2) / 1e6
}

/**
 * Every request with a claim in the transcript. `openEnded` keeps a request
 * whose closing call is not in the file yet (it is being made right now) and
 * ends its span at the last message.
 */
export async function usageFromTranscript(file, { openEnded = false } = {}) {
  const events = []            // [time, kind, request]
  const messages = new Map()   // message id → { t, model, u }
  const toolUses = new Map()   // tool_use id → { t, name }  (a block may be repeated across lines)
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  let sessionId = null
  for await (const line of rl) {
    if (!line.includes('"assistant"')) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    if (o.type !== 'assistant' || o.isSidechain || !o.timestamp) continue
    sessionId ??= o.sessionId ?? null
    const t = Date.parse(o.timestamp)
    const m = o.message ?? {}
    if (m.usage && m.id) messages.set(m.id, { t, model: m.model || '?', u: usageOf(m.usage) })
    for (const c of m.content ?? []) {
      if (c?.type !== 'tool_use') continue
      if (c.id && c.name) toolUses.set(c.id, { t, name: String(c.name) })
      const cmd = JSON.stringify(c.input ?? {})
      for (const x of cmd.matchAll(CLAIM)) events.push([t, 'claim', x[1]])
      for (const x of cmd.matchAll(DONE_SQL)) events.push([t, x[1], x[2]])
      for (const x of cmd.matchAll(DONE_TOOL)) events.push([t, x[2], x[1]])
      const mcp = MCP_TOOL.exec(String(c.name ?? ''))
      const request = String(c.input?.request ?? '')
      if (mcp && ONE_UUID.test(request)) {
        if (mcp[1] !== 'finish') events.push([t, 'claim', request])
        else if (['done', 'failed'].includes(c.input?.outcome)) events.push([t, c.input.outcome, request])
      }
    }
  }
  events.sort((a, b) => a[0] - b[0])
  const spans = new Map()
  for (const [t, kind, id] of events) {
    const s = spans.get(id) ?? { start: null, end: null, result: null }
    if (kind === 'claim') s.start ??= t
    else if (s.start && !s.end) { s.end = t; s.result = kind }
    spans.set(id, s)
  }
  const ordered = [...messages.values()].sort((a, b) => a.t - b.t)
  const last = ordered.at(-1)?.t ?? null
  const rows = []
  for (const [request, s] of spans) {
    if (!s.start) continue
    if (!s.end) { if (!openEnded || !last) continue; s.end = last; s.result = null }
    const inside = ordered.filter((x) => x.t >= s.start && x.t <= s.end)
    if (!inside.length) continue
    const total = { in: 0, out: 0, cr: 0, cw: 0 }
    const models = {}
    let usd = 0, active = 0, prev = s.start
    for (const { t, model, u } of inside) {
      total.in += u.in; total.out += u.out; total.cr += u.cr; total.cw += u.cw
      models[model] = (models[model] ?? 0) + u.out
      usd += costOf(model, u)
      active += Math.min((t - prev) / 1000, IDLE_GAP_S)
      prev = t
    }
    const model = Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    // Which tools were called how often while this request was open (MCP tools by their short name).
    const tools = {}
    for (const { t, name } of toolUses.values()) {
      if (t < s.start || t > s.end) continue
      const short = name.startsWith('mcp__') ? name.split('__').slice(-1)[0] : name
      tools[short] = (tools[short] ?? 0) + 1
    }
    rows.push({
      request, result: s.result, session_id: sessionId,
      started_at: new Date(s.start).toISOString(), finished_at: new Date(s.end).toISOString(),
      wall_seconds: Math.round((s.end - s.start) / 1000), active_seconds: Math.round(active),
      turns: inside.length, model, models, tools,
      input_tokens: total.in, output_tokens: total.out, cache_read_tokens: total.cr, cache_write_tokens: total.cw,
      cost_usd: Math.round(usd * 100) / 100,
    })
  }
  rows.sort((a, b) => a.started_at.localeCompare(b.started_at))
  return rows
}

/** The one-screen summary the research report was written from. */
export function summarize(rows) {
  if (!rows.length) return 'Oturum kaydında tamamlanmış istek yok.'
  const median = (key) => [...rows].map((r) => r[key]).sort((a, b) => a - b)[Math.floor(rows.length / 2)]
  const sum = (key) => rows.reduce((n, r) => n + r[key], 0)
  const byModel = {}
  for (const r of rows) byModel[r.model] = (byModel[r.model] ?? 0) + 1
  const minutes = (s) => Math.round(s / 6) / 10
  return [
    `istek: ${rows.length} (${rows[0].started_at.slice(0, 10)} – ${rows.at(-1).started_at.slice(0, 10)})`,
    `aktif çalışma: toplam ${Math.floor(sum('active_seconds') / 3600)} sa ${Math.round((sum('active_seconds') % 3600) / 60)} dk, ortanca ${minutes(median('active_seconds'))} dk`,
    `ortanca: ${median('turns')} tur, ${median('output_tokens')} çıktı tokeni, ${median('cache_read_tokens')} önbellek okuma tokeni`,
    `API karşılığı: toplam ${sum('cost_usd').toFixed(2)} $, ortanca ${median('cost_usd').toFixed(2)} $`,
    `modeller: ${Object.entries(byModel).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ×${n}`).join(', ')}`,
  ].join('\n')
}
