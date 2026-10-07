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
 * Three things keep the model on that one job over a long chat, because it does
 * drift otherwise — it starts troubleshooting, or chats, and no card ever comes:
 *   - the destination (team → list → column) is named in the prompt, so the
 *     ticket is a concrete thing being filled in and not an abstraction;
 *   - the purpose is restated in a short reminder appended *after* the history,
 *     the position a model actually attends to, with the remaining question
 *     budget in it;
 *   - prose never enters the transcript. A reply that is not one of the two
 *     shapes is re-asked for once and then normalised, so the history the next
 *     turn sees contains nothing but those two shapes.
 *
 * Nothing here writes to the database. A proposal stays a suggestion until the
 * person taps "Görevi aç", and the insert then runs under *their* token — so a
 * wrong guess by the model can never become a ticket on its own.
 */

/**
 * Hard ceiling on follow-up questions. The prompt asks for restraint; this is
 * what enforces it — once the budget is gone the next turn is forced to propose,
 * and a conversation can no longer wander indefinitely.
 */
export const MAX_QUESTIONS = 3

/** "takım → liste → sütun", as one phrase for the prompt and the nudges. */
export function destinationText(target) {
  if (!target?.project) return null
  const team = target.project.team?.name ? `${target.project.team.name} takımındaki ` : ''
  const column = target.status?.name ? ` "${target.status.name}" sütununa` : ' standart sütununa'
  return `${team}"${target.project.name}" listesinin${column}`
}

function systemPrompt(target) {
  const where = destinationText(target) ?? "Fira'da ayarlı listenin standart sütununa"

  return `Sen Fira'nın Telegram asistanısın. Tek bir işin var: bu konuşmayı ${where} açılacak TEK BİR görev (ticket) kaydına çevirmek. Başka hiçbir işin yok.

Sohbet arkadaşı ya da destek görevlisi değilsin: sorunu çözmeye çalışmaz, teşhis koymaz, tavsiye vermez, açıklama yapmazsın. Anlatılanı kayda geçirirsin, o kadar. Konuşma bu amacın dışına çıkarsa kibarca geri getir: {"ask": ...} ile hangi işi görev olarak açmak istediğini sor.

Görevin nereye açılacağı bellidir (${where}) ve bu senin kararın değil. Proje, liste, sütun, takım, kime atanacağı gibi şeyleri SORMA.

Yanıt vermeden önce konuşmayı analiz et: ne bozulmuş, nerede oluyor, ne zamandan beri, kim etkileniyor, ne olması gerekiyordu, ne oluyor. Eksik parçayı ancak o parça olmadan görev gerçekten yazılamıyorsa sor — yani sorman gereken şey "çok mantıklı", kaçınılmaz bir soru olmalı. Böyle bir şey yoksa SORMA, eldeki bilgiyle görevi öner. Soru sormak istisnadır; varsayılan davranış görevi önermektir.

Her yanıtın SADECE tek bir JSON nesnesi olacak. Açıklama, selamlama, kod bloğu işareti, serbest metin yok.

Yalnızca iki biçim var, üçüncüsü yok:

1) Yalnızca gerçekten kritik bir bilgi eksikse tek bir soru sor:
{"ask": "Tek bir kısa soru"}

2) Yeterli bilgi varsa görevi öner:
{"ticket": {"title": "...", "description": "...", "priority": "low|medium|high|critical"}}

Kurallar:
- Türkçe, kısa ve sade yaz. Emoji kullanma.
- Soru hakkın toplam ${MAX_QUESTIONS}, her yanıtta en fazla bir soru. Hak bitince eldeki bilgiyle ticket öner — bilgi az olsa bile öner, soru sorma.
- Her ticket, o ana kadar KONUŞULAN HER ŞEYİN özetidir: ilk mesajdan son mesaja kadar söylenen somut hiçbir bilgi kaybolmaz. Sonradan gelen bilgi öncekini günceller, silmez.
- Kullanıcı "yeter", "aç", "oluştur", "tamam" gibi bir şey derse hemen ticket öner.
- Kullanıcının söylemediğini uydurma. Bilinmeyen bilgiyi yazma, tahmin yürütme.
- Kullanıcı öneriyi düzeltirse düzeltmeyi uygulayıp görevin tamamını yeniden döndür.
- Kullanıcı birbirinden bağımsız birkaç iş anlattıysa en önemlisini tek ticket yap, kalanını "**Not**" altında say.

title: en fazla 80 karakter, sorunu tek cümlede söyleyen düz başlık. "Hata:" gibi ön ek, numara, emoji yok.

description: Markdown ve SABİT bir şablon — hem insan okuyacak hem başka bir yapay zekâ ayrıştıracak, o yüzden başlıkları birebir, kalın, kendi satırında yaz ve bu sırayı bozma. İçerik başlığın altındaki satırlara gelir. **Özet** her zaman yazılır; diğer bölümler yalnız konuşmada o bilgi geçtiyse yazılır — bilgisi olmayan bölümü hiç yazma, "bilinmiyor" diye doldurma.

**Özet**
Konuşmanın tamamının iki üç cümlelik özeti: ne oluyor, nerede, ne zamandan beri, kimi etkiliyor.

**Adımlar**
1. İlk adım
2. İkinci adım

**Beklenen**
Ne olmalıydı.

**Gerçekleşen**
Ne oluyor.

**Ortam**
- Cihaz/tarayıcı: ...
- Sürüm: ...
- Hesap/kullanıcı: ...

**Not**
Konuşmada geçen ama yukarıdaki bölümlere girmeyen her şey; varsa diğer işler.

priority: critical = kullanılamıyor veya veri kaybı, high = önemli işlev bozuk, medium = can sıkıcı ama yolu var, low = kozmetik. Emin değilsen medium.`
}

/**
 * Appended after the history on every call, not merged into the system prompt.
 *
 * A single instruction block at the very top loses to twenty messages of chat;
 * the same sentence in the last position does not. It also carries the live
 * question budget, which the system prompt cannot — and leaving the history
 * itself untouched keeps any provider-side prefix cache valid.
 */
const anchor = (target, questionsLeft) => {
  const where = destinationText(target)
  return [
    `[Hatırlatma] Tek amacın: bu konuşmayı${where ? ` ${where}` : ''} açılacak bir Fira görevine çevirmek.`,
    'Sohbet etme, çözüm önerme, nereye açılacağını sorma.',
    'Kritik bir eksik yoksa soru sormadan, konuşulanların tamamının özetiyle görevi öner.',
    `Yanıtın yalnızca tek bir JSON nesnesi olacak: {"ask": "..."} ya da {"ticket": {...}}. Kalan soru hakkı: ${questionsLeft}.`,
  ].join(' ')
}

/** Said when the budget is gone or the user asked for the card (/ozet). */
const FORCE_NUDGE = 'Soru sorma, soru hakkı kalmadı. Konuşulanların tamamının özetini çıkar ve şimdi yalnızca {"ticket": {...}} JSON nesnesini döndür. Şablondaki **Özet** bölümü zorunlu.'

/** Said once when a reply came back as prose instead of one of the two shapes. */
const REPAIR_NUDGE = 'Önceki yanıtın geçersizdi: serbest metin yazdın. Hiçbir açıklama ekleme, yalnızca {"ask": "..."} ya da {"ticket": {...}} nesnesini döndür.'

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

const toProposal = (ticket) => ({
  title: clean(ticket.title, 80) || 'Başlıksız görev',
  // Markdown keeps its line breaks; only the ends are trimmed.
  description: String(ticket.description ?? '').trim().slice(0, 4000),
  priority: PRIORITIES.has(ticket.priority) ? ticket.priority : 'medium',
})

/**
 * Last resort: build the proposal here, out of what the person actually wrote.
 *
 * Reached only when a forced turn still refuses to produce the object. The whole
 * point of this flow is a ticket, so ending a finished conversation with "the
 * model did not answer" fails the one job we have. It is still a proposal — the
 * card goes out with the same confirm buttons and nothing is written until the
 * person taps them.
 */
function localProposal(messages) {
  const said = messages
    .filter((m) => m.role === 'user')
    .map((m) => String(m.content ?? '').trim())
    .filter(Boolean)
  if (!said.length) return null

  // Aynı şablon: okuyan insan da, görevi sonra işleyecek yapay zekâ da
  // açıklamanın her zaman **Özet** ile başladığını görsün.
  const summary = said.length === 1 ? said[0] : said.map((s) => `- ${s}`).join('\n')
  return {
    title: clean(said[0], 80),
    description: `**Özet**\n${summary}\n\n**Not**\nKonuşmadan olduğu gibi alındı, özetlenmedi.`.slice(0, 4000),
    priority: 'medium',
  }
}

/** One chat/completions call. Returns the assistant's text, nothing else. */
async function complete(parts) {
  const completion = await sdk().chat.completions.create({
    model: config.aiModel,
    messages: parts,
    // Low temperature: this is extraction, not creative writing.
    temperature: 0.3,
    top_p: 0.95,
    max_tokens: 4096,
    // Thinking off — the answer is one small JSON object, and a reasoning
    // preamble only gives the parser more to wade through.
    chat_template_kwargs: { enable_thinking: false },
    stream: false,
  })
  return completion.choices?.[0]?.message?.content ?? ''
}

/**
 * One turn.
 *
 * `messages` is the plain chat history ([{role, content}, …]) — this endpoint is
 * stateless, so the whole conversation goes with every call. `target` is where
 * the ticket will be written; it goes into the prompt so the model is filling in
 * a concrete card. `questionsLeft` is the remaining question budget: at zero the
 * turn is forced, exactly as `force` (/ozet) does.
 *
 * Returns { kind: 'question', text, assistant } or { kind: 'proposal',
 * proposal, assistant }. `assistant` is the canonical JSON for this answer and
 * is what the caller must put in the transcript — never the raw text. Feeding
 * the model its own prose back is what teaches it that prose is allowed.
 */
export async function turn(messages, { force = false, target = null, questionsLeft = MAX_QUESTIONS } = {}) {
  const forced = force || questionsLeft <= 0
  const system = { role: 'system', content: systemPrompt(target) }
  const nudge = {
    role: 'user',
    content: forced ? FORCE_NUDGE : anchor(target, questionsLeft),
  }

  const raw = await complete([system, ...messages, nudge])
  let parsed = extractJson(raw)

  // Prose instead of an object: ask once more for the object alone. This is the
  // moment the conversation would otherwise slip out of the flow.
  if (!parsed) {
    const retry = await complete([
      system,
      ...messages,
      nudge,
      { role: 'assistant', content: raw },
      { role: 'user', content: REPAIR_NUDGE },
    ])
    parsed = extractJson(retry)
  }

  const ticket = parsed?.ticket
  if (ticket && (ticket.title || ticket.description)) {
    const proposal = toProposal(ticket)
    return { kind: 'proposal', proposal, assistant: JSON.stringify({ ticket: proposal }) }
  }

  // A forced turn has one acceptable outcome. If the model still asked something
  // (or said nothing usable), write the card ourselves from the conversation.
  if (forced) {
    const proposal = localProposal(messages)
    if (!proposal) throw new Error('Konuşmada görev yapılacak bir şey bulamadım.')
    return { kind: 'proposal', proposal, assistant: JSON.stringify({ ticket: proposal }) }
  }

  const text = clean(parsed?.ask ?? raw, 400)
  if (!text) throw new Error('Model boş yanıt verdi.')
  // Prose that survived the retry still reaches the user as a question — it is
  // usually answerable and the next turn recovers — but it enters the transcript
  // in the canonical shape, so the format itself never drifts.
  return { kind: 'question', text, assistant: JSON.stringify({ ask: text }) }
}
