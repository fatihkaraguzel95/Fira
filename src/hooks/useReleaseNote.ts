import { useCallback, useEffect } from 'react'
import { APP_VERSION } from '../version'
import { useAuth } from './useAuth'
import { usePrefs } from './usePrefs'
import { legacySeenKey, nextReleaseState, releaseVisible, type ReleaseState } from '../lib/releaseNote'

/** One write per account and build, however many components ask (#2aa4f068). */
const stamped = new Set<string>()

/**
 * The "Fira was updated" inbox row for this account (`lib/releaseNote.ts`):
 * records a newer build the first time it loads and answers whether there is a
 * row and whether it is unread. Reading it is a preference write, so it follows
 * the account across devices.
 */
export function useReleaseNote() {
  const { user } = useAuth()
  const { prefs, loaded, patch } = usePrefs('global')
  const state = prefs.release as ReleaseState | undefined

  useEffect(() => {
    if (!user || !loaded) return
    const key = `${user.id}:${APP_VERSION}`
    if (stamped.has(key)) return
    stamped.add(key)
    let legacy: string | null = null
    try { legacy = localStorage.getItem(legacySeenKey(user.id)) } catch { /* private mode: start clean */ }
    const next = nextReleaseState(state, APP_VERSION, legacy, new Date().toISOString())
    if (next) patch({ release: next })
  }, [user?.id, loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = releaseVisible(state, APP_VERSION)
  const setRead = useCallback((read: boolean) => { patch({ release: { read } }) }, [patch])
  /** Yönetim › Araçlar: put the row back, unread, as if this build had just arrived after `from`. */
  const replay = useCallback((from: string) => {
    patch({ release: { version: APP_VERSION, from, at: new Date().toISOString(), read: false } })
  }, [patch])
  return { state: visible ? state : null, unread: visible && !state.read, setRead, replay }
}
