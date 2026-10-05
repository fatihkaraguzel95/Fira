import { openTicket, go } from '../../lib/nav'
import { Icon } from '../ui/Icon'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { noteRecent } from '../../lib/favorites'
import { useLocation, useNavigate } from 'react-router-dom'
import { isCanvasKind, type CanvasKind, type Page, type PageKind, type PageParent, type Project } from '../../types'
import { useQueryClient } from '@tanstack/react-query'
import { usePage, useTeamPages, useUpdatePage, useDeletePage, useTrashPage, useRestorePage, usePageVersions, childrenOf, descendantCount, PageConflictError, savePageDraftVersion, lastWriterIsMe } from '../../hooks/usePages'
import { useAuth } from '../../hooks/useAuth'
import { emitError } from '../../lib/errorToast'
import { VersionHistory } from './VersionHistory'
import { useTeamRole, useMyTeams } from '../../hooks/useTeams'
import { useFolders } from '../../hooks/useFolders'
import { folderChain } from '../../lib/folders'
import { useProjects } from '../../hooks/useProjects'
import { useTicket } from '../../hooks/useTickets'
import { DescriptionEditor } from '../ticket/DescriptionEditor'
import { findBlock, revealBlock } from '../../lib/blockAnchor'
import { revealInTree, type RevealRequest } from '../../lib/revealTree'
import { CrumbMenu, type CrumbNode } from '../layout/treeMenus'
import { ConfirmDeleteModal } from '../layout/Sidebar'
import { PageIcon, AddPageIcon, KindIcon, DrawingIcon, WhiteboardIcon } from './PageTree'
import { useBeta } from '../../hooks/useBeta'
import { useHiddenPageKind } from '../../hooks/useCanvas'
import { displayTime, exactTime, useDateFormat } from '../../lib/time'
import { useT } from '../../i18n'
import { copyLink, pageUrl } from '../../lib/shareLink'
import { FavoriteStar } from '../ui/FavoriteStar'
import { useImportLock } from '../../lib/importJob'
import { setUnsaved } from '../../lib/unsaved'

/** How long typing has to pause before the page saves itself. */
const AUTOSAVE_MS = 1500

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface Props {
  pageId: string
  /** Opens a list on the board (the breadcrumb's list crumb). */
  onOpenList: (list: Project) => void
  /** `kind` absent = a page; a canvas kind only when its beta is on (096). */
  onCreatePage: (teamId: string, parent: PageParent, kind?: PageKind) => void
}

/**
 * A page (064): title, markdown body and its subpages. It saves itself —
 * a pause in typing, leaving a field, or leaving the page all write what
 * changed. A change someone else makes is taken over only while this
 * user has nothing unsaved, so a remote edit never eats local typing.
 */
export function PageView({ pageId, onOpenList, onCreatePage }: Props) {
  const t = useT()
  useDateFormat()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: page, isLoading } = usePage(pageId)
  useEffect(() => { noteRecent('page', pageId) }, [pageId])
  // Bir çizim/whiteboard bağlantısı, betası kapalı birine "bulunamadı" demesin (096).
  const { data: hiddenKind } = useHiddenPageKind(pageId, !isLoading && !page)
  const beta = useBeta()

  // Blok bağlantısıyla gelindiyse (#d46f6d70) içerik çizildikten sonra o bloğa
  // kaydırılır. Çapa metinden türediği için hem okuma görünümünde hem editörde
  // çalışır; blok bulunamazsa sayfa başında kalınır, adres yine de açılır.
  const jumped = useRef<string | null>(null)
  useEffect(() => {
    const anchor = decodeURIComponent(location.hash.replace(/^#/, ''))
    const key = `${pageId}#${anchor}`
    if (!anchor || jumped.current === key || isLoading) return
    // Uzun bir sayfa (yüz binlerce karakter) editörde birkaç saniyede çiziliyor;
    // blok belirene kadar 15 saniye boyunca aranır, bulununca durulur.
    let tries = 0
    const root = () => document.querySelector('.md-view[data-anchors]') ?? document.querySelector('article .ProseMirror')
    const tick = window.setInterval(() => {
      // Önce metne göre: belge çizilirken sıraya düşmek başka bir bloğa atlatıyor.
      const el = findBlock(root(), anchor, false)
      if (el) { jumped.current = key; revealBlock(el); window.clearInterval(tick); return }
      if (++tries > 60) {
        window.clearInterval(tick)
        const fallback = findBlock(root(), anchor)   // son çare: sıraya göre
        if (fallback) { jumped.current = key; revealBlock(fallback) }
      }
    }, 250)
    return () => window.clearInterval(tick)
  }, [pageId, isLoading, location.hash])
  const { data: teamPages = [] } = useTeamPages(page?.team_id)
  const { perms, data: role } = useTeamRole(page?.team_id)
  const update = useUpdatePage()
  const del = useDeletePage()
  const trash = useTrashPage()
  const restoreFromTrash = useRestorePage()
  const qc = useQueryClient()
  const { user } = useAuth()
  const me = user?.id ?? null
  const { data: versions = [] } = usePageVersions(page?.id)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [editorKey, setEditorKey] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  /** Someone else saved after we loaded (067): autosave stops until the user picks a side. */
  const [conflict, setConflict] = useState(false)
  const conflictRef = useRef(false); conflictRef.current = conflict
  /** The server stamp our edits build on — writes only land if it is still current. */
  const base = useRef<string | null>(null)
  const saved = useRef({ title: '', content: '' })
  const loadedFor = useRef<string | null>(null)
  const titleFocused = useRef(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const live = useRef({ id: pageId, title, content })
  live.current = { id: pageId, title, content }
  const draft = useRef(false)
  const meRef = useRef(me); meRef.current = me

  // Take the server copy: first load, and later whenever nothing is pending here.
  useEffect(() => {
    if (!page) return
    const serverContent = page.content ?? ''
    if (loadedFor.current !== page.id) {
      loadedFor.current = page.id
      draft.current = !!(location.state as { draft?: boolean } | null)?.draft
      saved.current = { title: page.title, content: serverContent }
      base.current = page.updated_at
      setTitle(page.title); setContent(serverContent); setEditorKey((k) => k + 1); setSaveState('idle')
      return
    }
    const clean = live.current.content === saved.current.content
    const dirty = !clean || live.current.title !== saved.current.title
    // Someone else saved while there is unsaved text here: ask, do not overwrite either side.
    if (dirty && page.updated_at !== base.current && page.updated_by !== me) { setConflict(true); return }
    if (!dirty) base.current = page.updated_at
    if (clean && serverContent !== saved.current.content) {
      saved.current.content = serverContent
      setContent(serverContent); setEditorKey((k) => k + 1)
    }
    if (!titleFocused.current && live.current.title === saved.current.title && page.title !== saved.current.title) {
      saved.current.title = page.title
      setTitle(page.title)
    }
  }, [page?.id, page?.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps

  // Writes run one after another (#9E366E76): while typing fast the autosave
  // fires again before the previous write has answered, and that second write
  // would still carry the old stamp — a "conflict" with ourselves.
  const chain = useRef<Promise<void>>(Promise.resolve())
  const doSave = useCallback(async () => {
    const { id, title: tl, content: ct } = live.current
    if (loadedFor.current !== id || conflictRef.current) return
    const input: { title?: string; content?: string } = {}
    if (tl !== saved.current.title) input.title = tl
    if (ct !== saved.current.content) input.content = ct
    if (!Object.keys(input).length) return
    setSaveState('saving')
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const stamp = await update.mutateAsync({ id, input, expectedUpdatedAt: base.current ?? undefined })
        if (stamp) base.current = stamp
        if (input.title !== undefined) saved.current.title = input.title
        if (input.content !== undefined) saved.current.content = input.content
        if (live.current.id === id) setSaveState('saved')
        return
      } catch (e) {
        if (e instanceof PageConflictError) {
          // My own write from elsewhere (another tab, a save that raced ahead):
          // nobody else's text is at stake. Keep that copy in the history and
          // write on top of it — only a real other person gets the choice.
          const theirs = attempt === 0 ? await lastWriterIsMe(id) : null
          if (theirs) {
            if (theirs.title !== saved.current.title || (theirs.content ?? '') !== saved.current.content) {
              await savePageDraftVersion(id, theirs.title, theirs.content ?? '', meRef.current).catch(() => {})
            }
            base.current = theirs.updated_at
            continue
          }
          setConflict(true)
          setSaveState('idle')
          void qc.invalidateQueries({ queryKey: ['pages', 'one', id] })
          return
        }
        if (live.current.id === id) setSaveState('error')
        emitError(e)
        return
      }
    }
  }, [update, qc])
  const save = useCallback(() => {
    const p = chain.current.then(doSave, doSave)
    chain.current = p.catch(() => {})
    return p
  }, [doSave])
  const saveRef = useRef(save); saveRef.current = save

  // Autosave after a pause in typing.
  useEffect(() => {
    if (loadedFor.current !== pageId) return
    if (title === saved.current.title && content === saved.current.content) return
    const h = window.setTimeout(() => void saveRef.current(), AUTOSAVE_MS)
    return () => window.clearTimeout(h)
  }, [title, content, pageId])

  // Leaving the page (another page, the board, closing the tab): write what is
  // pending — or, for a page created a moment ago and left blank, remove it so
  // a mis-click leaves nothing behind.
  // The view is keyed by page id, so this runs once per page. The cleanup
  // defers a tick: StrictMode re-runs effects right away in development, and a
  // blank draft must not be deleted by that rehearsal.
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    const flush = () => {
      const { id, title: tl, content: ct } = live.current
      if (loadedFor.current !== id) return
      if (draft.current && !tl.trim() && !ct.trim()) { del.mutate({ id }); return }
      if (conflictRef.current) { void savePageDraftVersion(id, tl, ct, meRef.current).catch(() => {}); return }
      void saveRef.current()
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      alive.current = false
      window.removeEventListener('beforeunload', flush)
      window.setTimeout(() => { if (!alive.current) flush() }, 0)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Unsaved text holds back automatic app updates (#5A06299B).
  useEffect(() => {
    setUnsaved(`page:${pageId}`, title !== saved.current.title || content !== saved.current.content)
    return () => setUnsaved(`page:${pageId}`, false)
  }, [title, content, pageId, saveState])

  // Once it has content the page is no longer a throwaway draft.
  useEffect(() => { if (title.trim() || content.trim()) draft.current = false }, [title, content])

  const trashed = !!page?.archived_at
  // A OneNote import is writing into this team (#684A9085): read-only until it ends.
  const importing = useImportLock(page?.team_id)
  const canWrite = perms.canWrite && !trashed && !importing
  // The title field takes the height of its text (one line, or more for a long title).
  useLayoutEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [title, canWrite])
  const canDelete = !!page && perms.canDelete(page.created_by) && !importing
  // The lock can start while someone is typing: keep what they wrote. Only when
  // they did type here — on load the editor state can still be empty, and saving
  // that would blank the page (caught in QA).
  const typed = useRef(false)
  useEffect(() => { typed.current = false }, [pageId])
  const wasImporting = useRef(importing)
  useEffect(() => {
    if (importing && !wasImporting.current && typed.current && loadedFor.current === pageId) void save()
    wasImporting.current = importing
  }, [importing]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Conflict: keep what I typed; the other version stays in the history. */
  const keepMine = async () => {
    if (!page) return
    try {
      // Their save is kept by the version trigger when it was someone else; when it
      // was me in another tab the trigger merges it away, so keep it explicitly.
      if (page.updated_by === me) await savePageDraftVersion(page.id, page.title, page.content ?? '', me)
      const stamp = await update.mutateAsync({ id: page.id, input: { title: live.current.title, content: live.current.content } })
      base.current = stamp ?? base.current
      saved.current = { title: live.current.title, content: live.current.content }
      setConflict(false); setSaveState('saved')
    } catch (e) { emitError(e) }
  }
  /** Conflict: take theirs; what I typed goes to the history as an unsaved draft. */
  const takeTheirs = async () => {
    if (!page) return
    try {
      await savePageDraftVersion(page.id, live.current.title, live.current.content, me)
      saved.current = { title: page.title, content: page.content ?? '' }
      base.current = page.updated_at
      setTitle(page.title); setContent(page.content ?? ''); setEditorKey((k) => k + 1)
      setConflict(false); setSaveState('idle')
      void qc.invalidateQueries({ queryKey: ['pages', 'versions', page.id] })
    } catch (e) { emitError(e) }
  }
  const moveToTrash = async () => {
    if (!page) return
    const parentPage = page.parent_page_id
    const ticket = page.ticket_id
    draft.current = false
    saved.current = { title: live.current.title, content: live.current.content } // nothing left to flush
    try {
      await trash.mutateAsync({ id: page.id })
      go(navigate, parentPage ? `/page/${parentPage}` : ticket ? `/ticket/${ticket}` : '/', { up: true })
    } catch (e) { emitError(e) }
  }
  const kids = useMemo(() => (page ? childrenOf(teamPages, page.id) : []), [teamPages, page])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary-600 border-t-transparent" />
      </div>
    )
  }
  if (!page && hiddenKind) return <BetaHidden kind={hiddenKind} onEnable={() => beta.set(hiddenKind, true)} />
  if (!page) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center px-6">
          <div className="w-14 h-14 rounded-xl bg-raised flex items-center justify-center mx-auto mb-4 text-fg-faint"><PageIcon size={28} /></div>
          <p className="text-fg-2 text-sm font-medium mb-1">{t('page.notFound.title')}</p>
          <p className="text-fg-faint text-xs mb-5">{t('page.notFound.body')}</p>
          <button onClick={() => go(navigate, '/', { up: true })} className="px-4 py-2 rounded-xl text-sm font-medium border border-line text-fg-2 hover:bg-raised transition-colors">{t('page.backToBoard')}</button>
        </div>
      </div>
    )
  }

  const removePage = async () => {  // permanent: only from the trash
    const parentPage = page.parent_page_id
    const ticket = page.ticket_id
    draft.current = false
    saved.current = { title: live.current.title, content: live.current.content } // nothing left to flush
    await del.mutateAsync({ id: page.id })
    setConfirmDelete(false)
    go(navigate, parentPage ? `/page/${parentPage}` : ticket ? `/ticket/${ticket}` : '/', { up: true })
  }
  const below = descendantCount(teamPages, page.id)

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <article className="mx-auto w-full max-w-[52rem] px-4 md:px-8 py-5 md:py-8">
        <div className="flex items-center gap-3 mb-5 min-h-[1.75rem]">
          <Breadcrumb page={page} teamPages={teamPages} onOpenList={onOpenList} />
          <span className="flex-1" />
          <SaveIndicator state={saveState} />
          {/* Görev penceresindeki gibi: favori ve bağlantı başlıkta da (#990dfec5); yalnız
              kenar çubuğu menüsünde olmaları keşfedilebilirlik ilkesine aykırıydı. */}
          <FavoriteStar kind="page" id={page.id} shortcut="favorite" />
          <button type="button" data-shortcut="copy-link" onClick={() => void copyLink(pageUrl(page.id), page.title.trim() || t('page.untitled'))} title={t('common.copyLink')} aria-label={t('common.copyLink')}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg hover:bg-raised transition-colors flex-shrink-0">
            <Icon name="link" />
          </button>
          <button onClick={() => setHistoryOpen(true)} title={t('page.versions.button')}
            className="flex items-center gap-1.5 h-7 px-2 rounded-lg text-xs text-fg-muted hover:text-fg hover:bg-raised transition-colors flex-shrink-0">
            <Icon name="history" />
            <span className="hidden sm:inline">{t('page.versions.button')}</span>
            {versions.length > 0 && <span className="text-fg-faint tabular-nums">{versions.length}</span>}
          </button>
          {canDelete && !trashed && (
            <button onClick={() => void moveToTrash()} title={t('page.trash.move')} aria-label={t('page.trash.move')}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-fg-faint hover:text-danger hover:bg-danger/10 transition-colors flex-shrink-0">
              <Icon name="trash" />
            </button>
          )}
        </div>

        {canWrite ? (
          // A textarea, not an input (#4506A321): a long title wraps onto more lines
          // like the read-only heading does, instead of being cut off at the edge.
          // It grows with its content; Enter still leaves the field (no newlines).
          <textarea
            ref={titleRef}
            value={title}
            rows={1}
            spellCheck={false}
            onChange={(e) => { typed.current = true; setTitle(e.target.value.replace(/[\r\n]+/g, ' ')) }}
            onFocus={() => { titleFocused.current = true }}
            onBlur={() => { titleFocused.current = false; void save() }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } }}
            autoFocus={!!(location.state as { draft?: boolean } | null)?.draft}
            placeholder={t('page.titlePlaceholder')}
            aria-label={t('page.titlePlaceholder')}
            className="block w-full bg-transparent text-2xl md:text-3xl font-bold text-fg placeholder-fg-faint focus:outline-none leading-tight resize-none overflow-hidden"
          />
        ) : (
          <h1 className="text-2xl md:text-3xl font-bold text-fg leading-tight">{page.title.trim() || t('page.untitled')}</h1>
        )}

        {/* mb-10: the editor's toolbar rises above the editor while typing; this
            much room lets it cover the meta line rather than the title. */}
        <p className="mt-2 mb-10 min-h-[1rem] text-xs text-fg-faint">
          {page.creator && (
            <>
              <span className="text-fg-muted">{t('ticket.createdBy', { name: page.creator.full_name || page.creator.email || '' })}</span>
              {' · '}<span title={exactTime(page.created_at)}>{displayTime(page.created_at)}</span>
            </>
          )}
          {page.updater && page.updated_at !== page.created_at && (
            <>
              <span className="mx-1.5">·</span>
              <span className="text-fg-muted">{t('ticket.updatedBy', { name: page.updater.full_name || page.updater.email || '' })}</span>
              {' · '}<span title={exactTime(page.updated_at)}>{displayTime(page.updated_at)}</span>
            </>
          )}
        </p>

        {trashed && (
          <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5 text-xs">
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
          <p className="mb-4 text-xs text-fg-muted bg-raised rounded-lg px-3 py-2">{t('page.readOnly')}</p>
        )}
        {importing && perms.canWrite && (
          <p role="status" className="mb-4 text-xs text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">{t('onenote.locked')}</p>
        )}

        {/* Sticky: on a long page the writer is usually far below the top, and
            autosave has stopped — the choice must stay in view while scrolling. */}
        {conflict && (
          <div role="alert" className="sticky top-2 z-30 mb-3 rounded-lg border border-warning/40 bg-surface shadow-lg">
          <div className="rounded-lg bg-warning/5 px-3 py-2.5 text-xs space-y-2">
            <p className="text-fg-2">
              <span className="font-semibold text-warning">{t('page.conflict.title', { name: page.updater?.full_name || page.updater?.email || t('page.conflict.someone') })}</span>{' '}
              {t('page.conflict.body')}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => void keepMine()} className="px-2.5 py-1.5 rounded-md bg-warning/90 text-white font-semibold hover:bg-warning">{t('page.conflict.keepMine')}</button>
              <button onClick={() => void takeTheirs()} className="px-2.5 py-1.5 rounded-md text-fg-2 hover:bg-raised">{t('page.conflict.takeTheirs')}</button>
            </div>
          </div>
          </div>
        )}

        {canWrite ? (
          <DescriptionEditor key={`${page.id}-${editorKey}`} teamId={page.team_id} value={content} onChange={(v) => { typed.current = true; setContent(v) }} onBlur={() => void save()}
            ticketId={page.id} minHeight="320px" placeholder={t('page.contentPlaceholder')} bare anchorsFor={page.id} />
        ) : (
          <DescriptionEditor key={`ro-${page.id}-${editorKey}`} value={page.content ?? ''} onChange={() => {}} ticketId={page.id} readOnly minHeight="120px" placeholder={t('page.emptyContent')} bare anchorsFor={page.id} />
        )}

        {(kids.length > 0 || canWrite) && (
          <section className="mt-10 pt-6 border-t border-line-soft">
            <p className="text-xs font-semibold text-fg-faint uppercase tracking-wider mb-2">{t('page.subpages')}</p>
            <PageLinks pages={kids} />
            {canWrite && (
              <div className="mt-1 flex flex-wrap items-center gap-x-1">
                <button onClick={() => onCreatePage(page.team_id, { kind: 'page', id: page.id })}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-fg-faint hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950/20 transition-colors">
                  <AddPageIcon /> {t('page.addSubpage')}
                </button>
                {beta.kinds.map((k) => (
                  <button key={k} onClick={() => onCreatePage(page.team_id, { kind: 'page', id: page.id }, k)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-fg-faint hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950/20 transition-colors">
                    {k === 'drawing' ? <DrawingIcon /> : <WhiteboardIcon />} {t(`canvas.add.${k}`)}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </article>

      {historyOpen && (
        <VersionHistory page={page} canWrite={canWrite} onClose={() => setHistoryOpen(false)}
          onRestored={() => { void qc.invalidateQueries({ queryKey: ['pages'] }) }} />
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          title={t('page.delete')}
          name={page.title.trim() || t('page.untitled')}
          warning={below > 0 ? t('page.deleteWarningChildren', { name: page.title.trim() || t('page.untitled'), n: below }) : t('page.deleteWarning', { name: page.title.trim() || t('page.untitled') })}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void removePage()}
        />
      )}
    </div>
  )
}

/** Rows that open a page — used for subpages here and for a task's pages. */
export function PageLinks({ pages }: { pages: Page[] }) {
  const t = useT()
  const navigate = useNavigate()
  if (!pages.length) return null
  return (
    <ul className="space-y-0.5">
      {pages.map((p) => (
        <li key={p.id}>
          <button onClick={() => go(navigate, `/page/${p.id}`)}
            className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm text-left text-fg-2 hover:bg-raised hover:text-fg transition-colors">
            <KindIcon kind={p.kind} className="text-fg-faint" />
            <span className={`truncate ${p.title.trim() ? '' : 'italic text-fg-faint'}`}>{p.title.trim() || (isCanvasKind(p.kind) ? t(`canvas.untitled.${p.kind}`) : t('page.untitled'))}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  const t = useT()
  if (state === 'idle') return null
  const text = state === 'saving' ? t('page.saving') : state === 'saved' ? t('page.saved') : t('page.saveFailed')
  return <span role="status" className={`text-xs flex-shrink-0 ${state === 'error' ? 'text-danger' : 'text-fg-faint'}`}>{text}</span>
}

/**
 * Team › folder › list › task › page › … — her adım tıklanabilir.
 *
 * Tıklamak **soldaki ağaçta gösterir** (#58fab188): aramayla bulunup açılan bir
 * sayfanın nerede durduğunu görmenin yolu buydu. Karşılığında bir şey açabilen
 * adımlar (liste, üst sayfa) eski davranışlarını çift tıkta korur — ikisi de
 * ipucunda yazıyor. Görevin altındaki sayfalar ağaçta görünmediği için o
 * zincirde yalnız açma kalır.
 */
export function Breadcrumb({ page, teamPages, onOpenList }: { page: Page; teamPages: Page[]; onOpenList: (list: Project) => void }) {
  const t = useT()
  const navigate = useNavigate()
  const { data: teams = [] } = useMyTeams()
  const { data: folders = [] } = useFolders(page.team_id)
  const { data: lists = [] } = useProjects(page.team_id)

  // Walk up through parent pages; the top one says where the chain is anchored.
  const chain: Page[] = []
  let cur: Page | undefined = page
  for (let hops = 0; cur && hops < 60; hops++) {
    chain.unshift(cur)
    const parentId: string | null = cur.parent_page_id
    cur = parentId ? teamPages.find((p) => p.id === parentId) : undefined
  }
  const top = chain[0]
  const { data: ticket } = useTicket(top.ticket_id ?? '')
  const list = lists.find((l) => l.id === (top.project_id ?? ticket?.project_id))
  const folderId = top.folder_id ?? list?.folder_id ?? null
  const folderPath = folderChain(folders, folderId)
  const team = teams.find((x) => x.id === page.team_id)

  // Görevin altındaki sayfalar ağaçta yer almaz; o zincirde sayfa adımları
  // yalnız açılır (TeamTree sayfaları takım/klasör/liste altında çizer).
  const inTree = !top.ticket_id
  const teamId = page.team_id
  const folderIds = folderPath.map((f) => f.id)
  const listId = list?.id ?? null

  type Crumb = { key: string; label: string; icon?: boolean; kind?: PageKind; current?: boolean; reveal?: RevealRequest; open?: () => void; /** Tek tıkta hem göster hem aç (liste adımı). */ openOnClick?: boolean; /** Sağ tıkta soldaki ağaçtaki satırın menüsü (#c675e160). */ menu?: CrumbNode }
  const crumbs: Crumb[] = []
  if (team) crumbs.push({ key: 'team', label: team.name, reveal: { teamId, node: { kind: 'team', id: teamId } }, menu: { kind: 'team', teamId } })
  folderPath.forEach((f, i) =>
    crumbs.push({ key: `folder-${f.id}`, label: f.name, reveal: { teamId, folderIds: folderIds.slice(0, i), node: { kind: 'folder', id: f.id } }, menu: { kind: 'folder', teamId, id: f.id } }),
  )
  // Liste adımında tek tık hem ağaçta gösterir hem listeyi açar (kullanıcı, 28 Eyl).
  if (list) crumbs.push({ key: 'list', label: list.name, reveal: { teamId, folderIds, node: { kind: 'list', id: list.id } }, open: () => onOpenList(list), openOnClick: true, menu: { kind: 'list', teamId, id: list.id } })
  if (top.ticket_id && ticket) crumbs.push({ key: 'ticket', label: ticket.title || '…', open: () => openTicket(navigate, ticket.id) })
  // Açık sayfanın kendisi de bir adım: "nerede duruyor" sorusunun en kısa cevabı o.
  chain.forEach((p, i) => {
    const last = i === chain.length - 1
    crumbs.push({
      key: p.id,
      label: p.title.trim() || (isCanvasKind(p.kind) ? t(`canvas.untitled.${p.kind}`) : t('page.untitled')),
      icon: true,
      kind: p.kind,
      current: last,
      reveal: inTree ? { teamId, folderIds, listId, pageIds: chain.slice(0, i).map((x) => x.id), node: { kind: 'page', id: p.id } } : undefined,
      open: last ? undefined : () => go(navigate, `/page/${p.id}`, { up: true }),
      menu: { kind: 'page', teamId, id: p.id },
    })
  })

  const hint = (c: Crumb) => (c.reveal ? (c.openOnClick ? t('page.crumb.openReveal') : c.open ? t('page.crumb.revealOpen') : t('page.crumb.reveal')) : c.label)

  return (
    <nav aria-label={t('page.breadcrumb')} className="min-w-0 flex items-center gap-1 text-xs text-fg-faint overflow-hidden">
      {crumbs.map((c, i) => (
        <span key={c.key} className="flex items-center gap-1 min-w-0">
          {i > 0 && <span aria-hidden className="text-fg-faint/60">›</span>}
          <CrumbMenu node={c.menu}>
          {c.reveal || c.open ? (
            <button
              type="button"
              title={hint(c)}
              aria-current={c.current ? 'page' : undefined}
              onClick={() => { if (c.reveal) revealInTree(c.reveal); if (c.openOnClick || !c.reveal) c.open?.() }}
              onDoubleClick={() => c.open?.()}
              className={`flex items-center gap-1 truncate max-w-[12rem] hover:text-fg-2 hover:underline ${c.current ? 'text-fg-muted' : ''}`}
            >
              {c.icon && <KindIcon kind={c.kind} />}<span className="truncate">{c.label}</span>
            </button>
          ) : (
            <span className="truncate max-w-[12rem]">{c.label}</span>
          )}
          </CrumbMenu>
        </span>
      ))}
    </nav>
  )
}

/**
 * A link to a drawing / whiteboard for someone whose beta is off (096): say
 * what it is and offer the switch, instead of "not found". Shown only to a
 * member of the team (the RPC tells nobody else that the row exists).
 */
export function BetaHidden({ kind, onEnable }: { kind: CanvasKind; onEnable: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const name = t(`canvas.kind.${kind}`)
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center px-6 max-w-md">
        <div className="w-14 h-14 rounded-xl bg-raised flex items-center justify-center mx-auto mb-4 text-fg-faint"><KindIcon kind={kind} size={28} /></div>
        <p className="text-fg text-sm font-semibold mb-1">{t('canvas.hidden.title', { kind: t(`canvas.kindLower.${kind}`) })}</p>
        <p className="text-fg-muted text-xs mb-5">{t('canvas.hidden.body', { kind: t(`canvas.kindLower.${kind}`) })}</p>
        <div className="flex items-center justify-center gap-2">
          <button onClick={onEnable} className="px-4 py-2 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors">{t('canvas.hidden.enable', { kind: name })}</button>
          <button onClick={() => go(navigate, '/', { up: true })} className="px-4 py-2 rounded-xl text-sm font-medium border border-line text-fg-2 hover:bg-raised transition-colors">{t('page.backToBoard')}</button>
        </div>
      </div>
    </div>
  )
}
