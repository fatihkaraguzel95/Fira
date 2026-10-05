import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { droppedFileUrls, fileRefs } from '../../lib/fileRefs'
import { pruneDroppedFiles } from '../../lib/pruneFiles'
import { useTicket, useUpdateTicket, useDeleteTicket, useCopyTicket, useMoveTicket } from '../../hooks/useTickets'
import { MoveToListDialog } from './MoveToListDialog'
import { useRowMenu, MenuIcons } from '../ui/RowMenu'
import { ConflictError } from '../../lib/errorMessage'
import { supabase } from '../../lib/supabase'
import { setUnsaved } from '../../lib/unsaved'
import { useStatuses } from '../../hooks/useStatuses'
import { useAuth } from '../../hooks/useAuth'
import { useProjectRole, useMyTeams } from '../../hooks/useTeams'
import { useProjects } from '../../hooks/useProjects'
import { TeamMark, ListMark } from '../layout/ListCrumb'
import { CrumbMenu } from '../layout/treeMenus'
import { usePrefs, GLOBAL_SCOPE } from '../../hooks/usePrefs'
import { useTray } from '../../hooks/useTray'
import { go, goList, openTicket, closeOverlay, previousPath, subscribeNav, noteParent, ticketPath } from '../../lib/nav'
import { DescriptionEditor } from './DescriptionEditor'
import { Translated } from './Translated'
import { useTicketTranslations } from '../../hooks/useReading'
import { TicketTimeline } from './TicketTimeline'
import { TicketProperties } from './TicketProperties'
import { useTicketActivity, completionEvent } from '../../hooks/useActivity'
import { useSetParent } from '../../hooks/useChildren'
import { CopyId } from '../ui/CopyId'
import { ticketUrl } from '../../lib/shareLink'
import { revealInTree } from '../../lib/revealTree'
import { folderChain } from '../../lib/folders'
import { useFolders } from '../../hooks/useFolders'
import { findBlock, revealBlock } from '../../lib/blockAnchor'
import { ShareLinkButton } from '../ui/ShareLinkButton'
import { FavoriteStar } from '../ui/FavoriteStar'
import { noteRecent } from '../../lib/favorites'
import { LinkTicketPicker } from './LinkTicketPicker'
import { AiHandoffButton } from './AiHandoffButton'
import { TicketSections } from './TicketSections'
import { startTour } from '../../lib/tour'
import { useUpload, useAttachRecord } from '../../hooks/useUpload'
import { wasHandled, isEditableTarget, blurAfterEscape } from '../../lib/keys'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { readPopupKeepOpen, readTicketView } from './ticketView'
import { useT } from '../../i18n'
import { displayTime, exactTime, useDateFormat } from '../../lib/time'

interface Props {
  projectId: string | null
}

/** Remove every markdown image (or link) pointing at `url`, plus the blank line it leaves behind. */
function removeImageFromMarkdown(md: string, url: string): string {
  const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return md
    .replace(new RegExp(`!?\\[[^\\]]*\\]\\(${esc}(?:\\s+"[^"]*")?\\)`, 'g'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs font-semibold text-fg-faint uppercase tracking-wider mb-2">{children}</p>
)

/**
 * The ticket detail. Its content is built once from shared fragments —
 * TicketProperties (the form block), the description editor, subtasks, linked
 * tasks, files and the activity/comments timeline — and then framed either as a
 * full-screen page or a centered popup, per the user's `ticketView` preference.
 * Adding a new field/section means touching a fragment once; both views get it.
 *
 * Scroll position is remembered per ticket so returning from a subtask lands
 * where you were, not at the top.
 */
const scrollMemory = new Map<string, number>()

const clampW = (n: number) => Math.max(300, Math.min(720, n))
const DEFAULT_PANEL_W = 384

export function TicketModal({ projectId }: Props) {
  const t = useT()
  useDateFormat()   // repaint when the chosen date format changes
  const navigate = useNavigate()
  const location = useLocation()
  // A "draft" ticket is one that was created empty by "Yeni Ticket" and opened
  // straight into this detail view (no intermediate form). If it is left without
  // a title or any content, it is discarded on exit so no blank task lingers.
  const isDraft = (location.state as { draft?: boolean } | null)?.draft === true
  const { ticketId } = useParams<{ ticketId: string }>()
  const { user } = useAuth()
  const { data: ticket, isLoading } = useTicket(ticketId ?? '')
  // Recents (#D6B3097E): opening a task is what puts it in the sidebar's "Son açılanlar".
  useEffect(() => { if (ticketId) noteRecent('ticket', ticketId) }, [ticketId])
  // Blok bağlantısıyla gelindiyse (#d46f6d70): açıklamadaki o paragrafa
  // kaydırılır ve kısa süre vurgulanır. Metin sunucudan geldikten sonra
  // çizildiği için blok belirene kadar aranır. Yorumlarda çapa yok (28 Eyl'de
  // geri alındı), eski `#c:<yorum>:<blok>` adresleri görevi açar, kaydırmaz.
  const jumpedTo = useRef<string | null>(null)
  useEffect(() => {
    const raw = decodeURIComponent(location.hash.replace(/^#/, ''))
    const key = `${ticketId}#${raw}`
    if (!raw || !ticketId || jumpedTo.current === key || isLoading) return
    const anchor = raw
    if (!/^b\d+-/.test(anchor)) return
    const rootOf = () => document.querySelector('[data-insert-slot="description"] .md-view') ?? document.querySelector('[data-insert-slot="description"] .ProseMirror')
    let tries = 0
    const tick = window.setInterval(() => {
      const el = findBlock(rootOf(), anchor, false)
      if (el) { jumpedTo.current = key; revealBlock(el); window.clearInterval(tick); return }
      // Son çare sırayla eşleşme: metin değişmişse yakınına götürür.
      if (++tries > 40) { window.clearInterval(tick); const fb = findBlock(rootOf(), anchor); if (fb) { jumpedTo.current = key; revealBlock(fb) } }
    }, 250)
    return () => window.clearInterval(tick)
  }, [ticketId, isLoading, location.hash])
  const { data: activity } = useTicketActivity(ticketId ?? null)
  const completed = completionEvent(activity)
  const ticketProjectId = ticket?.project_id ?? projectId
  const { data: statuses } = useStatuses(ticketProjectId)
  const updateTicket = useUpdateTicket()
  const deleteTicket = useDeleteTicket()
  const copyTicket = useCopyTicket()
  const moveTicket = useMoveTicket()
  const [moveOpen, setMoveOpen] = useState(false)
  const { perms, teamId } = useProjectRole(ticket?.project_id ?? projectId)
  // The description's translation into this reader's language (113), when the reader and the team want one.
  const translations = useTicketTranslations(ticket?.id ?? null, teamId ?? null)

  const { data: parentTicket, isPending: parentPending } = useTicket(ticket?.parent_id ?? '')
  // What is more general than this task (#a7d43aaf): its parent task, or its list. The
  // navigation rule reads this to tell "back" from "forward".
  useEffect(() => {
    if (ticket) noteParent(ticketPath(ticket.id), ticket.parent_id ? ticketPath(ticket.parent_id) : null)
    if (parentTicket) noteParent(ticketPath(parentTicket.id), parentTicket.parent_id ? ticketPath(parentTicket.parent_id) : null)
  }, [ticket?.id, ticket?.parent_id, parentTicket?.id, parentTicket?.parent_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const setParent = useSetParent()

  const [editTitle, setEditTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const [descValue, setDescValue] = useState('')
  // The cursor was put in the description while the original was showing: a translation that arrives later does not replace the editor.
  const [descTouched, setDescTouched] = useState(false)
  const descSaved = useRef('')
  const baselineRef = useRef('')
  const [conflict, setConflict] = useState<{ field: 'description' | 'title'; draft: string } | null>(null)
  const [externalBy, setExternalBy] = useState<string | null>(null)
  const [parentAnchor, setParentAnchor] = useState<HTMLElement | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ticket) {
      setTitleValue(ticket.title)
      setDescValue(ticket.description ?? '')
      descSaved.current = ticket.description ?? ''
      setDescTouched(false)
      baselineRef.current = ticket.updated_at
      setConflict(null)
      setExternalBy(null)
    }
  }, [ticket?.id])

  // Someone else saved this ticket while it is open: rebase our edit fields onto it.
  useEffect(() => {
    if (!ticket || !baselineRef.current) return
    if (ticket.updated_at === baselineRef.current) return
    if (ticket.updated_by === user?.id) { baselineRef.current = ticket.updated_at; return }
    setExternalBy(ticket.updater?.full_name || ticket.updater?.email || t('ticket.anotherUser'))
  }, [ticket?.updated_at])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (editTitle) titleRef.current?.focus() }, [editTitle])
  // An edited description or title holds back automatic app updates (#5A06299B).
  useEffect(() => {
    if (!ticket) return
    setUnsaved(`ticket:${ticket.id}`, editTitle || descValue !== descSaved.current)
    return () => setUnsaved(`ticket:${ticket.id}`, false)
  }, [descValue, editTitle, ticket?.id, conflict])  // eslint-disable-line react-hooks/exhaustive-deps

  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollTopRef = useRef(0)
  useLayoutEffect(() => {
    if (!ticket || !ticketId) return
    const save = () => { if (scrollTopRef.current > 0) scrollMemory.set(ticketId, scrollTopRef.current) }
    const saved = scrollMemory.get(ticketId)
    if (saved == null) { scrollTopRef.current = 0; return save }
    scrollMemory.delete(ticketId)
    let frame = 0
    let tries = 0
    const apply = () => {
      const node = scrollRef.current
      if (!node) return
      node.scrollTop = saved
      scrollTopRef.current = node.scrollTop
      if (Math.abs(node.scrollTop - saved) > 2 && tries++ < 40) frame = requestAnimationFrame(apply)
    }
    apply()
    return () => { cancelAnimationFrame(frame); save() }
  }, [ticketId, ticket?.id])

  // Kapatma (✕, Esc, dışarı tıklama) pencereyi tümden kapatır: altındaki ekrana,
  // yani geçmişte görev olmayan en yakın kayda dönülür. Tarayıcının geri tuşu ve
  // geri oku ise adım adım gider: alt görevden üst göreve, oradan panoya (#a7d43aaf).
  const close = () => closeOverlay(navigate)

  // Pencere içi geçiş de `lib/nav` kuralından geçer: daha özele gitmek geçmişe kayıt
  // ekler, daha genele ya da geçmişte olana gitmek geri döner.
  const goTicket = (id: string) => openTicket(navigate, id)
  // Geri oku: geçmişteki bir önceki kayıt da bir görevse görünür.
  const [, setNavTick] = useState(0)
  useEffect(() => subscribeNav(() => setNavTick((n) => n + 1)), [])
  const backId = previousPath()?.match(/^\/ticket\/([0-9a-fA-F-]{36})$/)?.[1] ?? null
  const { data: backTicket } = useTicket(backId ?? '')
  const goBack = () => { if (backId) navigate(-1) }

  // Discard an untouched draft when leaving it — no title, no description and none
  // of the things you can add (assignees, subtasks/links, files). Run on unmount
  // (the detail view unmounts whenever you leave the ticket route: close button,
  // Esc, backdrop, breadcrumb), guarded so it fires at most once.
  const discardedRef = useRef(false)
  const discardRef = useRef<() => void>(() => {})
  discardRef.current = () => {
    if (discardedRef.current || !isDraft || !ticket) return
    const emptyText = !titleValue.trim() && !descValue.trim()
    const emptyRels =
      (ticket.assignees?.length ?? 0) === 0 &&
      (ticket.children?.length ?? 0) === 0 &&
      (ticket.attachments?.length ?? 0) === 0
    if (emptyText && emptyRels) {
      discardedRef.current = true
      deleteTicket.mutate(ticket.id)
    }
  }
  useEffect(() => () => discardRef.current(), [])

  const prefs = usePrefs(GLOBAL_SCOPE)
  const viewMode = readTicketView(prefs.prefs)
  const keepOpenOnOutside = readPopupKeepOpen(prefs.prefs)

  // Breadcrumb team/list click → back to the board, remembering this ticket's list.
  const goToBoard = () => {
    if (ticketProjectId) prefs.patch({ v: 1, lastProjectId: ticketProjectId, lastTeamId: teamId ?? null })
    go(navigate, '/', { up: true })
  }

  // Simge durumuna küçült (#e6b8797c): pencere kapanır, görev sağ alttaki
  // çubukta durur; yarım kalan yorum taslağı sunucuda zaten saklanıyor.
  const tray = useTray()
  const minimize = () => { if (ticketId) tray.add(ticketId); close() }

  const canEdit = !!user && perms.canWrite
  const canDeleteTicket = !!ticket && perms.canDelete(ticket.created_by)

  const handleUpdate = (input: Parameters<typeof updateTicket.mutate>[0]['input']) => {
    if (!ticket) return
    updateTicket.mutate({ id: ticket.id, input })
  }

  const [confirmDelete, setConfirmDelete] = useState(false)
  // ⋯ menüsü: tanıtım turu herkese (#ab88c8f5; açılır pencerede üst çubuk örtünün
  // altında kalıyor, profil menüsüne ulaşılmıyor), silme yetkisi olana.
  const moreMenu = useRowMenu([
    { key: 'tour', label: t('ticket.tourHere'), icon: MenuIcons.help, onSelect: () => startTour('ticket') },
    ...(canDeleteTicket ? [{ key: 'delete', label: t('ticket.deleteMenu'), icon: MenuIcons.trash, danger: true, separated: true, onSelect: () => setConfirmDelete(true) }] : []),
  ], { label: t('ticket.moreActions') })
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  useEffect(() => { setConfirmDelete(false); setConfirmUnlink(false); setEditTitle(false); setParentAnchor(null) }, [ticketId])
  // Fresh draft with no title yet → drop the cursor straight into the title.
  // Placed after the reset above so it wins when both fire on mount.
  useEffect(() => {
    if (isDraft && ticket && !ticket.title.trim()) setEditTitle(true)
  }, [ticket?.id, isDraft])  // eslint-disable-line react-hooks/exhaustive-deps
  const handleDelete = async () => {
    if (!ticket) return
    await deleteTicket.mutateAsync(ticket.id)
    close()
  }

  const shellRef = useRef<HTMLDivElement>(null)
  useDialogFocus(shellRef, true, () => shellRef.current)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || wasHandled(e)) return
      if (isEditableTarget(e.target)) { blurAfterEscape(e, e.target); return }
      if (confirmDelete) { setConfirmDelete(false); return }
      close()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })

  // Guarded writes for the free-text fields (description, title).
  const qc = useQueryClient()
  /** Files put into the description since its last save: taken out again before saving, they leave Files too. */
  const pastedDesc = useRef<string[]>([])
  const dropFromDesc = (before: string, after: string) => {
    const kept = new Set(fileRefs(after).map((r) => r.url))
    const urls = [...droppedFileUrls(before, after), ...pastedDesc.current.filter((u) => !kept.has(u))]
    pastedDesc.current = []
    if (ticket) void pruneDroppedFiles(qc, ticket.id, urls)
  }
  // One guarded write at a time (#9E366E76): a title save fired while the
  // description save is still in flight would carry the old baseline and read
  // as a conflict with ourselves. Each write waits for the previous one and
  // takes the baseline it left behind.
  const saveChain = useRef<Promise<unknown>>(Promise.resolve())
  const saveGuarded = (field: 'description' | 'title', input: Parameters<typeof updateTicket.mutate>[0]['input'], draft: string) => {
    const run = async () => {
      if (!ticket) return
      let expected = baselineRef.current
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const updated = await updateTicket.mutateAsync({ id: ticket.id, input, expectedUpdatedAt: expected })
          baselineRef.current = updated.updated_at
          if (field === 'description') {
            // Files taken out of the text leave Files too (#0E2B2AB8).
            dropFromDesc(descSaved.current, draft)
            descSaved.current = draft
            setUnsaved(`ticket:${ticket.id}`, false)
          }
          setConflict(null); setExternalBy(null)
          return
        } catch (e) {
          if (!(e instanceof ConflictError)) return
          // The row moved — but if the last writer was me (another tab, a save
          // that raced ahead), there is nobody else's text to protect: rebase
          // on the current stamp and write again. Only a real other person
          // gets the "keep mine / take theirs" choice.
          const mine = attempt === 0 ? await lastWriterIsMe(ticket.id) : null
          if (mine) { expected = mine; baselineRef.current = mine; continue }
          setConflict({ field, draft })
          return
        }
      }
    }
    const p = saveChain.current.then(run, run)
    saveChain.current = p.catch(() => {})
    return p
  }
  /** The row's current stamp when its last writer is the signed-in user, else null. */
  const lastWriterIsMe = async (id: string): Promise<string | null> => {
    const { data } = await supabase.from('tickets').select('updated_at, updated_by').eq('id', id).maybeSingle()
    return data && user?.id && data.updated_by === user.id ? (data.updated_at as string) : null
  }
  const handleDescBlur = () => {
    if (descValue !== descSaved.current) saveGuarded('description', { description: descValue || null }, descValue)
    else if (pastedDesc.current.length) dropFromDesc(descSaved.current, descValue)
  }
  const adoptServer = () => {
    if (!ticket) return
    setTitleValue(ticket.title); setDescValue(ticket.description ?? ''); descSaved.current = ticket.description ?? ''
    baselineRef.current = ticket.updated_at; setConflict(null); setExternalBy(null)
  }
  const forceMine = async () => {
    if (!ticket || !conflict) return
    const input = conflict.field === 'description' ? { description: conflict.draft || null } : { title: conflict.draft.trim() }
    const updated = await updateTicket.mutateAsync({ id: ticket.id, input })
    baselineRef.current = updated.updated_at
    if (conflict.field === 'description') {
      dropFromDesc(descSaved.current, conflict.draft)
      descSaved.current = conflict.draft
    }
    setConflict(null); setExternalBy(null)
  }

  // Clipboard files → attachments (images pasted into the editor are handled there).
  const upload = useUpload()
  const attachRecord = useAttachRecord()
  const handlePaste = (e: React.ClipboardEvent) => {
    if (!ticket || !canEdit) return
    const files = Array.from(e.clipboardData?.files ?? [])
    if (files.length === 0) return
    // Pasted into an editor (description, comment): the editor handles it —
    // images/videos in place, other files ask for a link or upload-only.
    if ((e.target as HTMLElement).closest?.('.tiptap-editor')) return
    const toAttach = files
    e.preventDefault()
    toAttach.forEach(file => upload.mutate({ file, ticketId: ticket.id }))
  }
  const handleAttachmentDeleted = (att: { file_url: string }) => {
    const next = removeImageFromMarkdown(descValue, att.file_url)
    if (next !== descValue) {
      setDescValue(next); descSaved.current = next; handleUpdate({ description: next || null })
    }
  }

  // Breadcrumb data.
  const { data: myTeams } = useMyTeams()
  const teamName = myTeams?.find((team) => team.id === teamId)?.name ?? null
  const { data: teamProjects } = useProjects(teamId)
  const list = teamProjects?.find((p) => p.id === ticketProjectId) ?? null
  const { data: teamFolders = [] } = useFolders(teamId)

  /**
   * Konum satırı sayfalardaki gibi soldaki ağaçta da gösterir (#58fab188,
   * kullanıcı 28 Eyl: "benzer işlevi görevler içerisindeki breadcrumbs'a da").
   * Görev penceresi ağacın üstünü kapattığı için istek önce konur, sonra
   * pencere kapanıp panoya dönülür: panel açılınca bekleyen istek uygulanır.
   */
  const revealTeam = () => {
    if (teamId) revealInTree({ teamId, node: { kind: 'team', id: teamId } })
    goToBoard()
  }
  const revealList = () => {
    if (teamId && list) {
      revealInTree({
        teamId,
        folderIds: folderChain(teamFolders, list.folder_id ?? null).map((f) => f.id),
        node: { kind: 'list', id: list.id },
      })
      // Liste ana ekranda da açılır (kullanıcı, 28 Eyl). `/list/<id>` paylaşılan
      // liste adresinin yolu: hangi ekran açık olursa olsun (yönetim, gelen
      // kutusu, sayfa) o listeyi seçip adresi `/`'a düşürüyor. Tercihe yazıp
      // panoya dönmek yetmiyordu: pano zaten açıksa seçim değişmiyordu.
      goList(navigate, list.id)
      return
    }
    goToBoard()
  }

  // Activity/comments panel: resizable + collapsible; width & hidden persisted in prefs.
  const prefsData = prefs.prefs as { ticketPanelW?: number; ticketPanelHidden?: boolean }
  const [dragW, setDragW] = useState<number | null>(null)
  const panelHidden = prefsData.ticketPanelHidden === true
  const panelW = dragW ?? (typeof prefsData.ticketPanelW === 'number' ? clampW(prefsData.ticketPanelW) : DEFAULT_PANEL_W)
  const setPanelHiddenPersist = (v: boolean) => prefs.patch({ v: 1, ticketPanelHidden: v })
  const startPanelResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelW
    let lastW = startW
    const onMove = (ev: PointerEvent) => { lastW = clampW(startW + (startX - ev.clientX)); setDragW(lastW) }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
      prefs.patch({ v: 1, ticketPanelW: lastW })
      setDragW(null)
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── Shared top bar (breadcrumb + actions) ──
  const topBar = (
    <div data-tour="ticket-header" className="px-3 md:px-5 h-11 flex-shrink-0 border-b border-line-soft flex items-center gap-1.5">
      {backId && (
        <button
          type="button"
          onClick={goBack}
          data-ticket-back
          data-shortcut="ticket-back"
          aria-label={t('ticket.back')}
          title={backTicket?.title ? t('ticket.backTo', { name: backTicket.title }) : t('ticket.back')}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised transition-colors flex-shrink-0"
        >
          <Icon name="chevronLeft" />
        </button>
      )}
      {ticket && (
        <nav aria-label={t('ticket.breadcrumb')} className="flex items-center gap-1 text-xs text-fg-muted min-w-0">
          {teamName && (
            // Sağ tık soldaki ağaçtaki satırın menüsünü açar (#c675e160).
            <CrumbMenu node={teamId ? { kind: 'team', teamId } : null}>
              <button type="button" onClick={revealTeam} title={`${teamName} · ${t('ticket.crumb.reveal')}`} className="hidden md:flex items-center gap-1.5 flex-shrink-0 px-1.5 py-1 rounded-md hover:bg-raised transition-colors max-w-[160px]">
                <TeamMark name={teamName} />
                <span className="truncate font-medium text-fg-2 uppercase tracking-wide">{teamName}</span>
              </button>
            </CrumbMenu>
          )}
          {teamName && (list || ticket.parent_id) && <span className="hidden md:inline text-fg-faint">/</span>}
          {list && (
            <CrumbMenu node={teamId ? { kind: 'list', teamId, id: list.id } : null}>
              <button type="button" onClick={revealList} title={`${list.name} · ${t('ticket.crumb.reveal')}`} className="hidden sm:flex items-center gap-1.5 flex-shrink-0 px-1.5 py-1 rounded-md hover:bg-raised transition-colors max-w-[200px]">
                {/* The list's own icon and colour, as in the sidebar and the list header (#9ab8db99). */}
                <ListMark list={list} />
                <span className="truncate font-medium text-fg-2">{list.name}</span>
              </button>
            </CrumbMenu>
          )}
          {ticket.parent_id && (
            <>
              {(list || teamName) && <span className="text-fg-faint">/</span>}
              <button type="button" onClick={() => goTicket(ticket.parent_id!)} className="truncate max-w-[240px] font-medium text-primary-600 dark:text-primary-400 hover:underline px-1 py-1 rounded-md hover:bg-raised">{parentTicket?.title ?? '…'}</button>
              {canEdit && (
                // Detaching from the parent is a click away in the breadcrumb, so
                // confirm in place first — an accidental tap should not silently
                // break the hierarchy link.
                confirmUnlink ? (
                  <span className="flex items-center gap-1 text-xs animate-fade-in flex-shrink-0">
                    <span className="text-fg-muted">{t('ticket.unlinkConfirm')}</span>
                    <button type="button" onClick={() => { setParent.mutate({ id: ticket.id, parentId: null, previousParentId: ticket.parent_id }); setConfirmUnlink(false) }} className="px-1.5 py-0.5 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700">{t('ticket.unlinkAction')}</button>
                    <button type="button" onClick={() => setConfirmUnlink(false)} className="px-1.5 py-0.5 rounded-md text-fg-muted hover:bg-raised">{t('common.giveUp')}</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmUnlink(true)} title={t('ticket.unlinkParent')} aria-label={t('ticket.unlinkParent')} className="text-fg-faint hover:text-fg-2 flex-shrink-0">✕</button>
                )
              )}
            </>
          )}
        </nav>
      )}
      <span className="flex-1" />
      {canEdit && ticket && !confirmDelete && (
        <>
          <button onClick={() => copyTicket.mutate({ ticketId: ticket.id }, { onSuccess: (id) => goTicket(id) })} disabled={copyTicket.isPending} className="text-xs text-fg-2 hover:text-fg px-2.5 py-1.5 rounded-lg hover:bg-raised transition-colors min-h-[32px] font-medium disabled:opacity-50">{t('board.card.copy')}</button>
          <button onClick={() => setMoveOpen(true)} className="text-xs text-fg-2 hover:text-fg px-2.5 py-1.5 rounded-lg hover:bg-raised transition-colors min-h-[32px] font-medium">{t('board.card.move')}</button>
          {moveOpen && (
            <MoveToListDialog teamId={teamId ?? null} currentProjectId={ticket.project_id ?? null} busy={moveTicket.isPending}
              onPick={(p) => moveTicket.mutate({ ticketId: ticket.id, projectId: p.id }, { onSettled: () => setMoveOpen(false) })}
              onClose={() => setMoveOpen(false)} />
          )}
        </>
      )}
      {ticket && (
        confirmDelete && canDeleteTicket ? (
          <span className="flex items-center gap-1.5 text-xs animate-fade-in">
            <span className="text-fg-2">{t('ticket.deleteConfirm')}</span>
            <button onClick={handleDelete} disabled={deleteTicket.isPending} className="px-2.5 py-1.5 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50 min-h-[32px]">{t('ticket.deleteYes')}</button>
            <button onClick={() => setConfirmDelete(false)} className="px-2.5 py-1.5 rounded-lg text-fg-muted hover:bg-raised min-h-[32px]">{t('common.giveUp')}</button>
          </span>
        ) : (
          // Sil başlıkta Kopyala'nın yanında duruyordu (#e8bafa89): ⋯ menüsünde; onay aynı yerde, başlıkta.
          <>
            <button type="button" aria-haspopup="menu" aria-expanded={moreMenu.open} aria-label={t('ticket.moreActions')} title={t('ticket.moreActions')} data-ticket-more
              onClick={(e) => { if (moreMenu.open) moreMenu.close(); else moreMenu.openFrom(e.currentTarget) }}
              className={`tap w-8 h-8 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised transition-colors ${moreMenu.open ? 'bg-raised text-fg-2' : ''}`}>
              <Icon name="more" />
            </button>
            {moreMenu.menu}
          </>
        )
      )}
      <button onClick={minimize} aria-label={t('ticket.minimize')} title={t('ticket.minimizeHint')} className="tap w-8 h-8 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised transition-colors" data-ticket-minimize data-shortcut="ticket-minimize">
        <Icon name="minus" />
      </button>
      <button onClick={close} aria-label={t('common.close')} title={t('ticket.closeEsc')} className="tap w-8 h-8 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised transition-colors">
        <Icon name="close" />
      </button>
    </div>
  )

  // ── Shared fragment stack (title → properties → description → subtasks → linked → files) ──
  // Composed once; the frame decides where the activity/comments timeline goes:
  // a resizable right panel in full-screen, or stacked below the files in a popup.
  const isPopup = viewMode === 'popup'
  const mainFragments = ticket && (
        <>
          {/* Title */}
          <div className="flex items-start gap-2" data-tour="ticket-title">
            {canEdit && !ticket.parent_id && (
              <button type="button" onClick={(e) => setParentAnchor(parentAnchor ? null : e.currentTarget)} title={t('ticket.linkToParent')} aria-label={t('ticket.linkToParent')} aria-expanded={!!parentAnchor} className="mt-1 flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-fg-faint hover:text-primary-600 dark:hover:text-primary-400 hover:bg-raised transition-colors">
                <Icon name="link" />
              </button>
            )}
            {editTitle && canEdit ? (
              <input
                ref={titleRef}
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={() => { setEditTitle(false); if (titleValue.trim() && titleValue !== ticket?.title) saveGuarded('title', { title: titleValue.trim() }, titleValue) }}
                onKeyDown={(e) => { if (e.key === 'Enter') titleRef.current?.blur(); if (e.key === 'Escape') { setEditTitle(false); setTitleValue(ticket?.title ?? '') } }}
                className="flex-1 text-2xl font-bold text-fg border-b-2 border-primary-500 outline-none bg-transparent leading-snug"
              />
            ) : (
              <h2 className={`flex-1 min-w-0 text-2xl font-bold text-fg leading-snug ${canEdit ? 'cursor-pointer hover:text-primary-600 dark:hover:text-primary-400' : ''}`} onClick={() => canEdit && setEditTitle(true)}>{ticket.title}</h2>
            )}
            <div className="flex-shrink-0 pt-1.5 flex items-center"><FavoriteStar kind="ticket" id={ticket.id} shortcut="favorite" /><ShareLinkButton id={ticket.id} title={ticket.title} shortcut="copy-link" /><CopyId id={ticket.id} /></div>
          </div>
          {parentAnchor && (
            <LinkTicketPicker teamId={teamId ?? null} excludeId={ticket.id} alreadyLinked={[]} anchor={parentAnchor}
              onPick={async (id) => { await setParent.mutateAsync({ id: ticket.id, parentId: id, previousParentId: ticket.parent_id }); setParentAnchor(null) }}
              onClose={() => setParentAnchor(null)} />
          )}

          {/* Who made it / who touched it last — a quiet line under the title
              (Microsoft To Do style) instead of two form rows in the properties. */}
          {(ticket.creator || ticket.updater) && (
            <p className="-mt-3 text-xs text-fg-faint">
              {ticket.creator && (
                <>
                  <span className="text-fg-muted">{t('ticket.createdBy', { name: ticket.creator.full_name || ticket.creator.email || '' })}</span>
                  {' · '}<span title={exactTime(ticket.created_at)}>{displayTime(ticket.created_at)}</span>
                </>
              )}
              {ticket.updater && (
                <>
                  {ticket.creator && <span className="mx-1.5">·</span>}
                  <span className="text-fg-muted">{t('ticket.updatedBy', { name: ticket.updater.full_name || ticket.updater.email || '' })}</span>
                  {' · '}<span title={exactTime(ticket.updated_at)}>{displayTime(ticket.updated_at)}</span>
                </>
              )}
            </p>
          )}

          {/* Hand off to the AI agent (059) — one explicit click, not assignment */}
          <AiHandoffButton ticket={ticket} teamId={teamId ?? null} canEdit={canEdit} />

          {/* Properties fragment */}
          <div className="pb-6 border-b border-line-soft" data-tour="ticket-props">
            <TicketProperties ticket={ticket} statuses={statuses ?? []} canEdit={canEdit} teamId={teamId ?? null} ticketProjectId={ticketProjectId} onUpdate={handleUpdate} completed={completed ?? null} />
          </div>

          {/* Description fragment */}
          <div data-tour="ticket-description">
            <SectionLabel>{t('ticket.description')}</SectionLabel>
            {externalBy && !conflict && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs">
                <Icon name="alert" className="text-info" />
                <span className="flex-1 text-fg-2">{t('ticket.external.updated', { name: externalBy })}</span>
                <button onClick={adoptServer} className="font-medium text-info hover:underline flex-shrink-0">{t('ticket.external.refresh')}</button>
              </div>
            )}
            {conflict && (
              <div className="mb-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5 text-xs space-y-2">
                <p className="text-fg-2">
                  <span className="font-semibold text-warning">{t('ticket.conflict.title')}</span>{' '}
                  {t('ticket.conflict.body', {
                    field: conflict.field === 'description' ? t('ticket.conflict.fieldDescription') : t('ticket.conflict.fieldTitle'),
                  })}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={forceMine} className="px-2.5 py-1.5 rounded-md bg-warning/90 text-white font-semibold hover:bg-warning">{t('ticket.conflict.keepMine')}</button>
                  <button onClick={adoptServer} className="px-2.5 py-1.5 rounded-md text-fg-2 hover:bg-raised">{t('ticket.conflict.takeTheirs')}</button>
                </div>
              </div>
            )}
            <div onFocusCapture={() => setDescTouched(true)}>
              <Translated key={`tr-${ticket.id}`} original={ticket.description ?? ''} row={translations.byKey.get('description')} reading={translations.reading}
                preferOriginal={descTouched} locked={!!conflict || !!externalBy || (canEdit && descValue !== descSaved.current)}>
                {(text, translated) => translated ? (
                  <DescriptionEditor key={`tr-${ticket.id}`} value={text} onChange={() => {}} ticketId={ticket.id} readOnly minHeight="120px" placeholder={t('ticket.noDescription')} />
                ) : canEdit ? (
                  <DescriptionEditor key={ticket.id} teamId={teamId} value={descValue} onChange={setDescValue} onBlur={handleDescBlur} ticketId={ticket.id} insertSlot="description" toolbarOnFocus anchorsFor={ticket.id} anchorUrl={(a) => `${ticketUrl(ticket.id)}#${a}`} minHeight="160px" placeholder={t('ticket.descriptionPlaceholder')} onUploaded={(url, file, inText) => { if (inText) pastedDesc.current.push(url); attachRecord.mutate({ ticketId: ticket.id, fileUrl: url, fileName: file.name || t('ticket.pastedImageName') }) }} />
                ) : (
                  <DescriptionEditor key={`ro-${ticket.id}`} value={ticket.description ?? ''} onChange={() => {}} ticketId={ticket.id} readOnly anchorsFor={ticket.id} anchorUrl={(a) => `${ticketUrl(ticket.id)}#${a}`} minHeight="120px" placeholder={t('ticket.noDescription')} />
                )}
              </Translated>
            </div>
          </div>

          {/* Subtasks / checklist / linked tasks / pages / files: boşken gizli,
              başlangıçları tek bir aksiyon listesinde (#7c54fb70). A 3rd-level task
              (has a parent, whose parent also has a parent) is at the depth limit —
              no "add subtask" there; unknown while the parent loads. */}
          <TicketSections
            key={ticket.id}
            ticket={ticket}
            statuses={statuses ?? []}
            teamId={teamId ?? null}
            canEdit={canEdit}
            canDelete={(createdBy) => perms.canDelete(createdBy)}
            atMaxDepth={!ticket.parent_id ? false : parentPending ? undefined : !!parentTicket?.parent_id}
            onAttachmentDeleted={handleAttachmentDeleted}
            onSetCover={canEdit ? (url) => handleUpdate({ cover_url: url }) : undefined}
          />
        </>
  )

  // ── Popup body: everything in one scrolling column, timeline stacked below files ──
  const popupBody = ticket && (
    <div ref={scrollRef} onScroll={(e) => { scrollTopRef.current = e.currentTarget.scrollTop }} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-[60rem] px-4 py-5 md:px-8 md:py-6 space-y-6">
        {mainFragments}
        <div className="pt-6 border-t border-line-soft">
          <TicketTimeline ticketId={ticket.id} teamId={teamId} ticket={ticket} statuses={statuses ?? []} canEdit={canEdit} stacked />
        </div>
      </div>
    </div>
  )

  // ── Full-screen body: main column + resizable/collapsible activity panel ──
  const fullscreenBody = ticket && (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
      <div ref={scrollRef} onScroll={(e) => { scrollTopRef.current = e.currentTarget.scrollTop }} className="flex-1 min-w-0 md:h-full md:overflow-y-auto px-4 py-5 md:px-8 md:py-6 scrollbar-thin">
        <div className="mx-auto w-full max-w-[60rem] space-y-6">{mainFragments}</div>
      </div>

      {/* Activity + Comments fragment — resizable, collapsible */}
      {!panelHidden ? (
        <>
          <div onPointerDown={startPanelResize} role="separator" aria-orientation="vertical" title={t('ticket.panel.resize')} className="hidden md:block w-1 flex-shrink-0 cursor-col-resize bg-line-soft hover:bg-primary-400 transition-colors" />
          <div style={{ '--pw': `${panelW}px` } as React.CSSProperties} className="w-full md:w-[var(--pw)] md:flex-shrink-0 md:h-full border-t md:border-t-0 border-line-soft flex flex-col md:min-h-0 bg-app/30">
            <TicketTimeline ticketId={ticket.id} teamId={teamId} ticket={ticket} statuses={statuses ?? []} canEdit={canEdit} onCollapse={() => setPanelHiddenPersist(true)} />
          </div>
        </>
      ) : (
        <>
          <div className="hidden md:flex flex-col items-center flex-shrink-0 w-11 border-l border-line-soft bg-app/30 py-2 gap-1">
            <button onClick={() => setPanelHiddenPersist(false)} data-shortcut="ticket-panel" title={t('ticket.panel.show')} aria-label={t('ticket.panel.show')} className="w-8 h-8 flex items-center justify-center rounded-lg text-fg-muted hover:text-fg hover:bg-raised transition-colors">
              <Icon name="chevronsLeft" />
            </button>
            <button onClick={() => setPanelHiddenPersist(false)} data-shortcut="ticket-panel" title={t('ticket.activityAndComments')} aria-label={t('ticket.panel.show')} className="w-8 h-8 flex items-center justify-center rounded-lg text-fg-muted hover:text-fg hover:bg-raised transition-colors">
              <Icon name="comment" />
            </button>
          </div>
          <button onClick={() => setPanelHiddenPersist(false)} className="md:hidden w-full border-t border-line-soft py-2.5 text-sm font-medium text-fg-2 hover:bg-raised flex items-center justify-center gap-2">
            <Icon name="comment" />
            {t('ticket.activityAndComments')}
          </button>
        </>
      )}
    </div>
  )

  const body = isPopup ? popupBody : fullscreenBody

  const shellInner = (
    <>
      {topBar}
      {isLoading ? (
        <div className="flex-1 p-6 md:p-8 space-y-4">{[1, 2, 3].map(i => (<div key={i} className="h-8 bg-raised rounded-xl animate-pulse" />))}</div>
      ) : ticket ? body : (
        <div className="flex-1 flex items-center justify-center text-fg-faint">{t('ticket.notFound')}</div>
      )}
    </>
  )

  const label = ticket?.title ? t('ticket.dialogLabel', { title: ticket.title }) : t('ticket.dialogLabelFallback')

  // The frame is the user's choice, and until the prefs arrive we do not know
  // it: drawing the full-screen default first made a full-size view flash open
  // and shut right before the popup (#541947B0). Wait for the answer instead.
  if (!prefs.loaded) return null

  // ── Popup frame: centered card over the board ──
  // `data-modal-backdrop`: yüklü pencerede örtü başlık şeridinin altından
  // başlar (index.css) — şerit görünür kalır ve pencere oradan sürüklenir.
  if (viewMode === 'popup') {
    return (
      <div data-modal-backdrop className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end md:items-center justify-center md:p-4" onClick={(e) => { if (e.target === e.currentTarget && !keepOpenOnOutside) close() }}>
        <div ref={shellRef} role="dialog" aria-modal="true" aria-label={label} onPaste={handlePaste} data-ticket-window
          className="relative bg-surface shadow-2xl flex flex-col outline-none w-full rounded-t-xl h-[94dvh] md:rounded-xl md:w-[95vw] md:max-w-[1100px] md:h-[88vh] animate-slide-up overflow-hidden">
          {shellInner}
        </div>
      </div>
    )
  }

  // ── Full-screen frame: the board and its sidebar step aside ──
  // Üst çubuk (marka, arama, profil) yerinde kalır: tam ekran görünüm onun
  // altından başlar. Yüklü pencerede çubuğun kapladığı satır aynı zamanda
  // işletim sisteminin başlık şeridi; üstünü örtünce pencere düğmeleriyle
  // üst üste biniyordu (#849dd4b8). Telefonda yer dar, orada tam kaplar.
  return (
    <div data-ticket-full className="fixed inset-x-0 bottom-0 top-0 md:top-12 z-50 bg-app">
      <div ref={shellRef} role="dialog" aria-modal="true" aria-label={label} onPaste={handlePaste} data-ticket-window className="w-full h-full bg-surface flex flex-col outline-none animate-fade-in">
        {shellInner}
      </div>
    </div>
  )
}
