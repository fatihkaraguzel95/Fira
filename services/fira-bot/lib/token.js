import { createHmac } from 'node:crypto'
import { config } from './config.js'

/**
 * How the bot gets to act *as* a user.
 *
 * Everything the bot does on someone's behalf has to go through that person's
 * own token, so RLS answers "may they?" and no permission rule is duplicated
 * here. Getting such a token depends on how the project signs JWTs:
 *
 *   1. Legacy HS256 — the project has a shared JWT secret (Dashboard → Project
 *      Settings → JWT Keys → "JWT Secret", present on older projects and on new
 *      ones that kept the legacy key). We sign locally: no round trip, no
 *      auth-side effects. Preferred.
 *
 *   2. Asymmetric signing keys (ES256/RS256) — the default for new projects.
 *      The private key never leaves Supabase, so nothing can be signed here.
 *      Instead we ask the Auth admin API for a one-time token for that user and
 *      exchange it for a real session. Same result, one extra round trip, so the
 *      access token is cached until shortly before it expires.
 *
 * Both paths end in a token minted for *one* user. Neither widens what that user
 * can do.
 */

const b64url = (input) => Buffer.from(input).toString('base64url')

/** Path 1: sign the token ourselves. */
function signHs256(userId, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + ttlSeconds,
  }))
  const signature = createHmac('sha256', config.jwtSecret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

async function auth(path, body) {
  const res = await fetch(`${config.supabaseUrl}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`auth/${path} → ${res.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

async function emailFor(userId) {
  const res = await fetch(`${config.supabaseUrl}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` },
  })
  if (!res.ok) throw new Error(`admin/users → ${res.status}`)
  const user = await res.json()
  if (!user?.email) throw new Error('kullanıcının e-postası yok, oturum üretilemiyor')
  return user.email
}

/**
 * Path 2: a genuine session, signed by Supabase itself.
 *
 * generate_link only *generates* — it sends no mail. The hash it returns is a
 * one-time token; verifying it yields the access token a browser login would
 * have produced.
 */
async function mintSession(userId) {
  const email = await emailFor(userId)
  const link = await auth('admin/generate_link', { type: 'magiclink', email })
  const hashed = link?.hashed_token ?? link?.properties?.hashed_token
  if (!hashed) throw new Error('generate_link token döndürmedi')

  const session = await auth('verify', { type: 'magiclink', token_hash: hashed })
  if (!session?.access_token) throw new Error('verify access_token döndürmedi')
  return {
    token: session.access_token,
    // Renew a minute early so a request never travels with a dead token.
    expiresAt: Date.now() + ((session.expires_in ?? 3600) - 60) * 1000,
  }
}

const cache = new Map() // userId → { token, expiresAt }
const inflight = new Map() // userId → Promise, so N messages mint one session

export async function accessToken(userId) {
  if (config.jwtSecret) return signHs256(userId, 120)

  const hit = cache.get(userId)
  if (hit && hit.expiresAt > Date.now()) return hit.token

  if (!inflight.has(userId)) {
    inflight.set(userId, mintSession(userId)
      .then((fresh) => {
        cache.set(userId, fresh)
        return fresh.token
      })
      .finally(() => inflight.delete(userId)))
  }
  return inflight.get(userId)
}

/** Which path is in use — printed at startup so the choice is never a surprise. */
export const tokenStrategy = () => (config.jwtSecret ? 'HS256 (JWT secret)' : 'Auth admin oturumu')
