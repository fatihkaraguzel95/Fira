import { config } from './config.js'

/** Telegram HTML mode: only these three characters have to be escaped. */
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The short id the board prints on a card: first six hex digits, uppercase. */
export const shortId = (id) => String(id ?? '').replace(/-/g, '').slice(0, 6).toUpperCase()

/**
 * Button payload id. callback_data is capped at 64 bytes, so a full uuid plus a
 * prefix plus a second id will not fit; twelve hex digits are unique enough
 * inside one user's project or status list, which is all we ever match against.
 */
export const ref = (id) => String(id ?? '').replace(/-/g, '').slice(0, 12)
export const byRef = (rows, value) => (rows ?? []).find((r) => ref(r.id) === value) ?? null

export const PRIORITY_LABEL = { low: 'Düşük', medium: 'Orta', high: 'Yüksek', critical: 'Kritik' }
const PRIORITY_ICON = { low: '⬇️', medium: '', high: '🔸', critical: '🔴' }

export const ticketUrl = (id) => `${config.baseUrl}/ticket/${id}`

export const trim = (s, n) => {
  const clean = String(s ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean
}

export function dueLabel(due) {
  if (!due) return null
  const date = new Date(`${due}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((date - today) / 86400000)
  const text = date.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
  if (days < 0) return `⚠️ ${text} (${-days} gün gecikti)`
  if (days === 0) return `📅 ${text} (bugün)`
  if (days === 1) return `📅 ${text} (yarın)`
  return `📅 ${text}`
}

const priorityChip = (p) => (p ? `${PRIORITY_ICON[p] ?? ''} ${PRIORITY_LABEL[p] ?? p}`.trim() : null)

/** Full card: shown for /gorev, after a status change, and once a ticket is created. */
export function ticketCard(ticket, { header } = {}) {
  const lines = []
  if (header) lines.push(header, '')
  lines.push(`<b>${esc(ticket.title)}</b>  <code>#${shortId(ticket.id)}</code>`)

  const meta = []
  if (ticket.project?.name) meta.push(`📁 ${esc(ticket.project.name)}`)
  if (ticket.status_info?.name) meta.push(`🔵 ${esc(ticket.status_info.name)}`)
  const chip = priorityChip(ticket.priority)
  if (chip) meta.push(chip)
  const due = dueLabel(ticket.due_date)
  if (due) meta.push(due)
  if (meta.length) lines.push(meta.join(' · '))

  const people = (ticket.assignees ?? []).map((a) => a.user?.full_name || a.user?.email).filter(Boolean)
  if (people.length) lines.push(`👥 ${esc(people.join(', '))}`)

  if (ticket.description) lines.push('', `<i>${esc(trim(ticket.description, 350))}</i>`)
  lines.push('', `<a href="${ticketUrl(ticket.id)}">Fira'da aç</a>`)
  return lines.join('\n')
}

/** Compact line for /bana and /bugun. */
export const ticketLine = (t) => {
  const due = t.due_date ? ` · ${dueLabel(t.due_date)}` : ''
  return `• <b>${esc(trim(t.title, 70))}</b> <code>#${shortId(t.id)}</code>${due}`
}

/**
 * The model answers in Markdown; Telegram speaks a small HTML subset. Escape
 * first (so the model can never inject markup), then translate the three things
 * it actually uses: bold, inline code, and bullet dashes.
 */
export function mdToHtml(md) {
  return esc(String(md ?? '').trim())
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
}

/** What the draft looks like so far — the text every compose step edits in place. */
export function draftView(draft, projectName, prompt) {
  const lines = ['<b>➕ Yeni görev</b>', '']
  lines.push(`📁 ${projectName ? esc(projectName) : '<i>proje seçilmedi</i>'}`)
  if (draft.title) lines.push(`📝 <b>${esc(trim(draft.title, 120))}</b>`)
  if (draft.description) lines.push(`🗒 <i>${esc(trim(draft.description, 200))}</i>`)
  const chip = priorityChip(draft.priority)
  if (chip) lines.push(`🚩 ${chip}`)
  if (prompt) lines.push('', prompt)
  return lines.join('\n')
}
