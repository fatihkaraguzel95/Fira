/**
 * The colour of a person without a photo (#4029f71c): one rule for every place that draws
 * initials — avatars, the inbox, the activity panel, the system notification's icon.
 *
 * It used to be the first character of the id over six tones: of seven teammates only four
 * differed, and the inbox drew everyone in the same blue. A hash cannot do much better (seven
 * people over twelve tones still collide nine times out of ten), so the tone is handed out in
 * order: the people this account can see, oldest account first, take the tones one after the
 * other. Up to twelve people are all different; a new colleague takes the next tone and nobody
 * else changes.
 *
 * The order comes from one small read per session (ids only, what the account may see anyway).
 * Until it has arrived, and for anyone not in it, the tone falls back to a hash of the id, so
 * there is always a colour. The last order is kept for the session so a reload does not flash.
 * Two people can see different sets, so a person's tone is "theirs" per viewer, not globally.
 */
import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'

/**
 * White initials reach at least 5:1 on every tone (AA). The order matters: tones are handed out
 * from the top, so the first eight are the ones easiest to tell apart in a 24 px circle; the last
 * four are near neighbours of earlier ones (red by pink, cyan by teal) and only come up in a
 * larger group.
 */
export const AVATAR_TONES = [
  '#2563eb', // blue
  '#c2410c', // orange
  '#15803d', // green
  '#be185d', // pink
  '#9333ea', // purple
  '#0f766e', // teal
  '#475569', // slate
  '#92400e', // brown
  '#b91c1c', // red
  '#0e7490', // cyan
  '#3f6212', // olive
  '#a21caf', // fuchsia
] as const

/** FNV-1a over the whole id: the fallback when the order is not known. */
export function hashTone(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0) % AVATAR_TONES.length
}

/** The tone of each person, from the ids in order: the nth person takes the nth tone, round and round. */
export function tonesInOrder(ids: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const id of ids) if (!map.has(id)) map.set(id, map.size % AVATAR_TONES.length)
  return map
}

const STORE = 'fira:avatar-order'
let order = new Map<string, number>()
let asked = false
const listeners = new Set<() => void>()

try {
  const saved = JSON.parse(sessionStorage.getItem(STORE) ?? 'null') as string[] | null
  if (Array.isArray(saved)) order = tonesInOrder(saved.filter((x) => typeof x === 'string'))
} catch { /* a private window, or nothing saved */ }

function load() {
  if (asked) return
  asked = true
  void supabase.from('profiles').select('id').order('created_at', { ascending: true }).order('id', { ascending: true }).limit(2000).then(({ data, error }) => {
    if (error || !data) { asked = false; return }
    const ids = (data as { id: string }[]).map((r) => r.id)
    const next = tonesInOrder(ids)
    const same = next.size === order.size && ids.every((id) => order.get(id) === next.get(id))
    order = next
    try { sessionStorage.setItem(STORE, JSON.stringify(ids)) } catch { /* nowhere to keep it */ }
    if (!same) listeners.forEach((fn) => fn())
  })
}

/** For a signed-out page there is nobody to order; for tests, a fixed order. */
export function setAvatarOrder(ids: string[]) {
  order = tonesInOrder(ids)
  asked = true
  listeners.forEach((fn) => fn())
}

/** The colour for this person (an id; a name where there is no id). Not a hook: for canvas drawing and the like. */
export function avatarColor(key: string | null | undefined): string {
  const k = key ?? ''
  return AVATAR_TONES[order.get(k) ?? hashTone(k)]
}

const subscribe = (fn: () => void) => { listeners.add(fn); load(); return () => { listeners.delete(fn) } }
const version = () => order

/** The colour for this person, kept up to date when the order arrives. */
export function useAvatarColor(key: string | null | undefined): string {
  useSyncExternalStore(subscribe, version, version)
  return avatarColor(key)
}
