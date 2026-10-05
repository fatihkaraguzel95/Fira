// Excalidraw reads its font path when its chunk runs; the chunk's static imports run
// before the drawing's own code, so the path has to be set here, one chunk earlier.
import './drawing/excalidrawAssets'
import { Icon } from '../ui/Icon'
import { go } from '../../lib/nav'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { CanvasKind, Page, Project } from '../../types'
import { useTeamPages, useUpdatePage, useTrashPage, useRestorePage, useDeletePage } from '../../hooks/usePages'
import { useTeamRole } from '../../hooks/useTeams'
import { useAuth } from '../../hooks/useAuth'
import { useUsers } from '../../hooks/useUsers'
import { useImportLock } from '../../lib/importJob'
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from '../../lib/supabase'
import { emitError, emitToast } from '../../lib/errorToast'
import { copyLink, pageUrl } from '../../lib/shareLink'
import { displayTime, useDateFormat } from '../../lib/time'
import { setUnsaved } from '../../lib/unsaved'
import { peerColor, type Peer, type SaveState } from '../../lib/canvas/session'
import { useT } from '../../i18n'
import { Breadcrumb } from '../page/PageView'
import { KindIcon } from '../page/PageTree'
import { FavoriteStar } from '../ui/FavoriteStar'
import { ConfirmDeleteModal } from '../layout/Sidebar'
import { SceneVersions } from './SceneVersions'
import type { CanvasProps } from './types'

// The editors are big (Excalidraw alone is ~2 MB); only someone who opens a
// canvas downloads them, and the PWA does not precache them (vite.config).
const DrawingCanvas = lazy(() => import('./drawing/DrawingCanvas'))
const WhiteboardCanvas = lazy(() => import('./whiteboard/WhiteboardCanvas'))

/** How long the title has to rest before it is saved. */
const TITLE_SAVE_MS = 1200

/**
 * A drawing or a whiteboard (096, beta): the page frame — where it sits, its
 * title, who is here, whether it is saved — around the editor, which fills the
 * rest of the screen. The editor saves itself (lib/canvas/session); the frame
 * saves only the title, which lives on the `pages` row like a page's.
 */
export function CanvasView({ page, onOpenList }: { page: Page; onOpenList: (list: Project) => void }) {
  const t = useT()
  useDateFormat()
  const kind = page.kind as CanvasKind
  const navigate = useNavigate()
  const location = useLocation()
  const { data: teamPages = [] } = useTeamPages(page.team_id)
  const { perms, data: role } = useTeamRole(page.team_id)
  const importing = useImportLock(page.team_id)
  const trashed = !!page.archived_at
  const canWrite = perms.canWrite && !trashed && !importing
  const canDelete = perms.canDelete(page.created_by) && !importing
  const update = useUpdatePage()
  const trash = useTrashPage()
  const restoreFromTrash = useRestorePage()
  const del = useDeletePage()
  const { user } = useAuth()
  const { data: profiles = [] } = useUsers()
  const myProfile = profiles.find((p) => p.id === user?.id)

  const me = useMemo(() => ({
    uid: user?.id ?? 'anon',
    name: myProfile?.full_name || myProfile?.email || user?.email || '?',
    color: peerColor(user?.id ?? 'anon'),
    avatar: myProfile?.avatar_url ?? null,
    canWrite,
  }), [user?.id, user?.email, myProfile?.full_name, myProfile?.email, myProfile?.avatar_url, canWrite])

  // ── Title ────────────────────────────────────────────────────────────────
  const [title, setTitle] = useState(page.title)
  const savedTitle = useRef(page.title)
  const titleFocused = useRef(false)
  useEffect(() => {
    // Someone else renamed it: take it unless this user is typing a name.
    if (!titleFocused.current && page.title !== savedTitle.current) { savedTitle.current = page.title; setTitle(page.title) }
  }, [page.title])
  const saveTitle = async (value: string) => {
    if (value === savedTitle.current) return
    try {
      await update.mutateAsync({ id: page.id, input: { title: value } })
      savedTitle.current = value
    } catch (e) { emitError(e) }
  }
  useEffect(() => {
    if (title === savedTitle.current) return
    const h = window.setTimeout(() => void saveTitle(title), TITLE_SAVE_MS)
    return () => window.clearTimeout(h)
  }, [title]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Status from the editor ───────────────────────────────────────────────
  const [peers, setPeers] = useState<Peer[]>([])
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [live, setLive] = useState(true)
  const [empty, setEmpty] = useState<boolean | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Unsaved strokes hold back automatic app updates (#5A06299B), as a page's text does.
  useEffect(() => {
    setUnsaved(`canvas:${page.id}`, saveState === 'saving' || saveState === 'error' || saveState === 'offline')
    return () => setUnsaved(`canvas:${page.id}`, false)
  }, [saveState, page.id])

  // A canvas created a moment ago and left blank goes again (like a blank page):
  // a mis-click in the add menu leaves nothing behind.
  const draft = useRef(!!(location.state as { draft?: boolean } | null)?.draft)
  const live$ = useRef({ title, empty }); live$.current = { title, empty }
  useEffect(() => { if (title.trim() || empty === false) draft.current = false }, [title, empty])
  useEffect(() => {
    let alive = true
    return () => {
      alive = false
      const id = page.id
      window.setTimeout(() => {
        if (alive) return
        const { title: tl, empty: em } = live$.current
        if (draft.current && !tl.trim() && em !== false) del.mutate({ id })
        else if (tl !== savedTitle.current) void update.mutateAsync({ id, input: { title: tl } }).catch(() => {})
      }, 0)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Closing the tab (or a full reload) unmounts nothing: the blank draft goes with a
  // request that survives the page (keepalive), like the unsaved strokes do.
  const token = useRef<string | null>(null)
  useEffect(() => { void supabase.auth.getSession().then(({ data }) => { token.current = data.session?.access_token ?? null }) }, [])
  useEffect(() => {
    const onHide = () => {
      const { title: tl, empty: em } = live$.current
      if (!draft.current || tl.trim() || em === false || !token.current) return
      void fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${page.id}`, { method: 'DELETE', keepalive: true, headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token.current}` } })
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [page.id])

  const moveToTrash = async () => {
    draft.current = false
    try {
      await trash.mutateAsync({ id: page.id })
      go(navigate, page.parent_page_id ? `/page/${page.parent_page_id}` : page.ticket_id ? `/ticket/${page.ticket_id}` : '/', { up: true })
    } catch (e) { emitError(e) }
  }
  const removeForever = async () => {
    draft.current = false
    await del.mutateAsync({ id: page.id })
    setConfirmDelete(false)
    go(navigate, page.parent_page_id ? `/page/${page.parent_page_id}` : page.ticket_id ? `/ticket/${page.ticket_id}` : '/', { up: true })
  }

  const untitled = t(`canvas.untitled.${kind}`)
  const props: CanvasProps = {
    pageId: page.id,
    teamId: page.team_id,
    title: title.trim() || untitled,
    canWrite,
    me,
    reloadToken,
    onPeers: setPeers,
    onSaveState: setSaveState,
    onLive: setLive,
    onEmptyChange: setEmpty,
    onRemoteRestore: (name) => emitToast(t('canvas.remoteRestore', { name: name || t('canvas.someone') })),
  }

  return (
    <div className="h-full flex flex-col min-h-0" data-canvas-page={kind}>
      <header className="flex-shrink-0 px-3 md:px-5 pt-2.5 pb-2 border-b border-line-soft bg-surface">
        <div className="flex items-center gap-2 min-h-[1.75rem]">
          <Breadcrumb page={{ ...page, title }} teamPages={teamPages} onOpenList={onOpenList} />
          <span className="flex-1" />
          <PresenceStack peers={peers} />
          <SaveLabel state={saveState} live={live} />
          <FavoriteStar kind="page" id={page.id} shortcut="favorite" />
          <button type="button" onClick={() => void copyLink(pageUrl(page.id), title.trim() || untitled)} title={t('common.copyLink')} aria-label={t('common.copyLink')}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg hover:bg-raised transition-colors flex-shrink-0">
            <Icon name="link" />
          </button>
          <button type="button" onClick={() => setVersionsOpen(true)} title={t('canvas.versions.title')}
            className="flex items-center gap-1.5 h-7 px-2 rounded-lg text-xs text-fg-muted hover:text-fg hover:bg-raised transition-colors flex-shrink-0">
            <Icon name="history" />
            <span className="hidden sm:inline">{t('page.versions.button')}</span>
          </button>
          {canDelete && !trashed && (
            <button type="button" onClick={() => void moveToTrash()} title={t('page.trash.move')} aria-label={t('page.trash.move')}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-fg-faint hover:text-danger hover:bg-danger/10 transition-colors flex-shrink-0">
              <Icon name="trash" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 min-w-0">
          <KindIcon kind={kind} size={20} className="text-fg-faint" />
          {canWrite ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={() => { titleFocused.current = true }}
              onBlur={() => { titleFocused.current = false; void saveTitle(title) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
              autoFocus={draft.current}
              placeholder={untitled}
              aria-label={t('canvas.titleLabel')}
              className="flex-1 min-w-0 bg-transparent text-lg md:text-xl font-bold text-fg placeholder-fg-faint focus:outline-none truncate"
            />
          ) : (
            <h1 className="flex-1 min-w-0 truncate text-lg md:text-xl font-bold text-fg">{page.title.trim() || untitled}</h1>
          )}
          <span className="flex-shrink-0 text-2xs font-semibold px-1.5 py-0.5 rounded-md bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300" title={t('settings.beta.title')}>{t('canvas.beta')}</span>
        </div>
      </header>

      {trashed && (
        <div role="status" className="flex-shrink-0 flex flex-wrap items-center gap-3 border-b border-warning/40 bg-warning/5 px-4 py-2 text-xs">
          <span className="flex-1 min-w-[12rem] text-fg-2">
            {t('page.trash.banner', { name: page.archiver?.full_name || page.archiver?.email || t('page.versions.unknownAuthor'), time: displayTime(page.archived_at!) })}
          </span>
          {perms.canWrite && (
            <button onClick={() => void restoreFromTrash.mutateAsync({ id: page.id }).catch(emitError)}
              className="px-3 py-1.5 rounded-md bg-primary-600 text-white font-semibold hover:bg-primary-700">{t('page.trash.restore')}</button>
          )}
          {canDelete && (
            <button onClick={() => setConfirmDelete(true)} className="px-3 py-1.5 rounded-md text-danger hover:bg-danger/10">{t('page.trash.deleteForever')}</button>
          )}
        </div>
      )}
      {!perms.canWrite && role?.role && (
        <p className="flex-shrink-0 border-b border-line-soft bg-raised px-4 py-1.5 text-xs text-fg-muted">{t('canvas.readOnly')}</p>
      )}
      {importing && perms.canWrite && (
        <p role="status" className="flex-shrink-0 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-xs text-warning">{t('onenote.locked')}</p>
      )}

      <div className="relative flex-1 min-h-0">
        <Suspense fallback={<CanvasLoading />}>
          {kind === 'drawing' ? <DrawingCanvas key={page.id} {...props} /> : <WhiteboardCanvas key={page.id} {...props} />}
        </Suspense>
      </div>

      {versionsOpen && (
        <SceneVersions page={page} kind={kind} canWrite={canWrite} onClose={() => setVersionsOpen(false)}
          onRestored={() => { setReloadToken((n) => n + 1); emitToast(t('canvas.versions.restored')) }} />
      )}
      {confirmDelete && (
        <ConfirmDeleteModal
          title={t('page.delete')}
          name={page.title.trim() || untitled}
          warning={t('page.deleteWarning', { name: page.title.trim() || untitled })}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void removeForever()}
        />
      )}
    </div>
  )
}

export function CanvasLoading() {
  const t = useT()
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-fg-faint">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-600 border-t-transparent" />
      <p className="text-xs">{t('canvas.loading')}</p>
    </div>
  )
}

/** Who else has this canvas open: their colour is the colour of their cursor. */
function PresenceStack({ peers }: { peers: Peer[] }) {
  const t = useT()
  // One avatar per person (a person may have it open in two tabs).
  const people = useMemo(() => {
    const byUid = new Map<string, Peer>()
    for (const p of peers) { const cur = byUid.get(p.uid); if (!cur || p.self) byUid.set(p.uid, p) }
    return [...byUid.values()].sort((a, b) => Number(b.self) - Number(a.self))
  }, [peers])
  if (people.length < 2) return null
  const shown = people.slice(0, 5)
  const title = `${t('canvas.liveTitle')}: ${people.map((p) => (p.self ? t('canvas.you') : p.name) + (p.canWrite ? '' : ` (${t('canvas.viewer')})`)).join(', ')}`
  return (
    <div className="flex items-center -space-x-1.5 flex-shrink-0" title={title} aria-label={title} role="img" data-canvas-presence={people.length}>
      {shown.map((p) => (
        <span key={p.uid} className="w-6 h-6 rounded-full ring-2 ring-surface flex items-center justify-center text-2xs font-semibold text-white overflow-hidden" style={{ background: p.color }}>
          {p.avatar ? <img src={p.avatar} alt="" className="w-full h-full object-cover" /> : (p.name.trim()[0] ?? '?').toUpperCase()}
        </span>
      ))}
      {people.length > shown.length && <span className="w-6 h-6 rounded-full ring-2 ring-surface bg-raised text-2xs text-fg-muted flex items-center justify-center">+{people.length - shown.length}</span>}
    </div>
  )
}

function SaveLabel({ state, live }: { state: SaveState; live: boolean }) {
  const t = useT()
  if (state === 'offline' || (!live && state !== 'saving')) {
    return <span role="status" className="text-xs text-warning flex-shrink-0 hidden sm:inline" title={t('canvas.offline')}>{t('canvas.offline').split('—')[0].trim()}</span>
  }
  if (state === 'idle') return null
  const text = state === 'saving' ? t('page.saving') : state === 'saved' ? t('page.saved') : t('page.saveFailed')
  return <span role="status" className={`text-xs flex-shrink-0 ${state === 'error' ? 'text-danger' : 'text-fg-faint'}`}>{text}</span>
}
