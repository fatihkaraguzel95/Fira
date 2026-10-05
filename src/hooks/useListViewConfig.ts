import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DEFAULT_LIST_VIEW, listViewFromParams, listViewToParams, sanitizeListView, type ListViewConfig } from '../lib/listView'
import { usePrefs } from './usePrefs'

/**
 * The list view's config for one screen (#883CF8 / TL-01, TL-02).
 *
 * Three layers, last one wins: the screen's default, what the user last chose
 * here (user_preferences `<scope>.listView`, when a scope is given), and the
 * URL (`?group=&sort=&dir=`) so a view can be shared and the back button works.
 * Saved views (TL-09) will sit between the default and the URL.
 */
export function useListViewConfig(base: ListViewConfig = DEFAULT_LIST_VIEW, scope: string | null = null) {
  const [params, setParams] = useSearchParams()
  const prefs = usePrefs(scope)
  const [local, setLocal] = useState<ListViewConfig>(base)
  // Apply the remembered config once per scope, when it has actually arrived.
  const appliedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!scope || !prefs.loaded || appliedFor.current === scope) return
    appliedFor.current = scope
    const stored = (prefs.prefs as { listView?: unknown }).listView
    setLocal(stored ? sanitizeListView(stored, base) : base)
  }, [scope, prefs.loaded, prefs.prefs, base])
  useEffect(() => { if (!scope) setLocal(base) }, [scope, base])

  const config = useMemo(() => listViewFromParams(params, local), [params, local])
  const setConfig = useCallback((next: ListViewConfig) => {
    setLocal(next)
    if (scope) prefs.patch({ v: 1, listView: next })
    const p = listViewToParams(next, params, base)
    if (p.toString() !== params.toString()) setParams(p, { replace: true })
  }, [params, setParams, base, scope, prefs])
  return { config, setConfig }
}
