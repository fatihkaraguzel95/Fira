import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core'
import { SortableContext, useSortable } from '@dnd-kit/sortable'
import { edgeMode, holdStill, type DropMode } from './treeDnd'
import { HomePanel, readHomePrefs } from './HomePanel'
import { CSS } from '@dnd-kit/utilities'
import { usePrefs } from '../../hooks/usePrefs'
import { useMyTeams } from '../../hooks/useTeams'
import { useProjects, useDeleteProject } from '../../hooks/useProjects'
import { useFolders, useDeleteFolder, useDeleteFolderDeep } from '../../hooks/useFolders'
import { useTeamColors } from '../../hooks/useTeamColors'
import type { Team, Project, TeamFolder, TeamRole, PageParent, PageKind } from '../../types'
import { useBeta } from '../../hooks/useBeta'
import { emitError } from '../../lib/errorToast'
import { useTeamPages } from '../../hooks/usePages'
import { ROLE_LABELS } from '../../types'
import { APP_VERSION } from '../../version'
import { permissionsFor } from '../../hooks/useTeams'
import { FiraMark, FiraWordmark } from '../ui/Logo'
import { onRailRequest } from '../../lib/rail'
import { onRevealRequest, pendingReveal, revealRow, type RevealRequest } from '../../lib/revealTree'
import { useIsAdmin, useAdminAlerts } from '../../hooks/useAdmin'
import { ADMIN_TABS, isAdminTab, type AdminTab } from '../../pages/adminTabs'
import { supabase } from '../../lib/supabase'
import { useInstallPrompt } from '../../hooks/useInstallPrompt'
import { usePrefetchInbox, useUnreadCount } from '../../hooks/useNotifications'
import { TeamTree } from './TeamTree'
import { ConfirmDeleteModal } from './ConfirmDeleteModal'
import { folderBranch, teamMenuItems } from './treeMenus'

// CanvasView ve PageView buradan alıyor.
export { ConfirmDeleteModal }
import { useLocation, useNavigate } from 'react-router-dom'
import { useT } from '../../i18n'
import { useRowMenu, MenuIcons } from '../ui/RowMenu'
import { useAuth } from '../../hooks/useAuth'
import { useImportLock } from '../../lib/importJob'
import { isOverlayPath, go } from '../../lib/nav'
import type { TeamSettingsTab } from '../team/TeamSettingsModal'
import { Icon } from '../ui/Icon'

/** The panel's width before anyone drags the line. 256 px (Tailwind w-64) plus a fifth (#f1845ecf):
 *  list and page names were cut short at the old width. A width someone has dragged is kept as it is. */
const DEFAULT_SIDEBAR_W = 308

// ─── Small icon helpers ───────────────────────────────────────────────────────
const Chevron = ({ open }: { open: boolean }) => (
  <Icon name="chevronRight" className={`text-fg-faint transition-transform ${open ? 'rotate-90' : ''}`} />
)

// ─── Team block ──────────────────────────────────────────────────────────────
interface TeamBlockProps {
  team: Team & { my_role: TeamRole }
  /** Rendered after the ⋯ menu in the header — the level-2 panel puts its close button here. */
  trailing?: React.ReactNode
  selectedProjectId: string | null
  /** Last opened list (from server-side user prefs); auto-selected once lists are loaded. */
  restoreProjectId: string | null
  onSelectProject: (project: Project, team: Team, opts?: { explicit?: boolean }) => void
  onCreateList: (team: Team, folderId: string | null) => void
  onEditList: (team: Team, list: Project) => void
  onCreateFolder: (team: Team, parentId?: string | null) => void
  onEditFolder: (team: Team, folder: TeamFolder) => void
  onOpenSettings: (team: Team, tab?: TeamSettingsTab) => void
  onProjectDeleted: (projectId: string) => void
  activePageId: string | null
  onOpenPage: (id: string) => void
  onCreatePage: (team: Team, parent: PageParent, kind?: PageKind) => void
  /** Another team is being dragged over this one: which side it would land on. */
  dropEdge?: DropMode | null
}

function TeamBlock({ team, trailing, selectedProjectId, restoreProjectId, onSelectProject, onCreateList, onEditList, onCreateFolder, onEditFolder, onOpenSettings, onProjectDeleted, activePageId, onOpenPage, onCreatePage, dropEdge = null }: TeamBlockProps) {
  const t = useT()
  const navigate = useNavigate()
  const { kinds: canvasKinds } = useBeta()
  const sortable = useSortable({ id: `team:${team.id}` })
  const sortableStyle = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.6 : 1,
  }
  const { user } = useAuth()
  const perms = permissionsFor(team.my_role, user?.id ?? null)
  // While a OneNote import writes into this team, its tree is read-only (#684A9085).
  const importing = useImportLock(team.id)
  const edit = importing ? { canManage: false, canWrite: false, canDelete: () => false } : perms
  const [expanded, setExpanded] = useState(true)
  const [deleteList, setDeleteList] = useState<Project | null>(null)
  const [deleteFolder, setDeleteFolder] = useState<TeamFolder | null>(null)
  /** The same folder, but "with everything in it" (#1F44279C). */
  const [deleteFolderDeep, setDeleteFolderDeep] = useState<TeamFolder | null>(null)
  /** Which branches are open. Here rather than in the tree, so the team menu can open or close the lot. */
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})
  const [openPages, setOpenPages] = useState<Record<string, boolean>>({})
  /** Sayfası olan listeler katlanabilir (#960a5d22); takım ağacıyla birlikte hatırlanır. */
  const [openLists, setOpenLists] = useState<Record<string, boolean>>({})
  // Remembered per team in the user's prefs (`tree.<teamId>`), so a collapsed
  // team stays collapsed after a reload (kullanıcı, 15 Eyl). Restored once,
  // when the prefs for this account have actually arrived.
  type TreeState = { expanded?: boolean; folders?: Record<string, boolean>; pages?: Record<string, boolean>; lists?: Record<string, boolean> }
  const treePrefs = usePrefs('global')
  const savedTree = ((treePrefs.prefs as { tree?: Record<string, TreeState> }).tree ?? {})[team.id]
  const restoredTree = useRef(false)
  useEffect(() => {
    if (restoredTree.current || !treePrefs.loaded) return
    restoredTree.current = true
    if (!savedTree) return
    if (savedTree.expanded !== undefined) setExpanded(savedTree.expanded)
    if (savedTree.folders) setOpenFolders(savedTree.folders)
    if (savedTree.pages) setOpenPages(savedTree.pages)
    if (savedTree.lists) setOpenLists(savedTree.lists)
  }, [treePrefs.loaded]) // eslint-disable-line react-hooks/exhaustive-deps
  /** Persist the whole team entry: the server replaces `tree.<teamId>` as one object.
   *  Kayıt **ref'ten** kurulur: iki dalı arka arkaya açınca ikinci çağrı henüz
   *  yeniden çizilmemiş state'i okuyup birincisini geri alıyordu (#6dcda6e5). */
  const treeRef = useRef({ expanded, folders: openFolders, pages: openPages, lists: openLists })
  treeRef.current = { expanded, folders: openFolders, pages: openPages, lists: openLists }
  const remember = (next: TreeState & { home?: { widgets: string[]; teams: string[] } }) => {
    const { home: h, ...tree } = next
    if (h) { treePrefs.patch({ home: h }); return }
    // Ref'i de hemen güncelle: aynı karede gelen ikinci değişiklik bunu görsün.
    treeRef.current = { ...treeRef.current, ...tree }
    treePrefs.patch({ tree: { [team.id]: { ...treeRef.current } } })
  }
  /**
   * Konum satırından gelen "ağaçta göster" isteği (#58fab188): yalnız yol
   * üzerindeki dallar açılır, sonra satır kaydırılıp vurgulanır. Uygulama bir
   * kare ertelenir — panel yeni açıldıysa bu blok o karede tercihleri geri
   * yüklüyor ve `treeRef` henüz eski hâli gösteriyor (kaydı eziyordu).
   */
  const applyReveal = (r: RevealRequest) => {
    const opened = (ids: string[] | undefined, cur: Record<string, boolean>) =>
      ids?.length ? { ...cur, ...Object.fromEntries(ids.map((id) => [id, true])) } : cur
    let nextFolders = opened(r.folderIds, treeRef.current.folders)
    let nextPages = opened(r.pageIds, treeRef.current.pages)
    const nextLists = r.listId ? { ...treeRef.current.lists, [r.listId]: true } : treeRef.current.lists
    // Konum çubuğu menüsünden "Tümünü aç/kapat" (#c675e160): yol açıldıktan sonra dal.
    if (r.branch) {
      const b = r.branch.folderId ? folderBranch(r.branch.folderId, folders, lists, pages) : { folderIds: new Set(folders.map((f) => f.id)), pages }
      const flags = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, r.branch!.open]))
      nextFolders = { ...nextFolders, ...flags([...b.folderIds]) }
      nextPages = { ...nextPages, ...flags(b.pages.map((pg) => pg.id)) }
    }
    setExpanded(true)
    setOpenFolders(nextFolders)
    setOpenPages(nextPages)
    setOpenLists(nextLists)
    remember({ expanded: true, folders: nextFolders, pages: nextPages, lists: nextLists })
    revealRow(r.node.kind, r.node.id)
  }
  const revealRef = useRef(applyReveal)
  revealRef.current = applyReveal
  const revealedId = useRef(0)
  useEffect(() => {
    // Bekleyen istek: panel kapalıyken istenmişse blok yeni takılmıştır. İstek
    // numarası, aynı isteğin bu kopyada iki kez uygulanmasını önler.
    const take = () => {
      const cur = pendingReveal(team.id)
      if (!cur || revealedId.current === cur.id) return
      revealedId.current = cur.id
      window.setTimeout(() => revealRef.current(cur.req), 0)
    }
    take()
    return onRevealRequest((r) => { if (r.teamId === team.id) take() })
  }, [team.id])
  // "Ana sayfaya ekle" (#A16136B5): the team's tree also shows in the Home panel.
  const home = readHomePrefs(treePrefs.prefs)
  const onHome = home.teams.includes(team.id)
  const toggleExpanded = () => { const v = !expanded; setExpanded(v); remember({ expanded: v }) }
  const toggleFolderOpen = (id: string, open: boolean) => { const next = { ...openFolders, [id]: open }; setOpenFolders(next); remember({ folders: next }) }
  const togglePageOpen = (id: string, open: boolean) => { const next = { ...openPages, [id]: open }; setOpenPages(next); remember({ pages: next }) }
  const toggleListOpen = (id: string, open: boolean) => { const next = { ...openLists, [id]: open }; setOpenLists(next); remember({ lists: next }) }

  const { data: lists = [] } = useProjects(team.id)
  const { data: folders = [] } = useFolders(team.id)
  const { data: colors = [] } = useTeamColors(team.id)
  const { data: pages = [] } = useTeamPages(team.id)
  const deleteListMutation = useDeleteProject()
  const deleteFolderMutation = useDeleteFolder()
  const deleteFolderDeepMutation = useDeleteFolderDeep()

  const colorHex = (id: string | null) => colors.find((c) => c.id === id)?.hex ?? null

  // Restore last opened list once lists are known
  useEffect(() => {
    if (!lists.length || selectedProjectId) return
    const match = restoreProjectId ? lists.find((p) => p.id === restoreProjectId) : null
    if (match) onSelectProject(match, team)
  }, [lists, restoreProjectId])

  const handleDeleteList = async () => {
    if (!deleteList) return
    await deleteListMutation.mutateAsync({ projectId: deleteList.id, teamId: team.id })
    onProjectDeleted(deleteList.id)
    setDeleteList(null)
  }
  const handleDeleteFolder = async () => {
    if (!deleteFolder) return
    await deleteFolderMutation.mutateAsync({ id: deleteFolder.id, teamId: team.id })
    setDeleteFolder(null)
  }
  const handleDeleteFolderDeep = async () => {
    if (!deleteFolderDeep) return
    const folder = deleteFolderDeep
    setDeleteFolderDeep(null)
    await deleteFolderDeepMutation.mutateAsync({ id: folder.id, teamId: team.id }).catch(emitError)
  }

  /** What a deep delete would take with it (for the confirmation). */
  const branchOf = (rootId: string) => folderBranch(rootId, folders, lists, pages)
  /** Open or close a whole branch — a folder and everything under it, or the team (null). */
  const setBranchOpen = (folderId: string | null, open: boolean) => {
    const branch = folderId ? branchOf(folderId) : { folderIds: new Set(folders.map((f) => f.id)), lists, pages }
    const flags = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, open]))
    const nextFolders = { ...openFolders, ...flags([...branch.folderIds]) }
    const nextPages = { ...openPages, ...flags(branch.pages.map((pg) => pg.id)) }
    setOpenFolders(nextFolders)
    setOpenPages(nextPages)
    if (open) setExpanded(true)
    remember({ folders: nextFolders, pages: nextPages, expanded: open ? true : expanded })
  }

  // Every team action in one menu: the button on the header, or a right click (#1F44279C).
  // Öğeler treeMenus'ta; konum çubuklarının menüsü de aynısını kurar (#c675e160).
  const menuItems = teamMenuItems({ edit, perms, canvasKinds, hasContent: !!(folders.length || lists.length || pages.length), onHome }, {
    newList: () => { setExpanded(true); onCreateList(team, null) },
    newFolder: () => { setExpanded(true); onCreateFolder(team) },
    newPage: (k) => { setExpanded(true); onCreatePage(team, { kind: 'team' }, k) },
    expandAll: () => setBranchOpen(null, true),
    collapseAll: () => setBranchOpen(null, false),
    toggleHome: () => remember({ home: { ...home, teams: onHome ? home.teams.filter((id) => id !== team.id) : [...home.teams, team.id] } }),
    openSettings: (tab) => onOpenSettings(team, tab),
    openAgents: () => go(navigate, `/me/agents?team=${team.id}`),
  })
  const menu = useRowMenu(menuItems, { title: team.name, label: t('board.menu.more', { name: team.name }) })

  return (
    <div ref={sortable.setNodeRef} style={sortableStyle} className="mb-1">
      {/* Team header — also the handle for reordering teams (press and drag it).
          `data-team-dnd` is what the drop is hit-tested against: dnd-kit's own
          `over` went blank between two tall team blocks (#AC4BC182). */}
      {/* Takım logosu panel başlığının simgesiyle aynı hizada: soldaki 8 px boşluk
          kaldırıldı (kullanıcı, 28 Eyl — gri zeminde hizasızlık göze çarpıyor). */}
      <div data-team-dnd={`team:${team.id}`} onContextMenu={menu.onContextMenu} className="relative flex items-center gap-1 px-3 py-1.5 group rounded-xl mr-2 hover:bg-raised transition-colors">
        {dropEdge === 'before' && <span className="absolute left-2 right-2 -top-0.5 h-0.5 bg-primary-500 rounded-full" aria-hidden />}
        {dropEdge === 'after' && <span className="absolute left-2 right-2 -bottom-0.5 h-0.5 bg-primary-500 rounded-full" aria-hidden />}
        <button
          {...sortable.attributes}
          {...sortable.listeners}
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className="flex items-center gap-2 flex-1 text-left min-w-0 cursor-pointer"
          title={`${team.name} · ${t(ROLE_LABELS[team.my_role])} · ${t('board.sidebar.teamDragHint')}`}
        >
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center flex-shrink-0 shadow-sm">
            <span className="text-white text-xs font-bold leading-none">{team.name.charAt(0).toUpperCase()}</span>
          </div>
          <span className="flex-1 min-w-0 text-[13px] font-semibold text-fg truncate">{team.name}</span>
          {importing && (
            <span className="flex items-center gap-1 text-2xs font-medium text-primary-600 dark:text-primary-400 flex-shrink-0" title={t('onenote.locked')}>
              <span className="w-2.5 h-2.5 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
              {t('onenote.lockedBadge')}
            </span>
          )}
          <Chevron open={expanded} />
        </button>
        {/* Always visible: the team's actions have no other entry point. */}
        {menu.trigger}
        {menu.menu}
        {trailing}
      </div>

      {expanded && (
        <TeamTree
          team={team}
          folders={folders}
          lists={lists}
          colorHex={colorHex}
          canManage={edit.canManage}
          canWrite={edit.canWrite}
          canDeletePage={edit.canDelete}
          openFolders={openFolders}
          openPages={openPages}
          openLists={openLists}
          onToggleFolder={toggleFolderOpen}
          onTogglePage={togglePageOpen}
          onToggleList={toggleListOpen}
          onSetBranchOpen={setBranchOpen}
          onDeleteFolderDeep={setDeleteFolderDeep}
          pages={pages}
          activePageId={activePageId}
          onOpenPage={onOpenPage}
          onCreatePage={onCreatePage}
          selectedProjectId={selectedProjectId}
          onSelectProject={onSelectProject}
          onCreateList={onCreateList}
          onEditList={onEditList}
          onEditFolder={onEditFolder}
          onCreateFolder={(parentId) => onCreateFolder(team, parentId)}
          onDeleteList={(l) => setDeleteList(l)}
          onDeleteFolder={(f) => setDeleteFolder(f)}
        />
      )}
      {deleteList && (
        <ConfirmDeleteModal title={t('board.deleteList')} name={deleteList.name} warning={t('board.sidebar.deleteListWarning', { name: deleteList.name })} onClose={() => setDeleteList(null)} onConfirm={handleDeleteList} />
      )}
      {deleteFolder && (
        <ConfirmDeleteModal title={t('board.deleteFolder')} name={deleteFolder.name} warning={t('board.sidebar.deleteFolderWarning')} onClose={() => setDeleteFolder(null)} onConfirm={handleDeleteFolder} />
      )}
      {deleteFolderDeep && (() => {
        const b = branchOf(deleteFolderDeep.id)
        return (
          <ConfirmDeleteModal
            title={t('board.tree.deleteFolderDeepTitle')}
            name={deleteFolderDeep.name}
            warning={t('board.tree.deleteFolderDeepWarning', { name: deleteFolderDeep.name, folders: b.folderIds.size - 1, lists: b.lists.length, pages: b.pages.length })}
            onClose={() => setDeleteFolderDeep(null)}
            onConfirm={() => void handleDeleteFolderDeep()}
          />
        )
      })()}
    </div>
  )
}

// ─── Rail (v0.22.1, #1F44279C — ClickUp model) ────────────────────────────────
/**
 * One entry of the fixed rail: an icon with its name under it (kullanıcı, 16 Eyl:
 * ClickUp'taki gibi). The rail never widens; a click opens a level-2 panel
 * beside it, or toggles the inbox drawer. New app-level features are added
 * here as further entries.
 */
function RailItem({ icon, label, active = false, pressed, onClick, onPrefetch, badge, dataTour, shortcut, wide = false }: {
  icon: React.ReactNode; label: string; active?: boolean; pressed?: boolean; onClick: () => void
  /** Kısayol eylemi (`data-shortcut`, F1 katmanı ve Ctrl+Shift+1… için). */
  shortcut?: string
  /** Warm what the button will show, on hover/focus (#44b1a977). */
  onPrefetch?: () => void
  badge?: number; dataTour?: string
  /** Phone drawer: icon left, name right, full width. */
  wide?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      aria-label={label}
      aria-current={active ? 'true' : undefined}
      aria-pressed={pressed}
      data-tour={dataTour}
      data-shortcut={shortcut}
      className={wide
        ? `w-full flex items-center gap-3 h-11 px-2 rounded-xl transition-colors cursor-pointer ${active ? 'bg-raised text-fg' : 'text-fg-2 hover:bg-raised hover:text-fg'}`
        : `relative w-full flex flex-col items-center justify-center gap-0.5 min-h-[60px] py-1.5 rounded-xl transition-colors cursor-pointer ${active ? 'bg-raised text-fg' : 'text-fg-2 hover:bg-raised hover:text-fg'}`}
    >
      {active && !wide && <span className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-primary-500" aria-hidden />}
      <span className="relative flex items-center justify-center w-7 h-7 flex-shrink-0">
        {icon}
        {!!badge && badge > 0 && (
          <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-2xs font-bold flex items-center justify-center tabular-nums">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className={wide ? 'flex-1 min-w-0 text-sm font-medium truncate text-left' : 'text-2xs leading-[1.15] font-medium text-center px-0.5 line-clamp-2 break-words'}>{label}</span>
    </button>
  )
}

const HomeIcon = () => (
  <Icon name="home" size={20} />
)
/** A rail entry the user can drag to reorder (press and move; a click still activates it). */
function RailSortable({ id, children }: { id: string; children: React.ReactNode }) {
  const sortable = useSortable({ id })
  // dnd-kit'in `attributes`'u sarmalayıcıyı odaklanabilir bir düğme yapıyordu: şeritteki
  // her öğe iki Tab durağı oluyor, içteki düğmeyle de iç içe etkileşim çıkıyordu
  // (#990dfec5). Sıralama fareyle sürüklemede kalır; klavye düğmenin kendisinde.
  return (
    <div ref={sortable.setNodeRef} style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition, opacity: sortable.isDragging ? 0.6 : 1 }} {...sortable.listeners} className="touch-none">
      {children}
    </div>
  )
}

const BellIcon = () => (
  <Icon name="bell" size={20} />
)
const TeamsIcon = () => (
  <Icon name="teams" size={20} />
)
/** Yönetim: kalkan — "sistem" anlamı taşıyan, takım/ev simgelerine karışmayan bir biçim. */
const AdminIcon = () => (
  <Icon name="admin" size={20} />
)
const BackIcon = () => (
  <Icon name="chevronLeft" />
)

/** What the rail remembers between sessions (user prefs, `sidebar.view`). Older saved `{kind:'team'}` values open the teams panel. */
type RailView = { kind: 'rail' } | { kind: 'home' } | { kind: 'teams' } | { kind: 'admin' }
/** Rail entries below the inbox; the user orders them. */
type RailKey = 'home' | 'teams' | 'admin'
const RAIL_DEFAULT: RailKey[] = ['home', 'teams', 'admin']
const RAIL_W = 64

// ─── Sidebar ──────────────────────────────────────────────────────────────────
interface Props {
  selectedProjectId: string | null
  /** Last opened list (server-side user prefs) to auto-select on load. */
  restoreProjectId: string | null
  onSelectProject: (project: Project, team: Team, opts?: { explicit?: boolean }) => void
  onCreateTeam: () => void
  onJoinTeam: () => void
  onShowChangelog?: () => void
  onCreateList: (team: Team, folderId: string | null) => void
  onEditList: (team: Team, list: Project) => void
  onCreateFolder: (team: Team, parentId?: string | null) => void
  onEditFolder: (team: Team, folder: TeamFolder) => void
  onOpenSettings: (team: Team, tab?: TeamSettingsTab) => void
  onProjectDeleted: (projectId: string) => void
  /** The page open in the main area (064), highlighted in the tree. */
  activePageId: string | null
  onOpenPage: (id: string) => void
  onCreatePage: (team: Team, parent: PageParent, kind?: PageKind) => void
  /** Desktop: open the inbox drawer over the current view instead of the /inbox page (#F6EBA5AD). */
  onToggleInbox?: () => void
  inboxOpen?: boolean
  isOpen?: boolean
  onClose?: () => void
}

export function Sidebar({
  selectedProjectId, restoreProjectId, onSelectProject, onCreateTeam, onJoinTeam, onShowChangelog,
  onCreateList, onEditList, onCreateFolder, onEditFolder, onOpenSettings, onProjectDeleted,
  activePageId, onOpenPage, onCreatePage, onToggleInbox, inboxOpen = false,
  isOpen = false, onClose,
}: Props) {
  // Aliased: `t` is already taken by the team callbacks below (`.map((t) => …)`
  // and the keyboard handler's `const t = e.target`).
  const tr = useT()
  const { canInstall, install } = useInstallPrompt()
  const { data: teams, isLoading } = useMyTeams()
  const { data: unread = 0 } = useUnreadCount()

  // Sidebar team order is a personal thing, not something one member decides for
  // the whole team — so it lives in this user's preferences, not on the team row.
  const prefs = usePrefs('global')
  const savedOrder = (prefs.prefs as { teamOrder?: string[] }).teamOrder ?? []
  const orderedTeams = useMemo(() => {
    const list = teams ?? []
    if (savedOrder.length === 0) return list
    const rank = new Map(savedOrder.map((id, i) => [id, i]))
    // Teams joined after the last drag have no rank yet: they keep their place at the end.
    return [...list].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  }, [teams, savedOrder])

  // Desktop width: dragged on the line between sidebar and main area, kept in
  // the user's global prefs. Deliberately no min/max (#00206109) — only the
  // screen edge, so the line itself can always be grabbed again.
  const savedW = (prefs.prefs as { sidebarW?: number }).sidebarW
  const [dragW, setDragW] = useState<number | null>(null)
  const width = dragW ?? (typeof savedW === 'number' ? savedW : DEFAULT_SIDEBAR_W)
  const toScreen = (w: number) => Math.round(Math.max(0, Math.min(w, window.innerWidth - 8)))
  const saveWidth = (w: number | null) => prefs.patch({ v: 1, sidebarW: w })
  const startResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    let last = startW
    const onMove = (ev: PointerEvent) => { last = toScreen(startW + ev.clientX - startX); setDragW(last) }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      if (last !== startW) saveWidth(last)
      setDragW(null)
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const onResizeKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      saveWidth(toScreen(width + (e.key === 'ArrowRight' ? step : -step)))
    } else if (e.key === 'Home' || e.key === 'Enter') {
      e.preventDefault()
      saveWidth(null)
    }
  }

  // Creating and joining teams moved from big footer buttons to the "Teams" heading (#1F44279C).
  const teamsMenu = useRowMenu([
    { key: 'create', label: tr('board.sidebar.createTeam'), icon: MenuIcons.plus, onSelect: onCreateTeam },
    { key: 'join', label: tr('board.sidebar.joinByCode'), icon: MenuIcons.key, onSelect: onJoinTeam },
  ], { label: tr('board.menu.teamsActions') })

  const teamSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  // Teams are reordered the way the tree does it: the row under the pointer,
  // read from the DOM. dnd-kit's own `over` came back empty between two tall
  // team blocks, so a team could be picked up but never dropped (#AC4BC182).
  const teamPointer = useRef({ x: 0, y: 0 })
  const [teamHint, setTeamHint] = useState<{ id: string; mode: DropMode } | null>(null)
  useEffect(() => {
    const onMove = (e: PointerEvent) => { teamPointer.current = { x: e.clientX, y: e.clientY } }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])
  const teamUnderPointer = (dragged: string) => {
    const stack = typeof document.elementsFromPoint === 'function'
      ? (document.elementsFromPoint(teamPointer.current.x, teamPointer.current.y) as Element[])
      : []
    for (const el of stack) {
      const row = el.closest?.('[data-team-dnd]') as HTMLElement | null
      const id = row?.dataset.teamDnd
      if (id && id !== dragged) return { id, rect: row!.getBoundingClientRect() }
    }
    return null
  }
  const trackTeamHint = ({ active }: DragMoveEvent) => {
    const t = teamUnderPointer(String(active.id))
    if (!t) { setTeamHint(null); return }
    const mode = edgeMode(t.rect, teamPointer.current.y)
    setTeamHint((prev) => (prev && prev.id === t.id && prev.mode === mode ? prev : { id: t.id, mode }))
  }
  const handleTeamDragStart = ({ activatorEvent }: DragStartEvent) => {
    const e = activatorEvent as PointerEvent
    teamPointer.current = { x: e.clientX ?? 0, y: e.clientY ?? 0 }
  }
  const handleTeamDragEnd = ({ active }: DragEndEvent) => {
    const landed = teamUnderPointer(String(active.id))
    const mode = landed && teamHint?.id === landed.id ? teamHint.mode : 'after'
    setTeamHint(null)
    if (!landed) return
    const id = (x: string) => x.replace(/^team:/, '')
    const dragged = id(String(active.id))
    const target = id(landed.id)
    if (dragged === target) return
    const rest = orderedTeams.filter((t) => t.id !== dragged)
    const at = rest.findIndex((t) => t.id === target)
    if (at < 0) return
    const moved = orderedTeams.find((t) => t.id === dragged)
    if (!moved) return
    rest.splice(mode === 'after' ? at + 1 : at, 0, moved)
    prefs.patch({ v: 1, teamOrder: rest.map((t) => t.id) })
  }

  const navigate = useNavigate()
  const location = useLocation()
  const { data: isAdmin = false } = useIsAdmin()
  // Rozet: gelen kutusundaki gibi, bekleyen uyarı sayısı (#7AB2D9F6).
  const adminAlerts = useAdminAlerts(isAdmin)
  const adminTab: AdminTab | null = location.pathname.startsWith('/admin')
    ? (isAdminTab(location.pathname.split('/')[2]) ? (location.pathname.split('/')[2] as AdminTab) : 'overview')
    : null
  // ── Rail state (#1F44279C, ClickUp model) ───────────────────────────────────
  // Level 1 is a fixed rail of labelled icons; level 2 is a panel beside it —
  // "Takımlar" opens the whole team tree (every team, folders, lists, pages),
  // "Favoriler" the favourites. The open panel is remembered in the user's prefs.
  type SidebarPrefs = { sidebar?: { view?: { kind: string } } }
  const savedSidebar = (prefs.prefs as SidebarPrefs).sidebar
  const [view, setViewState] = useState<RailView>({ kind: 'rail' })
  // The panel answers the click at once (#20c4ed37): the rail's mark, the panel's
  // header and a skeleton are drawn first, the content — every team's tree, for
  // Teams — follows in a render that does not block the screen. Before this the
  // whole tree was built before anything changed, and the button seemed to hang.
  const shownKind = useDeferredValue(view.kind)
  const switching = view.kind !== 'rail' && shownKind !== view.kind
  // The panel exists for the desktop and inside the phone drawer; only the one in use is mounted.
  const isDesktop = useIsDesktop()
  const restoredView = useRef(false)
  const lastTeamId = (prefs.prefs as { lastTeamId?: string | null }).lastTeamId ?? null
  useEffect(() => {
    if (restoredView.current || !prefs.loaded) return
    restoredView.current = true
    // Doğrudan /admin adresiyle (yer imi, yenileme) açıldıysa panel zaten yönetime
    // ayarlandı; tercih geç geldiği için onu ezip "Takımlar"ı açıyordu (#7ab2d9f3).
    if (adminTab) return
    const k = savedSidebar?.view?.kind
    if (k === 'favorites' || k === 'home') setViewState({ kind: 'home' })
    else if (k === 'teams' || k === 'team' || (!k && lastTeamId)) setViewState({ kind: 'teams' })
  }, [prefs.loaded]) // eslint-disable-line react-hooks/exhaustive-deps
  const setView = (v: RailView) => { setViewState(v); prefs.patch({ sidebar: { view: v } }) }
  /** Level-2 toggle: the open one closes, the other opens. */
  const toggleView = (v: RailView) => setView(view.kind === v.kind ? { kind: 'rail' } : v)
  // The top bar's mark opens Home; a team picked in the command palette opens Teams at that team.
  const setViewRef = useRef(setView); setViewRef.current = setView
  useEffect(() => onRailRequest(({ kind, teamId }) => {
    setViewRef.current({ kind })
    // Üst çubuktaki marka ya da paletten gelen istek yönetim ekranındaysa oradan da çıkar.
    // (Etkinin bağımlılığı boş; o yüzden yol ve yönlendirme ref üzerinden okunuyor.)
    if (pathRef.current.startsWith('/admin')) navRef.current(lastNonAdmin.current.path.startsWith('/admin') ? '/' : lastNonAdmin.current.path)
    if (teamId) window.setTimeout(() => document.querySelector(`[data-team-dnd="team:${teamId}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120)
  }), [])
  // Konum satırından "ağaçta göster" (#58fab188): panel kapalı ya da Ana sayfa
  // açıksa önce Takımlar'a geçilir; takım bloğu takılınca isteği kendisi alır.
  // Yönetim ekranı açıksa ondan da çıkılır (kullanıcı, 28 Eyl: "gelen kutusu ya
  // da yönetim paneli açıksa gösterme davranışı tamamlanmıyor") — hedef bir
  // listeyse isteği açan taraf hemen ardından o listeye götürür.
  useEffect(() => onRevealRequest(() => {
    setViewRef.current({ kind: 'teams' })
    if (pathRef.current.startsWith('/admin')) navRef.current(lastNonAdmin.current.path.startsWith('/admin') ? '/' : lastNonAdmin.current.path)
  }), [])
  // Yönetim ekranına başka bir yerden girilince (profil menüsü, komut paleti,
  // doğrudan bağlantı) panel de açılsın; sonra kullanıcı kapatırsa kapalı kalır.
  const enteredAdmin = useRef(false)
  useEffect(() => {
    if (adminTab && !enteredAdmin.current) setViewRef.current({ kind: 'admin' })
    enteredAdmin.current = !!adminTab
  }, [adminTab])
  // Yönetim "üzerine" değil "yerine" açılan bir ekran (kullanıcı raporu, 22 Eyl):
  // kapatınca bırakılan ekrana geri dönülmeli. Son yönetim dışı adres ile o
  // andaki panel saklanıyor; çıkışta ikisi de geri konuyor.
  const lastNonAdmin = useRef<{ path: string; view: RailView }>({ path: '/', view: { kind: 'teams' } })
  useEffect(() => {
    // Görev penceresi bir ekran değil, açık ekranın üstündeki bir katmandır:
    // adresi "bırakılan ekran" diye saklanınca yönetim ↔ görev döngüsü çıkıyordu
    // (#7ab2d9f3): görev kapanınca geçmişte bir geri = yönetim, yönetim kapanınca
    // saklanan adres = görev, ve baştan. Katman adresleri hatırlanmaz; altındaki
    // ekran neyse yönetimden çıkışta ona dönülür.
    if (!location.pathname.startsWith('/admin') && !isOverlayPath(location.pathname)) {
      lastNonAdmin.current = { path: location.pathname + location.search, view: view.kind === 'admin' ? { kind: 'teams' } : view }
    }
  }, [location.pathname, location.search, view])
  const pathRef = useRef(location.pathname); pathRef.current = location.pathname
  const navRef = useRef(navigate); navRef.current = navigate
  const leaveAdmin = () => {
    const back = lastNonAdmin.current
    setView(back.view)
    go(navigate, back.path.startsWith('/admin') ? '/' : back.path)
  }
  const [homeEditing, setHomeEditing] = useState(false)
  useEffect(() => { if (view.kind !== 'home') setHomeEditing(false) }, [view.kind])
  // The rail's own order (below the inbox), dragged by the user and kept in prefs.
  const savedRail = ((prefs.prefs as { sidebar?: { railOrder?: string[] } }).sidebar?.railOrder ?? []).filter((k): k is RailKey => k === 'home' || k === 'teams' || k === 'admin')
  // Yönetim girdisi yalnız sistem yöneticisinde var; sıralamadan da düşürülüyor,
  // yoksa sürükleme bağlamında karşılığı olmayan bir kimlik kalırdı (#7AB2D9F6).
  const railOrder: RailKey[] = [...savedRail, ...RAIL_DEFAULT.filter((k) => !savedRail.includes(k))].filter((k) => k !== 'admin' || isAdmin)
  const railSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const onRailDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = railOrder.indexOf(active.id as RailKey), to = railOrder.indexOf(over.id as RailKey)
    if (from < 0 || to < 0) return
    const next = [...railOrder]; next.splice(to, 0, next.splice(from, 1)[0])
    prefs.patch({ sidebar: { view, railOrder: next } })
  }

  // The last opened list used to be restored by the team's block; with the
  // rail that block may not be mounted, so it is restored here from its id.
  const restoredProject = useRef(false)
  useEffect(() => {
    if (restoredProject.current || selectedProjectId || !restoreProjectId || !teams?.length) return
    restoredProject.current = true
    void supabase.from('projects').select('*').eq('id', restoreProjectId).maybeSingle().then(({ data }) => {
      const project = data as Project | null
      const team = project ? teams.find((t) => t.id === project.team_id) : null
      if (project && team) onSelectProject(project, team)
    })
  }, [restoreProjectId, selectedProjectId, teams]) // eslint-disable-line react-hooks/exhaustive-deps

  const prefetchInbox = usePrefetchInbox()

  // ── Pieces ──────────────────────────────────────────────────────────────────
  const inboxItem = (wide: boolean) => (
    <RailItem
      wide={wide}
      icon={<BellIcon />}
      label={tr('board.sidebar.inbox')}
      badge={unread}
      active={inboxOpen}
      pressed={inboxOpen}
      onPrefetch={prefetchInbox}
      dataTour="notifications"
      shortcut="inbox"
      onClick={() => {
        if (onToggleInbox && window.matchMedia('(min-width: 768px)').matches) { onToggleInbox(); return }
        go(navigate, '/inbox'); onClose?.()
      }}
    />
  )
  /** Yönetim açıkken başka bir şerit girdisine basmak da o ekrandan çıkarır. */
  const goPanel = (v: RailView) => {
    if (adminTab) { setView(v); go(navigate, lastNonAdmin.current.path.startsWith('/admin') ? '/' : lastNonAdmin.current.path); return }
    // The inbox lies over the panels (#f6eba5ad): with it open, another rail entry
    // means "take me there" — the inbox closes and that panel shows, even if it
    // was the one already open underneath (a toggle would have shut it).
    if (inboxOpen) { onToggleInbox?.(); setView(v); return }
    toggleView(v)
  }
  const railEntry = (k: RailKey, wide: boolean) => k === 'home'
    ? <RailItem wide={wide} icon={<HomeIcon />} label={tr('board.sidebar.home')} shortcut="home" active={view.kind === 'home'} pressed={view.kind === 'home'} onClick={() => goPanel({ kind: 'home' })} />
    : k === 'teams'
    ? <RailItem wide={wide} icon={<TeamsIcon />} label={tr('board.sidebar.teams')} shortcut="teams" active={view.kind === 'teams'} pressed={view.kind === 'teams'} onClick={() => goPanel({ kind: 'teams' })} />
    : <RailItem
        wide={wide}
        icon={<AdminIcon />}
        label={tr('board.sidebar.admin')}
        shortcut="admin"
        badge={adminAlerts.length}
        active={view.kind === 'admin' || !!adminTab}
        pressed={view.kind === 'admin'}
        onClick={() => {
          // Paneli açar ve ekranı da getirir; ikinci tıkta çıkar (diğer girdiler gibi).
          if (adminTab) { leaveAdmin(); return }
          setView({ kind: 'admin' })
          go(navigate, '/admin')
          onClose?.()
        }}
      />
  /** The inbox sits apart at the top with its own toggle; the entries under it are one exclusive group the user can reorder. */
  const railItems = (wide: boolean) => (
    <>
      <div data-chrome-sep className={`${wide ? 'pb-1 mb-1' : 'pb-1.5 mb-1.5'} border-b border-line-soft`}>{inboxItem(wide)}</div>
      <DndContext sensors={railSensors} collisionDetection={closestCenter} onDragEnd={onRailDragEnd}>
        <SortableContext items={railOrder} strategy={holdStill}>
          {railOrder.map((k) => <RailSortable key={k} id={k}>{railEntry(k, wide)}</RailSortable>)}
        </SortableContext>
      </DndContext>
    </>
  )
  const installIcon = (
    <Icon name="download" />
  )

  /** Level 1 on a desktop: fixed, never widens. */
  const railContent = (
    <div className="flex flex-col h-full">
      {/* The Fira mark lives in the top bar now (#43a865fb), right above this column. */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-1 py-2 space-y-1 scrollbar-thin">{railItems(false)}</div>
      <div data-chrome-sep className="border-t border-line-soft px-1 py-1.5 space-y-1">
        {canInstall && (
          <button onClick={install} aria-label={tr('board.sidebar.install')} title={tr('board.sidebar.installTitle')} className="w-full flex flex-col items-center justify-center gap-0.5 h-12 rounded-xl text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/30 transition-colors cursor-pointer">
            {installIcon}
            <span className="text-2xs leading-tight font-medium">{tr('board.sidebar.installShort')}</span>
          </button>
        )}
        <button type="button" onClick={onShowChangelog} title={tr('board.sidebar.changelog')} aria-label={tr('board.sidebar.changelog')} className="w-full h-7 text-2xs font-mono tabular-nums text-fg-muted hover:text-fg transition-colors cursor-pointer">v{APP_VERSION}</button>
      </div>
    </div>
  )

  /** Phone drawer, level 1: the same entries with their names beside the icons. */
  const railWide = (
    <div className="flex flex-col h-full">
      <div data-chrome-sep className="flex items-center h-14 pt-px px-3 border-b border-line-soft gap-2">
        <FiraMark size={26} className="text-fg" />
        <FiraWordmark height={16} className="text-fg" />
        <span className="flex-1" />
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised transition-colors" aria-label={tr('board.sidebar.closeMenu')}>
          <Icon name="close" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5 scrollbar-thin">{railItems(true)}</div>
      <div data-chrome-sep className="border-t border-line-soft px-2 py-1.5">
        {canInstall && (
          <button onClick={install} className="w-full flex items-center gap-3 h-11 px-2 rounded-xl text-sm font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/30 transition-colors cursor-pointer" title={tr('board.sidebar.installTitle')}>
            <span className="w-7 h-7 flex items-center justify-center">{installIcon}</span>{tr('board.sidebar.install')}
          </button>
        )}
        <button type="button" onClick={onShowChangelog} title={tr('board.sidebar.changelog')} className="w-full flex items-center justify-between h-8 px-2 text-xs text-fg-faint hover:text-fg-muted transition-colors cursor-pointer">
          <FiraWordmark className="text-[12px]" /><span className="font-mono tabular-nums">v{APP_VERSION}</span>
        </button>
      </div>
    </div>
  )

  const homeTeams = readHomePrefs(prefs.prefs).teams
  /**
   * Ana sayfadaki takımlar kendi sıralarını taşır (#C2C27B51). Eskiden ekleme
   * sırasına göre değil, kenar çubuğunun genel takım sırasına göre çiziliyordu
   * ve sürükleme hiçbir şey yapmıyordu (bırakma işleyicisi yoktu).
   */
  // Artık üye olunmayan bir takım listede kalmış olabilir: onu eler.
  const homeTeamOrder = homeTeams.filter((id) => orderedTeams.some((t) => t.id === id))
  const onHomeTeamDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const id = String(active.id).replace(/^team:/, '')
    const overId = String(over.id).replace(/^team:/, '')
    const list = [...homeTeamOrder]
    const from = list.indexOf(id)
    const to = list.indexOf(overId)
    if (from < 0 || to < 0) return
    list.splice(to, 0, list.splice(from, 1)[0])
    prefs.patch({ home: { teams: list } })
  }
  const homeTeamsWidget = (
    <DndContext sensors={teamSensors} collisionDetection={closestCenter} onDragEnd={onHomeTeamDragEnd}>
      <SortableContext items={homeTeamOrder.map((id) => `team:${id}`)} strategy={holdStill}>
        {homeTeamOrder.map((id) => orderedTeams.find((t) => t.id === id)).filter((t): t is typeof orderedTeams[number] => !!t).map((team) => (
          <TeamBlock key={team.id} team={team} selectedProjectId={selectedProjectId} restoreProjectId={restoreProjectId} onSelectProject={onSelectProject} onCreateList={onCreateList} onEditList={onEditList} onCreateFolder={onCreateFolder} onEditFolder={onEditFolder} onOpenSettings={onOpenSettings} onProjectDeleted={onProjectDeleted} activePageId={activePageId} onOpenPage={onOpenPage} onCreatePage={onCreatePage} />
        ))}
      </SortableContext>
    </DndContext>
  )
  /** Level 2: every team's tree (the sidebar as it was), or the favourites. */
  const panelTitle = view.kind === 'home' ? tr('board.sidebar.home') : view.kind === 'admin' ? tr('board.sidebar.admin') : tr('board.sidebar.teams')
  const closePanelBtn = (
    <button
      type="button"
      onClick={() => (view.kind === 'admin' ? leaveAdmin() : setView({ kind: 'rail' }))}
      className="hidden md:flex w-7 h-7 items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised transition-colors cursor-pointer flex-shrink-0"
      aria-label={tr('board.sidebar.closePanel')}
      title={tr('board.sidebar.closePanel')}
    >
      <Icon name="close" />
    </button>
  )
  const backBtn = (
    <button
      type="button"
      onClick={() => (view.kind === 'admin' ? leaveAdmin() : setView({ kind: 'rail' }))}
      className="md:hidden flex items-center gap-1 pl-1.5 pr-2.5 h-8 rounded-lg text-sm text-fg-2 hover:text-fg hover:bg-raised transition-colors"
      aria-label={tr('board.sidebar.back')}
    >
      <BackIcon />{tr('board.sidebar.back')}
    </button>
  )
  const panelContent = (
    <div className="flex flex-col h-full">
      <div data-chrome-sep className="h-14 pt-px px-3 border-b border-line-soft flex items-center gap-2" onContextMenu={view.kind === 'teams' ? teamsMenu.onContextMenu : undefined}>
        <span className="w-[26px] h-[26px] flex items-center justify-center text-fg-2">{view.kind === 'home' ? <HomeIcon /> : view.kind === 'admin' ? <AdminIcon /> : <TeamsIcon />}</span>
        <span className="flex-1 min-w-0 text-sm font-semibold text-fg truncate">{panelTitle}</span>
        {view.kind === 'teams' && teamsMenu.trigger}
        {view.kind === 'teams' && teamsMenu.menu}
        {closePanelBtn}
        {backBtn}
      </div>
      <div className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {switching && (
          <div className="px-4 py-3 space-y-2.5" data-panel-skeleton aria-hidden>
            {[72, 56, 64, 48, 60, 52].map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-raised animate-pulse flex-shrink-0" />
                <div className="h-3 bg-raised rounded-md animate-pulse" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        )}
        {!switching && view.kind === 'home' && (
          <HomePanel
            teams={orderedTeams}
            editing={homeEditing}
            onToggleEditing={() => setHomeEditing((v) => !v)}
            onSelectProject={onSelectProject}
            onOpenPage={onOpenPage}
            onClose={onClose}
            teamsWidget={homeTeamsWidget}
          />
        )}
        {!switching && view.kind === 'admin' && (
          <nav className="px-2 space-y-0.5">
            {ADMIN_TABS.map((item) => (
              <button
                key={item.id}
                onClick={() => { go(navigate, `/admin/${item.id}`); onClose?.() }}
                aria-current={adminTab === item.id ? 'page' : undefined}
                className={`w-full text-left text-sm px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer ${adminTab === item.id ? 'bg-primary-600 text-white' : 'text-fg-2 hover:bg-raised'}`}
              >
                {tr(item.key)}
              </button>
            ))}
            {adminAlerts.length > 0 && (
              <p className="px-2.5 pt-3 text-xs text-danger">{tr('misc.admin.alertCount', { n: adminAlerts.length })}</p>
            )}
          </nav>
        )}
        {!switching && view.kind === 'teams' && (
          isLoading ? (
            <div className="px-4 py-3 space-y-2.5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-raised animate-pulse flex-shrink-0" />
                  <div className="h-3 flex-1 bg-raised rounded-md animate-pulse" />
                </div>
              ))}
            </div>
          ) : orderedTeams.length > 0 ? (
            <DndContext
              sensors={teamSensors}
              collisionDetection={closestCenter}
              onDragStart={handleTeamDragStart}
              onDragMove={trackTeamHint}
              onDragOver={trackTeamHint}
              onDragEnd={handleTeamDragEnd}
              onDragCancel={() => setTeamHint(null)}
            >
              {/* holdStill: a team block that slides away takes the row the pointer is measured against with it. */}
              <SortableContext items={orderedTeams.map((t) => `team:${t.id}`)} strategy={holdStill}>
                {orderedTeams.map((team) => (
                  <TeamBlock
                    key={team.id}
                    team={team}
                    dropEdge={teamHint?.id === `team:${team.id}` ? teamHint.mode : null}
                    selectedProjectId={selectedProjectId}
                    restoreProjectId={restoreProjectId}
                    onSelectProject={onSelectProject}
                    onCreateList={onCreateList}
                    onEditList={onEditList}
                    onCreateFolder={onCreateFolder}
                    onEditFolder={onEditFolder}
                    onOpenSettings={onOpenSettings}
                    onProjectDeleted={onProjectDeleted}
                    activePageId={activePageId}
                    onOpenPage={onOpenPage}
                    onCreatePage={onCreatePage}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            <div className="px-4 py-8 text-center">
              <div className="w-10 h-10 rounded-full bg-raised flex items-center justify-center mx-auto mb-3 text-fg-faint"><TeamsIcon /></div>
              <p className="text-xs text-fg-muted font-medium">{tr('board.sidebar.noTeams')}</p>
              <div className="mt-3 space-y-2">
                <button onClick={onCreateTeam} className="w-full px-3 py-2 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors">{tr('board.sidebar.createTeam')}</button>
                <button onClick={onJoinTeam} className="w-full px-3 py-2 rounded-xl text-sm font-semibold bg-raised text-fg-2 border border-line hover:border-fg-faint transition-colors">{tr('board.sidebar.joinByCode')}</button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )

  const panelOpen = view.kind !== 'rail'
  const treeKeys = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const t = e.target as HTMLElement
    if (!(t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement)) return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button, a[href]')).filter((el) => el.offsetParent !== null && el.tabIndex >= 0)
    const i = items.indexOf(t)
    if (i < 0) return
    e.preventDefault()
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }

  return (
    <>
      <div className={`fixed inset-0 bg-black/50 z-30 md:hidden transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />

      {/* Desktop, level 1: the fixed rail. */}
      <aside
        data-tour="sidebar"
        aria-label={tr('board.sidebar.aria')}
        onKeyDown={treeKeys}
        className="hidden md:flex flex-shrink-0 h-full bg-nav flex-col overflow-hidden"
        style={{ width: RAIL_W }}
      >
        {railContent}
      </aside>

      {/* Desktop, level 2: docked beside the rail, resizable, stays until closed. */}
      {panelOpen && isDesktop && (
        <>
          <section aria-label={panelTitle} onKeyDown={treeKeys} className="hidden md:flex flex-shrink-0 h-full bg-panel flex-col overflow-hidden animate-fade-in" style={{ width }}>
            {panelContent}
          </section>
          {/* Sürükleme çubuğu normalde görünmez (kullanıcı, 28 Eyl): yalnız
              üzerine gelince — ya da sürüklerken — ortasında üç dikey çizgili
              tutamak belirir. Çizginin kendisi `data-chrome-sep` ile yeni
              kabukta çizilmiyor. */}
          <div data-chrome-sep className="hidden md:block relative w-px flex-shrink-0 border-r border-line-soft">
            {/* Erişilebilir hedef ortadaki 24×28 tutamak (#fc1659d8, WCAG 2.5.8): rolü, odağı ve
                klavyesi onda. Tam boy ince şerit yalnız fareye kolaylık — 24 px'e genişletmek ağaçtaki
                ⋯ düğmelerinin üstünü örtüyordu. */}
            <div
              title={tr('board.sidebar.resize')}
              onPointerDown={startResize}
              onDoubleClick={() => saveWidth(null)}
              className={`group/resize absolute inset-y-0 -left-1.5 -right-1.5 z-20 cursor-col-resize flex items-center justify-center has-[:focus-visible]:opacity-100 ${dragW !== null ? 'opacity-100' : 'opacity-0 hover:opacity-100'} transition-opacity`}
            >
              <span
                role="separator"
                aria-orientation="vertical"
                aria-label={tr('board.sidebar.resize')}
                aria-valuenow={width}
                tabIndex={0}
                onKeyDown={onResizeKey}
                className="flex items-center justify-center gap-[2px] w-6 h-7 flex-shrink-0 rounded-md bg-surface border border-line shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                <span className="w-px h-3.5 bg-fg-faint" />
                <span className="w-px h-3.5 bg-fg-faint" />
                <span className="w-px h-3.5 bg-fg-faint" />
              </span>
            </div>
          </div>
        </>
      )}

      {/* Phone: the same two levels inside one drawer. */}
      <aside
        aria-label={tr('board.sidebar.aria')}
        onKeyDown={treeKeys}
        className={`md:hidden fixed inset-y-0 left-0 z-40 w-72 transform transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : '-translate-x-full'} bg-panel border-r border-line-soft flex flex-col`}
      >
        {isDesktop ? null : panelOpen ? panelContent : railWide}
      </aside>
    </>
  )
}
