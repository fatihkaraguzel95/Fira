import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePrefs, GLOBAL_SCOPE, flushPrefsNow } from './usePrefs'
import { FAVORITES_KEY } from '../lib/favorites'
import type { CanvasKind } from '../types'

/**
 * Beta switches (#cf0c7678). Kept in the user's server-side preferences under
 * `beta`, off by default, per feature: the drawing and the whiteboard are two
 * separate choices.
 *
 * The server reads the same keys: RLS (096) shows drawing / whiteboard rows
 * only to someone who switched the feature on. So the tree, favourites and
 * search are refetched once the write has *landed* — refetching right after
 * the optimistic local change would still get the old answer from the server.
 */
export type BetaFeature = CanvasKind

export function useBeta() {
  const prefs = usePrefs(GLOBAL_SCOPE)
  const qc = useQueryClient()
  const beta = (prefs.prefs as { beta?: Partial<Record<BetaFeature, unknown>> }).beta ?? {}
  const drawing = beta.drawing === true
  const whiteboard = beta.whiteboard === true

  const set = useCallback((feature: BetaFeature, on: boolean) => {
    // null deletes the key on the server (merge_user_prefs): "off" leaves no trace.
    prefs.patch({ v: 1, beta: { [feature]: on ? true : null } })
    void flushPrefsNow(GLOBAL_SCOPE).then(() => {
      void qc.invalidateQueries({ queryKey: ['pages'] })
      void qc.invalidateQueries({ queryKey: FAVORITES_KEY })
      void qc.invalidateQueries({ queryKey: ['palette-search'] })
    })
  }, [prefs, qc])

  return {
    drawing,
    whiteboard,
    /** Is this canvas kind switched on? */
    has: (kind: BetaFeature) => (kind === 'drawing' ? drawing : whiteboard),
    /** Kinds the user may create, in menu order. */
    kinds: [...(drawing ? ['drawing' as const] : []), ...(whiteboard ? ['whiteboard' as const] : [])] as BetaFeature[],
    loaded: prefs.loaded,
    set,
  }
}
