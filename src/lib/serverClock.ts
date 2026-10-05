import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'

/**
 * The server's clock, as this browser can know it (#68c7c4d5).
 *
 * Something several people watch at once (the whiteboard's timer) cannot be counted against each
 * computer's own clock: a laptop that is a minute off would show a minute more or less. So the
 * moments are written in the server's time, and each browser learns once how far its own clock is
 * from it: one request, the `Date` header of the answer, the middle of the round trip.
 *
 * The header has whole seconds, so screens agree to within about a second; that is what a
 * countdown people glance at needs. When the header cannot be read (another origin without it
 * exposed, a failed request) the difference stays 0: the timer then runs on the computer's clock,
 * as it would have without this.
 *
 * The request goes to the API path, never to the app's own files: those come from the service
 * worker's cache, with the `Date` of the day they were cached.
 */
let offsetMs = 0
let asked: Promise<void> | null = null

/** The server's clock is this far ahead of the computer's (negative: behind). */
export function offsetFrom(dateHeader: string | null, sentAt: number, receivedAt: number): number | null {
  if (!dateHeader) return null
  const stamped = Date.parse(dateHeader)
  if (!Number.isFinite(stamped) || receivedAt < sentAt) return null
  // The header says "this second": on average half a second of it has passed.
  const offset = stamped + 500 - (sentAt + receivedAt) / 2
  // A day off is not a clock difference, it is something else answering (a cache, a proxy).
  return Math.abs(offset) > 86_400_000 ? null : Math.round(offset)
}

/** Now, in the server's time. Before `syncServerClock` answers this is the computer's own clock. */
export const serverNow = () => Date.now() + offsetMs

/** Learn the difference, once per page load (callers may call it as often as they like). */
export function syncServerClock(): Promise<void> {
  asked ??= (async () => {
    try {
      const sentAt = Date.now()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { method: 'HEAD', cache: 'no-store', headers: { apikey: SUPABASE_ANON_KEY } })
      const offset = offsetFrom(res.headers.get('date'), sentAt, Date.now())
      if (offset !== null) offsetMs = offset
    } catch { /* the computer's clock it is */ }
  })()
  return asked
}
