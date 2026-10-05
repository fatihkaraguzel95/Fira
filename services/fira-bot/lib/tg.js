import { config } from './config.js'

/**
 * Bot API wrapper.
 *
 * Fira sits behind the corporate VPN and nothing can reach *in*, so there is no
 * webhook: the bot long-polls getUpdates instead. Telegram also rate-limits
 * (~30 messages/second overall, roughly one per second into the same chat) and
 * answers 429 with retry_after, so every call goes through one paced queue.
 */

const MIN_GAP_MS = 60
let lastCall = 0

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function api(method, payload = {}, { retries = 3 } = {}) {
  const gap = Date.now() - lastCall
  if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap)
  lastCall = Date.now()

  let res
  let data
  try {
    res = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Long polling holds the socket open; give it more than the poll timeout.
      signal: AbortSignal.timeout((config.pollTimeout + 20) * 1000),
    })
    data = await res.json()
  } catch (err) {
    if (retries > 0) {
      await sleep(2000)
      return api(method, payload, { retries: retries - 1 })
    }
    throw new Error(`${method}: ${err.message}`)
  }

  if (data.ok) return data.result

  if (res.status === 429 && retries > 0) {
    await sleep((data.parameters?.retry_after ?? 1) * 1000 + 250)
    return api(method, payload, { retries: retries - 1 })
  }

  const err = new Error(`${method}: ${data.description ?? res.status}`)
  err.status = res.status
  err.description = data.description ?? ''
  throw err
}

/** The user blocked the bot or deleted the chat — stop writing to them. */
export const isBlocked = (err) =>
  err?.status === 403 || /bot was blocked|user is deactivated|chat not found/i.test(err?.description ?? '')

export const sendMessage = (chatId, text, extra = {}) =>
  api('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  })

export const editMessageText = (chatId, messageId, text, extra = {}) =>
  api('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  })

/** Telegram shows the spinner on a button until this is answered. Never throws. */
export const answerCallback = (id, text = '', showAlert = false) =>
  api('answerCallbackQuery', { callback_query_id: id, text, show_alert: showAlert }).catch(() => null)

export const getUpdates = (offset) =>
  api('getUpdates', {
    offset,
    timeout: config.pollTimeout,
    allowed_updates: ['message', 'callback_query'],
  })

export const getMe = () => api('getMe')

/** "… yazıyor" göstergesi: yapay zekâ yanıtı birkaç saniye sürebiliyor. */
export const sendTyping = (chatId) =>
  api('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => null)

export const setMyCommands = () =>
  api('setMyCommands', {
    commands: [
      { command: 'yeni', description: 'Yeni görev aç (adım adım)' },
      { command: 'ozet', description: 'Konuşmayı görev kartına çevir' },
      { command: 'hedef', description: 'Görevlerin açılacağı proje ve sütun' },
      { command: 'bana', description: 'Bana atanmış açık görevler' },
      { command: 'bugun', description: 'Bugün ve gecikmiş işlerim' },
      { command: 'gorev', description: 'Görev kartı: /gorev 118F5C' },
      { command: 'iptal', description: 'Yarım kalan taslağı sil' },
      { command: 'yardim', description: 'Komutlar' },
    ],
  })

/** Lay flat buttons out in rows of `perRow`. */
export const keyboard = (buttons, perRow = 2) => {
  const rows = []
  for (let i = 0; i < buttons.length; i += perRow) rows.push(buttons.slice(i, i + perRow))
  return { inline_keyboard: rows }
}
