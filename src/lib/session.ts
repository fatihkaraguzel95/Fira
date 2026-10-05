import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Who is signed in — from the local session, not the network.
 *
 * `supabase.auth.getUser()` re-validates the token against GoTrue on every
 * call. Hooks were calling it before almost every write, which turned a single
 * click into an extra /auth/v1/user round trip and, behind a per-IP rate limit,
 * into sporadic 401s that made the team list flicker. The session in local
 * storage already carries the user (and the client refreshes it itself); that
 * is all these call sites need. `getUser()` stays the right tool where the
 * token must be proven fresh (profile/password screens).
 */
export async function currentUser(): Promise<User | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user) return session.user
  const { data: { user } } = await supabase.auth.getUser()
  return user ?? null
}
