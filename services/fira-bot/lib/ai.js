import OpenAI from 'openai'
import { config } from './config.js'

/**
 * The model's single job: turn a loose Telegram conversation into one clean
 * ticket.
 *
 * Provider is NVIDIA NIM through its OpenAI-compatible endpoint (nemotron by
 * default), so this file speaks chat/completions.
 *
 * Why JSON-in-the-reply instead of tool calls: tool-calling support differs per
 * model on that endpoint, and a silent "no tool_calls field" would strand the
 * conversation. Asking for one JSON object works on any chat endpoint, and the
 * parser below is deliberately forgiving — fenced blocks, a reasoning preamble,
 * or trailing prose all still yield the object.
 *
 * The reply says what to do next by its shape:
 *   {"ask": "..."}      → a follow-up question to forward to the user
 *   {"ticket": {...}}   → a proposal to show with confirm buttons
 *
 * Nothing here writes to the database. A proposal stays a suggestion until the
 * person taps "Görevi aç", and the insert then runs under *their* token — so a
 * wrong guess by the model can never become a ticket on its own.
 */

const SYSTEM = `Sen Fira'nın Telegram asistanısın. Kullanıcı telefonundan serbestçe yazıyor; senin işin bu konuşmayı tek bir düzgün görev (ticket) kaydına çevirmek.

Her yanıtın SADECE tek bir JSON nesnesi olacak. Açıklama, selamlama, kod bloğu işareti ekleme.

İki biçimden birini kullan:

1) Eksik kritik bilgi varsa soru sor:
{"ask": "Tek bir kısa soru"}

2) Yeterli bilgi varsa görevi öner:
{"ticket": {"title": "...", "description": "...", "priority": "low|medium|high|critical"}}

Kurallar:
- Türkçe, kısa ve sade yaz. Emoji kullanma.
- Az soru sor: toplamda en fazla 2-3 soru, her yanıtta bir tane. Kullanıcı "yeter", "aç", "oluştur" derse hemen ticket öner.
- Kullanıcının söylemediğini uydurma. Bilinmeyen bilgiyi yazma.
- Kullanıcı öneriyi düzeltirse düzeltmeyi uygulayıp yeni bir ticket nesnesi döndür.

title: en fazla 80 karakter, sorunu tek cümlede söyleyen düz başlık. "Hata:" gibi ön ek, numara, emoji yok.

description: Markdown. Yalnızca içeriği olan bölümleri yaz, boş bölüm ekleme:
**Özet** — iki üç cümle
**Adımlar** — numaralı liste (kullanıcı anlattıysa)
**Beklenen** / **Gerçekleşen** — ikisi de biliniyorsa
**Ortam** — cihaz, sürüm, hesap gibi detaylar söylendiyse
**Not** — kalan ayrıntılar

priority: critical = kullanılamıyor veya veri kaybı, high = önemli işlev bozuk, medium = can sıkıcı ama yolu var, low = kozmetik. Emin değilsen medium.`

/** Said once, at the end, when the user is done talking and we want the card. */
const FORCE_NUDGE = 'Soru sorma. Konuşmadaki bilgiyle şimdi {"ticket": {...}} döndür.'

const PRIORITIES = new Set(['low', 'medium', 'high', 'critical'])

let client = null
const sdk = () => (client ??= new OpenAI({ apiKey: config.aiKey, baseURL: config.aiBaseUrl }))

export const aiEnabled = () => Boolean(config.aiKey)

/** Index of the `}` closing the `{` at `start`, or -1. Skips braces in strings. */
function balancedEnd(text, start) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

/**
 * Escape raw control characters that sit *inside* a string literal.
 *
 * This is the common failure here, not an edge case: the description is
 * multi-line Markdown, and models routinely emit those line breaks literally
 * instead of as \n — which is invalid JSON and would otherwise throw away a
 * perfectly good ticket.
 */
function repairControlChars(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue }
      if (ch === '\\') { out += ch; escaped = true; continue }
      if (ch === '"') { inString = false; out += ch; continue }
      if (ch === '\n') { out += '\\n'; continue }
      if (ch === '\r') { out += '\\r'; continue }
      if (ch === '\t') { out += '\\t'; continue }
      out += ch
      continue
    }
    if (ch === '"') inString = true
    out += ch
  }
  return out
}

/**
 * Pull our object out of a reply. Models fence it in ```json, prefix it with a
 * sentence, leak a reasoning preamble containing its own braces, or break lines
 * inside strings — so every `{` is tried as a candidate, raw and repaired, and
 * the first one carrying `ask` or `ticket` wins. A stray `{}` is ignored.
 */
export function extractJson(raw) {
  const text = String(raw ?? '').replace(/```json|```/gi, '').trim()

  const chunks = [text]
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{') continue
    const end = balancedEnd(text, i)
    if (end !== -1) chunks.push(text.slice(i, end + 1))
  }

  for (const chunk of chunks) {
    for (const attempt of [chunk, repairControlChars(chunk)]) {
      try {
        const parsed = JSON.parse(attempt)
        if (parsed && typeof parsed === 'object' && (parsed.ask || parsed.ticket)) return parsed
      } catch {
        // Sonraki adaya geç.
      }
    }
  }
  return null
}

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * One turn.
 *
 * `messages` is the plain chat history ([{role, content}, …]) — this endpoint is
 * stateless, so the whole conversation goes with every call. `force` appends the
 * nudge above instead of editing the system prompt, which keeps the history (and
 * any provider-side prefix cache) intact.
 *
 * Returns { kind: 'question', text, raw } or { kind: 'proposal', proposal, raw }.
 * `raw` is what the assistant actually said; it goes back into the transcript so
 * the next turn sees its own previous answer.
 */
export async function turn(messages, { force = false } = {}) {
  const completion = await sdk().chat.completions.create({
    model: config.aiModel,
    messages: [
      { role: 'system', content: SYSTEM },
      ...messages,
      ...(force ? [{ role: 'user', content: FORCE_NUDGE }] : []),
    ],
    // Low temperature: this is extraction, not creative writing.
    temperature: 0.3,
    top_p: 0.95,
    max_tokens: 4096,
    // Thinking off — the answer is one small JSON object, and a reasoning
    // preamble only gives the parser more to wade through.
    chat_template_kwargs: { enable_thinking: false },
    stream: false,
  })

  const raw = completion.choices?.[0]?.message?.content ?? ''
  const parsed = extractJson(raw)

  const ticket = parsed?.ticket
  if (ticket && (ticket.title || ticket.description)) {
    return {
      kind: 'proposal',
      raw,
      proposal: {
        title: clean(ticket.title, 80) || 'Başlıksız görev',
        // Markdown keeps its line breaks; only the ends are trimmed.
        description: String(ticket.description ?? '').trim().slice(0, 4000),
        priority: PRIORITIES.has(ticket.priority) ? ticket.priority : 'medium',
      },
    }
  }

  if (parsed?.ask) return { kind: 'question', raw, text: clean(parsed.ask, 400) }

  // Neither shape came back. Rather than drop the turn, pass the text along as a
  // question — the user can answer it and the next turn usually recovers.
  const fallback = clean(raw, 400)
  if (fallback) return { kind: 'question', raw, text: fallback }
  throw new Error('Model boş yanıt verdi.')
}
