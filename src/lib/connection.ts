/**
 * The connection status the UI shows (ConnectionBanner). Two independent signals:
 *   • online   — navigator.onLine, flipped by the browser's online/offline events
 *   • realtime — the Supabase channel state, reported by useRealtimeSync
 * A store rather than context so the one realtime hook can push updates without
 * every consumer re-rendering the tree.
 */
export type RealtimeState = 'connecting' | 'live' | 'dropped'

export interface ConnectionState {
  online: boolean
  realtime: RealtimeState
  /** When realtime last dropped, so the banner can wait out a brief blip before showing. */
  droppedSince: number | null
}

let state: ConnectionState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  realtime: 'connecting',
  droppedSince: null,
}

type Listener = (s: ConnectionState) => void
const listeners = new Set<Listener>()

const emit = () => listeners.forEach((fn) => fn(state))

export function getConnection() {
  return state
}

export function subscribeConnection(fn: Listener) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function setOnline(online: boolean) {
  if (state.online === online) return
  state = { ...state, online }
  emit()
}

export function setRealtime(realtime: RealtimeState) {
  if (state.realtime === realtime) return
  state = {
    ...state,
    realtime,
    droppedSince: realtime === 'dropped' ? (state.droppedSince ?? Date.now()) : null,
  }
  emit()
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setOnline(true))
  window.addEventListener('offline', () => setOnline(false))
}
