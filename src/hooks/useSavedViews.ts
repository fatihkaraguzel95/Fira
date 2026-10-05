import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useListViews, useListViewMutations, type SavedView, type SavedViewConfig, type ViewsKey, type ViewType } from './useListViews'
import { usePrefs, GLOBAL_SCOPE } from './usePrefs'
import { useAuth } from './useAuth'
import { sanitizeListView, DEFAULT_LIST_VIEW, type ListViewConfig } from '../lib/listView'

/**
 * The saved-views logic behind a screen's view bar (#883CF8 / TL-09).
 *
 * The screen owns its live state (config, filters, type). This hook knows the
 * saved rows, which one is active (URL `?v=` wins, else the per-screen
 * preference, else the team default), whether the live state drifted from it
 * ("unsaved" dot), and how to save / save as / revert / autosave. Folded groups
 * are not part of a view — they are how you look at it today, not what it is.
 */
export interface LiveState { type: ViewType; list: ListViewConfig; filters?: Record<string, unknown>; slice?: string }

const norm = (c: SavedViewConfig | undefined, type: ViewType): string => {
  const list = c?.list ? sanitizeListView(c.list, DEFAULT_LIST_VIEW) : DEFAULT_LIST_VIEW
  const cleanFilters = Object.fromEntries(Object.entries(c?.filters ?? {}).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length) && v !== false))
  return JSON.stringify({ type, list: { ...list, collapsed: [] }, filters: cleanFilters, slice: c?.slice ?? null })
}

export function useSavedViews(opts: {
  key: ViewsKey | null
  /** Prefs scope that remembers the active / personal-default view (e.g. `list:<projectId>`, `me:tasks`). */
  prefsScope: string | null
  live: LiveState
  /** Put a saved view's state on the screen. */
  apply: (view: SavedView) => void
  /** Back to the screen's own remembered state (no view). */
  reset?: () => void
  canManageTeam?: boolean
}) {
  const { key, prefsScope, live, apply, reset, canManageTeam = false } = opts
  const { user } = useAuth()
  const views = useListViews(key)
  const mut = useListViewMutations(key)
  const prefs = usePrefs(prefsScope)
  const global = usePrefs(GLOBAL_SCOPE)
  const [params, setParams] = useSearchParams()
  const [activeId, setActiveId] = useState<string | null>(null)
  const applied = useRef<string | null>(null)   // "<scope>:<viewId>" already applied
  const chosenFor = useRef<string | null>(null)  // the user picked (or cleared) a view on this scope: defaults stay out of the way
  const autosave = (global.prefs as { viewAutosave?: unknown }).viewAutosave === true

  const list = views.data ?? []
  const active = useMemo(() => list.find((v) => v.id === activeId) ?? null, [list, activeId])
  const liveKey = norm({ list: live.list, filters: live.filters as SavedViewConfig['filters'], slice: live.slice }, live.type)
  const dirty = !!active && norm(active.config, active.type) !== liveKey
  const canEdit = (v: SavedView) => !!user && (v.owner_id === user.id || (v.is_shared && canManageTeam))

  // Which view to open: URL, then the remembered one, then the team default (once per scope).
  useEffect(() => {
    if (!key || !views.data || !prefsScope || !prefs.loaded) return
    if (chosenFor.current === prefsScope) return
    const fromUrl = params.get('v')
    const remembered = (prefs.prefs as { activeView?: unknown }).activeView
    const wanted = fromUrl ?? (typeof remembered === 'string' ? remembered : null) ?? list.find((v) => v.is_shared && v.is_default)?.id ?? ((prefs.prefs as { defaultView?: unknown }).defaultView as string | undefined) ?? null
    const tag = `${prefsScope}:${wanted ?? ''}`
    if (applied.current === tag) return
    applied.current = tag
    const v = wanted ? list.find((x) => x.id === wanted) : null
    setActiveId(v?.id ?? null)
    if (v) apply(v)
  }, [key, views.data, prefsScope, prefs.loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback((v: SavedView | null) => {
    chosenFor.current = prefsScope
    setActiveId(v?.id ?? null)
    applied.current = `${prefsScope}:${v?.id ?? ''}`
    if (prefsScope) prefs.patch({ v: 1, activeView: v?.id ?? null })
    const p = new URLSearchParams(params)
    if (v) p.set('v', v.id); else p.delete('v')
    if (p.toString() !== params.toString()) setParams(p, { replace: true })
    if (v) apply(v); else reset?.()
  }, [prefsScope, prefs, params, setParams, apply, reset])

  const snapshot = (): { type: ViewType; config: SavedViewConfig } => ({ type: live.type, config: { list: { ...live.list, collapsed: [] }, filters: live.filters as SavedViewConfig['filters'], slice: live.slice } })

  const save = useCallback(async () => {
    if (!active || !canEdit(active)) return
    const s = snapshot()
    await mut.update.mutateAsync({ id: active.id, patch: { type: s.type, config: s.config } })
  }, [active, mut.update, liveKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveAs = useCallback(async (name: string, shared: boolean) => {
    const s = snapshot()
    const v = await mut.create.mutateAsync({ name, type: s.type, config: s.config, is_shared: shared })
    chosenFor.current = prefsScope
    setActiveId(v.id); applied.current = `${prefsScope}:${v.id}`
    if (prefsScope) prefs.patch({ v: 1, activeView: v.id })
    const p = new URLSearchParams(params); p.set('v', v.id); setParams(p, { replace: true })
    return v
  }, [mut.create, prefsScope, prefs, params, setParams, liveKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const revert = useCallback(() => { if (active) apply(active) }, [active, apply])
  const rename = (v: SavedView, name: string) => mut.update.mutateAsync({ id: v.id, patch: { name } })
  const remove = async (v: SavedView) => { await mut.remove.mutateAsync(v.id); if (v.id === activeId) select(null) }
  const setShared = (v: SavedView, is_shared: boolean) => mut.update.mutateAsync({ id: v.id, patch: { is_shared, ...(is_shared ? {} : { is_default: false, is_protected: false }) } })
  const setProtected = (v: SavedView, is_protected: boolean) => mut.update.mutateAsync({ id: v.id, patch: { is_protected } })
  const setTeamDefault = (v: SavedView, on: boolean) => mut.update.mutateAsync({ id: v.id, patch: { is_default: on } })
  const setMyDefault = (v: SavedView | null) => { if (prefsScope) prefs.patch({ v: 1, defaultView: v?.id ?? null }) }
  const myDefaultId = ((prefs.prefs as { defaultView?: unknown }).defaultView as string | undefined) ?? null
  const setAutosave = (on: boolean) => global.patch({ v: 1, viewAutosave: on ? true : null })

  // Autosave: my own view, drifted, and the switch is on → write after a second of quiet.
  useEffect(() => {
    if (!autosave || !dirty || !active || !canEdit(active)) return
    const id = window.setTimeout(() => { void save() }, 1000)
    return () => window.clearTimeout(id)
  }, [autosave, dirty, active?.id, liveKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    views: list, loading: views.isLoading, active, dirty, canEdit, autosave, myDefaultId,
    select, save, saveAs, revert, rename, remove, setShared, setProtected, setTeamDefault, setMyDefault, setAutosave,
    saving: mut.update.isPending || mut.create.isPending,
  }
}
