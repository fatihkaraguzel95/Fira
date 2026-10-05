import { createClient, processLock } from '@supabase/supabase-js'

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string

/**
 * VITE_SUPABASE_URL may be absolute (https://host/api, cloud URL) or relative
 * ('/api'). A relative value is resolved against the page origin at runtime so
 * the app works whether it is opened via the domain or the server IP — the
 * API request then stays same-origin and inherits the browser's certificate
 * decision for the page (an untrusted cert on a cross-origin fetch fails
 * silently with 'Failed to fetch').
 */
const supabaseUrl = rawUrl && rawUrl.startsWith('/') && typeof window !== 'undefined'
  ? window.location.origin + (rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl)
  : rawUrl
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
/** For the few calls made without supabase-js (upload progress needs XHR — lib/uploads.ts). */
export const SUPABASE_URL = supabaseUrl
export const SUPABASE_ANON_KEY = supabaseAnonKey

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase URL ve Anon Key .env dosyasında tanımlanmalıdır.')
}

/**
 * Same API, one extra request header: `x-fira-bulk: 1`. The activity trigger
 * reads it (PostgREST exposes request headers) and flags every row it writes as
 * bulk, so an import of two hundred tasks does not fan out into two hundred
 * notifications. This client has no session of its own — it borrows the main
 * client's access token per request and never talks to GoTrue.
 */
export const supabaseBulk = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'fira-bulk' },
  global: {
    headers: { 'x-fira-bulk': '1' },
    fetch: async (input, init = {}) => {
      const { data: { session } } = await supabase.auth.getSession()
      const headers = new Headers(init.headers)
      if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
      return fetch(input, { ...init, headers })
    },
  },
})

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
    autoRefreshToken: true,
    // Default is navigator.locks shared across ALL tabs/PWA windows of the origin; a busy or frozen tab can hold it
    // and every other tab waits 10 s ("Acquiring an exclusive Navigator LockManager lock … timed out").
    // The in-process lock only serialises calls inside this tab; GoTrue tolerates the rare concurrent refresh.
    lock: processLock,
  },
})
