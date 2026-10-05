import { config } from './config.js'
import { accessToken } from './token.js'

/**
 * Two doors into the database, and the difference matters:
 *
 *   service.*      bypasses RLS. Used for exactly three things the user cannot do
 *                  for themselves: finding which Fira account a chat belongs to,
 *                  consuming a link code, and keeping draft/offset state.
 *
 *   asUser(id).*   carries a token minted for that user (see token.js), so every
 *                  read and write the bot performs on someone's behalf goes
 *                  through the same RLS policies as the web app. "May I open a
 *                  ticket in this project?" is answered by the database, not by
 *                  the bot.
 */

async function request(path, { method = 'GET', body, token, apikey, prefer } = {}) {
  const res = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(`${method} ${path.split('?')[0]} → ${res.status} ${text.slice(0, 300)}`)
    err.status = res.status
    err.body = text
    throw err
  }
  return text ? JSON.parse(text) : null
}

/** `getToken` is async: a user session may have to be fetched before the call. */
const client = (getToken, apikey) => {
  const call = async (path, options = {}) =>
    request(path, { ...options, token: await getToken(), apikey })
  return {
    select: (path) => call(path),
    insert: (table, rows, prefer = 'return=representation') =>
      call(table, { method: 'POST', body: rows, prefer }),
    upsert: (table, rows) =>
      call(table, { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' }),
    update: (path, patch) =>
      call(path, { method: 'PATCH', body: patch, prefer: 'return=representation' }),
    remove: (path) => call(path, { method: 'DELETE' }),
    rpc: (name, args = {}) => call(`rpc/${name}`, { method: 'POST', body: args }),
  }
}

export const service = client(() => config.serviceKey, config.serviceKey)
export const asUser = (userId) => client(() => accessToken(userId), config.anonKey)

/**
 * Tiny key/value store so a restart picks up where the service stopped.
 * Keys are namespaced per bot: a dev bot and the production bot can share one
 * database, and a shared getUpdates offset would make them eat each other's
 * messages.
 */
export async function getState(key) {
  const rows = await service.select(`bot_state?key=eq.${encodeURIComponent(key)}&select=value`)
  return rows?.[0]?.value ?? null
}

export async function setState(key, value) {
  await service.upsert('bot_state', { key, value, updated_at: new Date().toISOString() })
}
