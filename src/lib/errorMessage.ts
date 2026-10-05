/**
 * One place that turns a thrown error — PostgREST, GoTrue, a network failure, an
 * nginx 429 — into a short sentence a person can act on, in the interface
 * language. Everything that shows an error to the user (toasts, inline panels)
 * goes through here so the wording stays consistent and no raw "TypeError:
 * Failed to fetch" reaches a screen.
 *
 * The tables below hold translation *keys*, not sentences: a module-level table
 * of translated strings would be built once at import and freeze the language
 * for the session. `friendlyError` translates at call time instead.
 */
import { t, type TranslationKey } from '../i18n'

export type ErrorKind = 'rate_limit' | 'offline' | 'auth' | 'forbidden' | 'conflict' | 'notfound' | 'server' | 'rule' | 'unknown'

export interface FriendlyError {
  kind: ErrorKind
  title: string
  detail?: string
}

interface AnyErr {
  status?: number
  code?: string
  message?: string
  error?: string
  name?: string
  details?: string
  hint?: string
}

const str = (e: unknown): string => {
  const a = e as AnyErr
  return [a?.code, a?.status, a?.message, a?.error, a?.details, a?.name, typeof e === 'string' ? e : '']
    .filter(Boolean)
    .join(' ')
}

/** A fetch that never reached the server (offline, DNS, TLS, CORS) rejects with a TypeError. */
const isNetwork = (e: unknown) => {
  const a = e as AnyErr
  return a?.name === 'TypeError' && /fetch|network|load failed/i.test(a?.message ?? '')
}

export function classifyError(e: unknown): ErrorKind {
  const s = str(e)
  const status = (e as AnyErr)?.status
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  if (isNetwork(e)) return 'offline'
  if (status === 429 || /\b429\b|too many|rate limit/i.test(s)) return 'rate_limit'
  if (status === 401 || /\b401\b|jwt|token .*expired|invalid.*token|not authenticated|oturum/i.test(s)) return 'auth'
  // 42501 = insufficient_privilege (RLS); PGRST301 = no matching row for the role
  if (status === 403 || /\b403\b|42501|permission denied|row-level security|not allowed/i.test(s)) return 'forbidden'
  if ((e as AnyErr)?.code === 'PGRST116' || /no rows|0 rows/i.test(s)) return 'notfound'
  // Business rules the database RAISEs (e.g. subtask depth, same-list, cycles)
  // carry a ready, user-facing Turkish sentence — surface that sentence instead
  // of a generic "something went wrong". `23514` is a CHECK constraint, `P0001`
  // is a plain `RAISE EXCEPTION`; taşıma kuralları P0001 ile geliyordu ve
  // kullanıcı iki kez "bir şeyler ters gitti" gördü (#4e8dc8f1, 28 Eyl).
  if ((e as AnyErr)?.code === '23514' || (e as AnyErr)?.code === 'P0001' || /check_violation/i.test(s)) return 'rule'
  if (typeof status === 'number' && status >= 500) return 'server'
  if (typeof status === 'number' && status >= 400) return 'unknown'
  return 'unknown'
}

const TITLE_KEYS: Record<ErrorKind, TranslationKey> = {
  rate_limit: 'misc.error.rateLimit.title',
  offline: 'misc.error.offline.title',
  auth: 'misc.error.auth.title',
  forbidden: 'misc.error.forbidden.title',
  conflict: 'misc.error.conflict.title',
  notfound: 'misc.error.notfound.title',
  server: 'misc.error.server.title',
  rule: 'misc.error.rule.title',
  unknown: 'common.somethingWentWrong',
}

const DETAIL_KEYS: Partial<Record<ErrorKind, TranslationKey>> = {
  rate_limit: 'misc.error.rateLimit.detail',
  offline: 'misc.error.offline.detail',
  auth: 'misc.error.auth.detail',
  forbidden: 'misc.error.forbidden.detail',
  conflict: 'misc.error.conflict.detail',
  server: 'misc.error.server.detail',
}

export function friendlyError(e: unknown, fallbackDetail?: string): FriendlyError {
  const kind = e && (e as AnyErr).name === 'FiraConflictError' ? 'conflict' : classifyError(e)
  // A raised business rule already says exactly what went wrong — use its own
  // text. It comes from the database in Turkish and is passed through as it is;
  // translating it here would need a copy of every rule message.
  if (kind === 'rule') {
    const msg = (e as AnyErr)?.message?.trim()
    return { kind, title: msg && msg.length > 0 && msg.length < 200 ? msg : t(TITLE_KEYS.rule) }
  }
  const detailKey = DETAIL_KEYS[kind]
  return { kind, title: t(TITLE_KEYS[kind]), detail: detailKey ? t(detailKey) : fallbackDetail }
}

/** Thrown by guarded writes when the row changed underneath the edit. */
export class ConflictError extends Error {
  name = 'FiraConflictError'
  constructor(public readonly latest?: unknown) {
    super('conflict')
  }
}
