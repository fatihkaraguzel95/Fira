import { openTicket, go, closeOverlay, onOpenList } from '../lib/nav'
import { Icon } from '../components/ui/Icon'
import { Suspense, lazy, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { noteRecent } from '../lib/favorites'
import { onRevealRequest } from '../lib/revealTree'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { isAdminTab, type AdminTab } from './adminTabs'
/** Yönetim ekranı büyük ve seyrek açılır; her pano yüklemesinde inmesin (#B98717D4). */
const AdminView = lazy(() => import('./AdminPage').then((m) => ({ default: m.AdminView })))
import { useAuth } from '../hooks/useAuth'
import { useTickets, useCreateTicket } from '../hooks/useTickets'
import { useStatuses } from '../hooks/useStatuses'
import { useTeamRole, useMyTeams } from '../hooks/useTeams'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import { Header } from '../components/layout/Header'
import { Sidebar } from '../components/layout/Sidebar'
import { TreeActionsContext, type TreeActions } from '../components/layout/treeMenus'
import { KanbanBoard } from '../components/board/KanbanBoard'
import { useListViewConfig } from '../hooks/useListViewConfig'
import { DEFAULT_LIST_VIEW, sanitizeListView } from '../lib/listView'
import { useSavedViews } from '../hooks/useSavedViews'
import { ViewBar } from '../components/list/ViewBar'
import { TaskTray } from '../components/ticket/TaskTray'
import { CreateTeamModal } from '../components/team/CreateTeamModal'
import { JoinTeamModal } from '../components/team/JoinTeamModal'
import type { TeamSettingsTab } from '../components/team/TeamSettingsModal'
import { FolderModal } from '../components/team/FolderModal'
import { PendingInvitationsBanner } from '../components/team/PendingInvitationsBanner'
import { AnnouncementBanner, MaintenanceScreen } from '../components/layout/AnnouncementBanner'
import { ConnectionBanner } from '../components/layout/ConnectionBanner'
import { ServerDiskBanner } from '../components/layout/ServerDiskBanner'
import { useIsAdmin, useSystemSettings } from '../hooks/useAdmin'
import { useReleaseNote } from '../hooks/useReleaseNote'
import type { SettingsTab } from '../components/profile/SettingsModal'
import { NotificationHost } from '../components/layout/NotificationHost'
import { onOpenInbox, type InboxTarget } from '../lib/inboxBus'
import { AppTour } from '../components/tour/AppTour'
import { startTour } from '../lib/tour'
import type { ViewMode, Project, Team, Profile, TeamFolder, TicketFilters } from '../types'
import { applyTicketFilters } from '../lib/ticketFilters'
import { useShortcuts } from '../hooks/useShortcuts'
import { onShortcut, emitShortcut, type ShortcutAction } from '../lib/shortcuts'
import { ShortcutLayer } from '../components/shortcuts/ShortcutLayer'
import { TopBar } from '../components/layout/TopBar'
import type { PaletteCommand } from '../components/layout/CommandPalette'
import { openRailPanel } from '../lib/rail'
import { setThemeMode } from '../hooks/useTheme'
import { usePrefs, listScope, GLOBAL_SCOPE } from '../hooks/usePrefs'
import { supabase } from '../lib/supabase'
import { useT, useLang } from '../i18n'
import { openPalette, listFilter } from '../lib/palette'
import { useRecurrenceCatchUp } from '../hooks/useRecurrence'
import { useBeta } from '../hooks/useBeta'
import { useOpenNewPage } from '../components/page/useOpenNewPage'
import { onOpenTeamSettings } from '../lib/teamSettingsBus'

// Ana paketten ayrılan ekranlar (#74d303e2): editör (tiptap/prosemirror), markdown
// okuyucu ve seyrek açılan pencereler ilk açılışta inmez; ilk kullanıldıklarında
// iner (service worker kurulumdan sonra hepsini zaten önbelleğe alır).
const TicketModal = lazy(() => import('../components/ticket/TicketModal').then((m) => ({ default: m.TicketModal })))
const PageScreen = lazy(() => import('../components/page/PageScreen').then((m) => ({ default: m.PageScreen })))
const TicketListView = lazy(() => import('../components/list/TicketListView').then((m) => ({ default: m.TicketListView })))
const MyTasksView = lazy(() => import('../components/me/MeView').then((m) => ({ default: m.MyTasksView })))
const RecentsView = lazy(() => import('../components/me/MeView').then((m) => ({ default: m.RecentsView })))
const AgentPanel = lazy(() => import('../components/agents/AgentPanel').then((m) => ({ default: m.AgentPanel })))
const InboxDrawer = lazy(() => import('../components/inbox/InboxDrawer').then((m) => ({ default: m.InboxDrawer })))
const SettingsModal = lazy(() => import('../components/profile/SettingsModal').then((m) => ({ default: m.SettingsModal })))
const TeamSettingsModal = lazy(() => import('../components/team/TeamSettingsModal').then((m) => ({ default: m.TeamSettingsModal })))
const ListModal = lazy(() => import('../components/project/ListModal').then((m) => ({ default: m.ListModal })))
const ChangelogModal = lazy(() => import('../components/ChangelogModal').then((m) => ({ default: m.ChangelogModal })))
const ShortcutsDialog = lazy(() => import('../components/shortcuts/ShortcutsDialog').then((m) => ({ default: m.ShortcutsDialog })))

/** Tembel bir ekran inerken içerik alanında görünen dönen halka. */
const AreaLoading = () => (
  <div className="flex items-center justify-center h-full" role="status" aria-live="polite">
    <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-600 border-t-transparent" />
  </div>
)

/** The board's list groups by status out of the box (ClickUp default); the user's last choice per list overrides it (TL-02). */
const BOARD_LIST_VIEW = { ...DEFAULT_LIST_VIEW, groupBy: 'status' as const }

export function BoardPage() {
  // Aliased: `t` is a ticket in several callbacks below, and a timer id in one.
  const tr = useT()
  useRealtimeSync()
  const { ticketId, pageId, meView, listId, adminTab: adminTabParam } = useParams<{ ticketId?: string; pageId?: string; meView?: string; listId?: string; adminTab?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  // Yönetim paneli artık ayrı bir sayfa değil, kabuğun içinde bir ekran (#7AB2D9F6).
  const adminTab: AdminTab | null = location.pathname.startsWith('/admin')
    ? (isAdminTab(adminTabParam) ? adminTabParam : 'overview')
    : null
  // A page (064) takes over the main area; the sidebar and header stay.
  const ticketIdRef = useRef(ticketId); ticketIdRef.current = ticketId
  const pageIdRef = useRef(pageId); pageIdRef.current = pageId
  const meViewRef = useRef(meView); meViewRef.current = meView
  const adminRef = useRef(false); adminRef.current = !!adminTab
  const openNewPage = useOpenNewPage()
  const beta = useBeta()
  const { data: myTeams = [] } = useMyTeams()
  const createTicket = useCreateTicket()
  const { user, signOut } = useAuth()
  const [showWhatsNew, setShowWhatsNew] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
  useShortcuts()
  useEffect(() => onShortcut('settings', () => setSettingsTab('profile')), [])
  // Kısayol listesi Teams'teki gibi ayrı bir pencere (#75dc7a96); tuşları değiştirmek Ayarlar'da.
  const [showShortcuts, setShowShortcuts] = useState(false)
  useEffect(() => onShortcut('shortcuts', () => setShowShortcuts((v) => !v)), [])
  /**
   * BoardPage'in kendi yürüttüğü kısayollar (#75dc7a96). İşlevler aşağıda, bakım
   * ekranı dönüşünden sonra kuruluyor; burada yalnız bir kez bağlanıyor.
   * Ekrandaki bir düğmeye karşılık gelenler (küçült, favori …) burada değil:
   * onları `data-shortcut` işaretli düğmeye tıklayarak lib/shortcuts yürütür.
   */
  const shortcutRuns = useRef<Partial<Record<ShortcutAction, () => void>>>({})
  useEffect(() => {
    const own: ShortcutAction[] = ['theme-toggle', 'whats-new', 'inbox', 'home', 'teams', 'admin', 'my-tasks', 'recents', 'new-page', 'list-settings']
    const offs = own.map((id) => onShortcut(id, () => shortcutRuns.current[id]?.()))
    return () => offs.forEach((off) => off())
  }, [])
  useEffect(() => onShortcut('notifications', () => setSettingsTab('notifications')), [])
  useEffect(() => onShortcut('theme', () => setSettingsTab('theme')), [])

  const [view, setViewState] = useState<ViewMode>('board')
  const [filters, setFiltersState] = useState<TicketFilters>({})
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null)
  const [currentUserProfile, setCurrentUserProfile] = useState<Profile | null>(null)

  // ── Server-side preferences (per user × list): view mode + filters; global: last opened list ──
  const globalPrefs = usePrefs(GLOBAL_SCOPE)
  const listPrefs = usePrefs(currentProject ? listScope(currentProject.id) : null)
  const prefsAppliedFor = useRef<string | null>(null)
  /** `/list/:id?view=` ile gelen görünüm. Liste tercihleri listeyi açtıktan
   *  **sonra** geldiği için doğrudan yazılan görünümü eziyordu (#d46f6d70
   *  bağlantıları, 25 Eyl); istek burada bekler ve tercih uygulanırken geçer. */
  const wantedView = useRef<{ listId: string; view: ViewMode } | null>(null)
  useEffect(() => {
    if (!currentProject || !listPrefs.loaded || prefsAppliedFor.current === currentProject.id) return
    prefsAppliedFor.current = currentProject.id
    const p = listPrefs.prefs as { view?: ViewMode; filters?: TicketFilters }
    const wanted = wantedView.current?.listId === currentProject.id ? wantedView.current.view : null
    wantedView.current = null
    setViewState(wanted ?? (p.view === 'list' ? 'list' : 'board'))
    if (wanted) listPrefs.patch({ v: 1, view: wanted })
    setFiltersState(sanitizeFilters(p.filters))
  }, [currentProject?.id, listPrefs.loaded])
  const setView = (v: ViewMode) => { setViewState(v); listPrefs.patch({ v: 1, view: v }) }
  const viewRef = useRef(view); viewRef.current = view
  useEffect(() => onShortcut('toggle-view', () => setView(viewRef.current === 'board' ? 'list' : 'board')), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onShortcut('board', () => setView('board')), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onShortcut('list', () => setView('list')), []) // eslint-disable-line react-hooks/exhaustive-deps
  const setFilters = (f: TicketFilters) => { setFiltersState(f); listPrefs.patch({ v: 1, filters: filtersPatch(f) }) }

  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [showJoinTeam, setShowJoinTeam] = useState(false)
  const [settingsTeam, setSettingsTeam] = useState<Team | null>(null)
  const [settingsTeamTab, setSettingsTeamTab] = useState<TeamSettingsTab | undefined>(undefined)
  const [listModal, setListModal] = useState<{ team: Team; list?: Project; folderId?: string | null } | null>(null)
  const [folderModal, setFolderModal] = useState<{ team: Team; folder?: TeamFolder; parentId?: string | null } | null>(null)

  const [sidebarOpen, setSidebarOpen] = useState(false)
  /** Inbox drawer over the current view (desktop, #F6EBA5AD). */
  const [inboxOpen, setInboxOpen] = useState(false)
  /** Which notification to pick when the inbox opens from a toast / system notification. */
  const [inboxTarget, setInboxTarget] = useState<InboxTarget | null>(null)
  const closeInbox = () => { setInboxOpen(false); setInboxTarget(null) }
  // The inbox is a place to pick from, not one to stay in (#f6eba5ad): whatever it
  // opens on the main screen — a task, the release notes, a link in a comment —
  // closes it. Named things close it where they are called; this catches the rest
  // by the address changing after the drawer opened. Leaving a task window is not
  // "opening something": the inbox itself closes that window when it opens over
  // one, and the address may follow a render later.
  const inboxPath = useRef<string | null>(null)
  useEffect(() => {
    const from = inboxPath.current
    inboxPath.current = inboxOpen ? location.pathname : null
    if (!inboxOpen || from === null || from === location.pathname) return
    if (from.startsWith('/ticket/') && !location.pathname.startsWith('/ticket/')) return
    closeInbox()
  }, [inboxOpen, location.pathname])
  // Telefonda kenar çubuğu bir çekmece: "ağaçta göster" isteği gelince açılsın (#58fab188).
  // Gelen kutusu çekmecesi de kapanır (kullanıcı, 28 Eyl): ekranın üstünü kaplıyor,
  // altında yapılan gösterme görünmüyordu. (Yönetim ekranından çıkmayı Sidebar yapar.)
  useEffect(() => onRevealRequest(() => {
    setInboxOpen(false); setInboxTarget(null)
    if (!window.matchMedia('(min-width: 768px)').matches) setSidebarOpen(true)
  }), [])
  useEffect(() => onOpenInbox((target) => {
    if (window.matchMedia('(min-width: 768px)').matches) {
      // A ticket window would cover the drawer: close it first.
      if (window.location.pathname.startsWith('/ticket/')) closeOverlay(navigate)
      setInboxTarget(target)
      setInboxOpen(true)
    } else go(navigate, target.ticketId ? `/inbox?ticket=${target.ticketId}` : '/inbox')
  }), [navigate])

  // The import dock's "Raporu aç" (#684A9085): the team's settings on the given tab.
  useEffect(() => onOpenTeamSettings(({ teamId, tab }) => {
    const team = myTeams.find((x) => x.id === teamId)
    if (team) { setSettingsTeamTab(tab as TeamSettingsTab); setSettingsTeam(team) }
  }), [myTeams])

  const { perms } = useTeamRole(currentTeam?.id ?? null)
  const listView = useListViewConfig(BOARD_LIST_VIEW, currentProject ? listScope(currentProject.id) : null)
  // Saved views (TL-09): the live state is the view mode + list config + filters; a view puts all three on screen.
  const savedViews = useSavedViews({
    key: currentProject ? { scope: 'project', projectId: currentProject.id, teamId: currentTeam?.id ?? null } : null,
    prefsScope: currentProject ? listScope(currentProject.id) : null,
    live: { type: view, list: listView.config, filters: filtersPatch(filters) },
    apply: (v) => {
      setView(v.type)
      if (v.config.list) listView.setConfig(sanitizeListView(v.config.list, BOARD_LIST_VIEW))
      setFilters(sanitizeFilters(v.config.filters))
    },
    canManageTeam: perms.canManage,
  })
  const { data: isAdmin } = useIsAdmin()
  const { data: sysSettings } = useSystemSettings()

  const { data: tickets = [], isLoading: ticketsLoading } = useTickets(
    currentProject ? { project_id: currentProject.id, include_archived: true } : undefined
  )
  const { data: statuses = [], isLoading: statusesLoading } = useStatuses(currentProject?.id ?? null)
  // Tekrarlayan görevler (#59e0b75e): sunucudaki cron 5 dakikada bir üretiyor; liste
  // açılınca gecikmiş tekrar varsa hemen üretilsin diye aynı işi bir kez dürtüyoruz.
  useRecurrenceCatchUp(currentProject?.id ?? null)
  // The list's own search box is gone (#9ab8db99): searching is the palette's job ("/" opens it
  // narrowed to this list), so no search text filters the board any more.
  const visibleTickets = useMemo(
    () => applyTicketFilters(tickets, { ...filters, search: undefined }),
    [tickets, filters],
  )
  // The new list (TL-03) decides subtask visibility itself (nested under the
  // parent, or separate rows by the filter), so it needs the subtasks in.
  const listTickets = useMemo(
    () => applyTicketFilters(tickets, { ...filters, search: undefined, show_children: true }).filter((t) => !t.archived_at),
    [tickets, filters],
  )
  /**
   * Per-status "total" for the "3/120" badge. It is not the raw row count: subtask
   * visibility follows the user's own show_children choice, so a column never
   * claims to be hiding the subtasks that are hidden by design. Closed items DO
   * count, so a closed column can honestly say 0/157 next to its "hidden" notice.
   */
  const statusTotals = useMemo(() => {
    const baseline = applyTicketFilters(tickets, { show_children: filters.show_children, show_closed: true })
    const m = new Map<string, number>()
    for (const t of baseline) {
      if (t.archived_at || !t.status_id) continue
      m.set(t.status_id, (m.get(t.status_id) ?? 0) + 1)
    }
    return m
  }, [tickets, filters.show_children])

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => { if (data) setCurrentUserProfile(data as Profile) })
  }, [user])

  useEffect(() => {
    const pendingToken = sessionStorage.getItem('pendingInviteToken')
    if (pendingToken) {
      sessionStorage.removeItem('pendingInviteToken')
      window.location.href = `/invite/${pendingToken}`
    }
  }, [])

  // A new version no longer opens the release notes by itself (#2aa4f068): it is
  // an unread row in the inbox. Having had the full notes open reads that row.
  const releaseNote = useReleaseNote()
  const handleCloseWhatsNew = () => {
    setShowWhatsNew(false)
    if (releaseNote.unread) releaseNote.setRead(true)
  }

  // "Yeni Ticket" is a single step: create the row now and open its real detail
  // view straight away (no intermediate form — see ticket 789F9F01). The detail
  // opens with the cursor in the title; if it is left empty, TicketModal discards
  // the row on exit, so changing your mind leaves no blank task behind.
  const handleNewTicket = async () => {
    if (pageIdRef.current || meViewRef.current || !currentProject || statuses.length === 0 || !perms.canWrite) return
    const first = statuses[0]
    try {
      const ticket = await createTicket.mutateAsync({
        title: '',
        status: first.name,
        status_id: first.id,
        priority: 'medium',
        project_id: currentProject.id,
        place: 'top',
      })
      go(navigate, `/ticket/${ticket.id}`, { state: { draft: true } })
    } catch { /* MutationCache surfaces the error as a toast */ }
  }
  const newTicketRef = useRef(handleNewTicket); newTicketRef.current = handleNewTicket
  useEffect(() => onShortcut('new-ticket', () => newTicketRef.current()), [])

  // First-run product tour: once, after a list is on screen so its steps have
  // something to point at. We only auto-open after prefs have loaded (so an
  // existing user who has seen it is not re-shown) and mark it done up front so
  // it never auto-opens again — the profile menu re-opens it on demand.
  const tourAutoStarted = useRef(false)
  const tourSeen = (globalPrefs.prefs as { tourDoneV1?: boolean }).tourDoneV1 === true
  useEffect(() => {
    if (tourAutoStarted.current || !globalPrefs.loaded || tourSeen || !user || !currentProject) return
    tourAutoStarted.current = true
    globalPrefs.patch({ v: 1, tourDoneV1: true })
    const t = window.setTimeout(() => startTour(), 900)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalPrefs.loaded, tourSeen, user, currentProject])

  // Re-selecting the SAME list must not wipe the filters: coming back from the
  // inbox remounts the board and the sidebar restores the last list, which used
  // to clear the filters that had just been read back from prefs.
  const selectedIdRef = useRef<string | null>(null)
  const handleSelectProject = useCallback((project: Project, team: Team, opts?: { explicit?: boolean }) => {
    // Picking a list while a page is open goes back to the board. The sidebar's
    // silent restore on load is not a pick: it must not close a page opened by URL.
    // The same for the personal views (/me/…, #670FC51B): a list picked from the
    // tree while "Görevlerim" is open must show the board, not stay on the view.
    // Yönetim de aynı kuralda (#7AB2D9F6): panelden bir liste seçilince yönetim
    // ekranı yerinde kalmamalı, seçilen listenin panosu açılmalı.
    // Açık görev penceresi de öyle (#849dd4b8): tam ekran görünüm yerinde kalınca
    // seçilen liste onun *altında* açılıyor, pencere kapatılana kadar görünmüyordu.
    if (opts?.explicit && (pageIdRef.current || meViewRef.current || adminRef.current || ticketIdRef.current)) go(navigate, '/')
    const changed = selectedIdRef.current !== project.id
    selectedIdRef.current = project.id
    setCurrentProject(project)
    setCurrentTeam(team)
    if (changed) {
      setFiltersState({})            // a different list starts clean…
      prefsAppliedFor.current = null // …until its own saved view/filters load
    }
    globalPrefs.patch({ v: 1, lastProjectId: project.id, lastTeamId: team.id })
    noteRecent('project', project.id)
    setSidebarOpen(false)
    if (opts?.explicit) setInboxOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Yönetim açılınca odak ana alana geçsin: seçim listede kalmasın, klavye ve
  // ekran okuyucu da yeni ekranda başlasın.
  useEffect(() => {
    if (!adminTab) return
    const el = document.getElementById('main')
    el?.focus({ preventScroll: true })
  }, [adminTab])

  const clearSelection = () => {
    selectedIdRef.current = null
    setCurrentProject(null)
    setCurrentTeam(null)
    globalPrefs.patch({ lastProjectId: null, lastTeamId: null })
  }

  const isLoading = ticketsLoading || statusesLoading

  if (sysSettings?.maintenance?.on && !isAdmin) return <MaintenanceScreen message={sysSettings.maintenance.message} />

  const lang = useLang()
  useEffect(() => onShortcut('search', () => searchRef.current()), [])
  // Command palette (#43a865fb): what can be run from the top bar, for this screen.
  const listOpen = !!currentProject && !pageId && !meView && !adminTab
  const openProjectById = async (id: string) => {
    const { data } = await supabase.from('projects').select('*').eq('id', id).maybeSingle()
    const proj = data as Project | null
    const tm = proj ? myTeams.find((x) => x.id === proj.team_id) : null
    if (proj && tm) handleSelectProject(proj, tm, { explicit: true })
  }

  // Paylaşılan liste adresi (#d46f6d70): `/list/<id>` açılınca o liste seçilir,
  // istenirse görünüm de kurulur, sonra adres `/`'a düşer — liste seçimi
  // tercihte yaşıyor, adres çubuğu ikinci bir gerçek kaynağı olmasın.
  // "Bu listeyi aç" (`goList`, #a7d43aaf): liste seçilir ve pano ekranına dönülür;
  // dönüş `handleSelectProject`'in işi (geçmişte pano varsa oraya geri gider).
  const openByIdRef = useRef(openProjectById); openByIdRef.current = openProjectById
  useEffect(() => onOpenList((id) => { void openByIdRef.current(id) }), [])
  const openedListParam = useRef<string | null>(null)
  useEffect(() => {
    if (!listId || openedListParam.current === listId || !myTeams.length) return
    openedListParam.current = listId
    const wanted = new URLSearchParams(window.location.search).get('view')
    void (async () => {
      if (wanted === 'board' || wanted === 'list') wantedView.current = { listId, view: wanted }
      await openProjectById(listId)
      // Liste zaten açıksa tercih yeniden uygulanmaz; o durumda doğrudan yazılır.
      if ((wanted === 'board' || wanted === 'list') && prefsAppliedFor.current === listId) { wantedView.current = null; setView(wanted) }
      navigate('/', { replace: true })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, myTeams.length])
  /** Üst çubuktan yapılan gezinme açık görev penceresini kapatır: ekranın
   *  geri kalanı pencerenin altında kalıyordu (#849dd4b8). */
  const leaveTicket = () => { if (ticketIdRef.current) closeOverlay(navigate) }
  const goHome = () => { leaveTicket(); openRailPanel('home'); setSidebarOpen(true); setInboxOpen(false) }
  // "/" and the palette's "search this list": the palette, narrowed to the open list (#9ab8db99).
  const searchThisList = () => openPalette(listOpen && currentProject ? listFilter(currentProject.name, lang) : '')
  const searchRef = useRef(searchThisList); searchRef.current = searchThisList
  const editCurrentList = () => { if (currentTeam && currentProject) setListModal({ team: currentTeam, list: currentProject }) }
  const goTeams = () => { leaveTicket(); openRailPanel('teams'); setSidebarOpen(true); setInboxOpen(false) }
  const newPageHere = () => { if (currentTeam && perms.canWrite) void openNewPage(currentTeam.id, listOpen && currentProject ? { kind: 'list', id: currentProject.id } : { kind: 'team' }) }
  const toggleInbox = () => {
    if (!window.matchMedia('(min-width: 768px)').matches) { go(navigate, '/inbox'); return }
    if (inboxOpen) { setInboxOpen(false); setInboxTarget(null) } else { leaveTicket(); setInboxOpen(true) }
  }
  shortcutRuns.current = {
    'theme-toggle': () => setThemeMode(document.documentElement.classList.contains('dark') ? 'light' : 'dark'),
    'whats-new': () => setShowWhatsNew(true),
    inbox: toggleInbox,
    home: goHome,
    teams: goTeams,
    admin: () => { if (isAdmin) go(navigate, '/admin') },
    'my-tasks': () => go(navigate, '/me/tasks'),
    recents: () => go(navigate, '/me/recents'),
    'new-page': newPageHere,
    'list-settings': () => { if (listOpen && perms.canWrite) editCurrentList() },
  }
  const commands: PaletteCommand[] = [
    ...(listOpen && perms.canWrite ? [{ id: 'new-ticket', label: tr('board.cmd.newTicket'), keywords: 'new task ticket gorev ekle olustur', shortcut: 'new-ticket' as const, run: () => void handleNewTicket() }] : []),
    // Çizim / whiteboard (096, beta): açık listenin altına, liste yoksa takım köküne.
    ...(currentTeam && perms.canWrite ? beta.kinds.map((k) => ({
      id: `new-${k}`,
      label: tr(k === 'drawing' ? 'canvas.cmd.newDrawing' : 'canvas.cmd.newWhiteboard'),
      keywords: k === 'drawing' ? 'new drawing cizim excalidraw diagram diyagram sema' : 'new whiteboard beyaz tahta pano teams',
      run: () => void openNewPage(currentTeam.id, listOpen && currentProject ? { kind: 'list', id: currentProject.id } : { kind: 'team' }, k),
    })) : []),
    ...(currentTeam && perms.canWrite ? [{ id: 'new-page', label: tr('settings.shortcut.newPage'), keywords: 'new page sayfa ekle olustur yeni', shortcut: 'new-page' as const, run: newPageHere }] : []),
    { id: 'inbox', label: tr('board.cmd.inbox'), keywords: 'inbox bildirim notifications', shortcut: 'inbox' as const, run: () => { leaveTicket(); setInboxOpen(true) } },
    { id: 'home', label: tr('board.cmd.home'), keywords: 'home ana sayfa', shortcut: 'home' as const, run: goHome },
    { id: 'teams', label: tr('settings.shortcut.teams'), keywords: 'teams takimlar agac tree panel', shortcut: 'teams' as const, run: goTeams },
    { id: 'my-tasks', label: tr('board.cmd.myTasks'), keywords: 'my tasks bana atanan', shortcut: 'my-tasks' as const, run: () => go(navigate, '/me/tasks') },
    { id: 'recents', label: tr('board.cmd.recents'), keywords: 'recent son', shortcut: 'recents' as const, run: () => go(navigate, '/me/recents') },
    { id: 'agents', label: tr('board.cmd.agents'), keywords: 'agent ajan claude yapay zeka ai panel calistirma run olcum metrik token', run: () => go(navigate, '/me/agents') },
    ...(listOpen ? [
      { id: 'view-board', label: tr('board.cmd.board'), keywords: 'kanban board pano', shortcut: 'board' as const, run: () => { leaveTicket(); setView('board') } },
      { id: 'view-list', label: tr('board.cmd.list'), keywords: 'list liste tablo', shortcut: 'list' as const, run: () => { leaveTicket(); setView('list') } },
      { id: 'filter', label: tr('board.cmd.filter'), keywords: 'filter filtre', shortcut: 'filter' as const, run: () => { leaveTicket(); window.setTimeout(() => emitShortcut('filter'), 0) } },
      { id: 'search', label: tr('board.cmd.search'), keywords: 'search ara bul', shortcut: 'search' as const, run: () => { window.setTimeout(() => searchThisList(), 0) } },
      ...(perms.canWrite && currentTeam ? [{ id: 'list-settings', label: tr(perms.canManage ? 'board.cmd.listSettings' : 'board.cmd.listStatuses'), keywords: 'durumlar statuses sutun column liste ayar settings duzenle edit klasor folder renk', shortcut: 'list-settings' as const, run: () => editCurrentList() }] : []),
    ] : []),
    { id: 'settings-profile', label: tr('board.cmd.settingsProfile'), keywords: 'settings ayarlar profil profile', shortcut: 'settings' as const, run: () => setSettingsTab('profile') },
    { id: 'settings-notifications', label: tr('board.cmd.settingsNotifications'), keywords: 'settings notifications bildirim telegram', shortcut: 'notifications' as const, run: () => setSettingsTab('notifications') },
    { id: 'settings-theme', label: tr('board.cmd.settingsTheme'), keywords: 'settings theme tema renk palet palette koyu dark', shortcut: 'theme' as const, run: () => setSettingsTab('theme') },
    { id: 'settings-appearance', label: tr('board.cmd.settingsAppearance'), keywords: 'settings appearance gorunum ikon icon simge yazi boyutu font yogunluk density konfeti kutlama gorev penceresi satir numarasi', run: () => setSettingsTab('appearance') },
    { id: 'settings-beta', label: tr('board.cmd.settingsBeta'), keywords: 'settings beta deneme cizim drawing whiteboard kabuk shell', run: () => setSettingsTab('beta') },
    { id: 'settings-language', label: tr('board.cmd.settingsLanguage'), keywords: 'settings language dil english deutsch', run: () => setSettingsTab('language') },
    { id: 'settings-agent', label: tr('board.cmd.settingsAgent'), keywords: 'claude ajan agent yapay zeka ai bagla baglan connect anahtar key kurulum setup', run: () => setSettingsTab('agent') },
    { id: 'settings-shortcuts', label: tr('settings.shortcut.shortcuts'), keywords: 'settings shortcuts kisayol klavye keyboard tus', shortcut: 'shortcuts' as const, run: () => setShowShortcuts(true) },
    { id: 'theme-toggle', label: tr('settings.shortcut.themeToggle'), keywords: 'theme dark light tema koyu acik', shortcut: 'theme-toggle' as const, run: () => shortcutRuns.current['theme-toggle']?.() },
    { id: 'theme-light', label: tr('board.cmd.themeLight'), keywords: 'theme light acik aydinlik', run: () => setThemeMode('light') },
    { id: 'theme-dark', label: tr('board.cmd.themeDark'), keywords: 'theme dark koyu karanlik', run: () => setThemeMode('dark') },
    { id: 'theme-auto', label: tr('board.cmd.themeAuto'), keywords: 'theme auto system otomatik sistem', run: () => setThemeMode('auto') },
    // Görev açıkken görev penceresi bölümüyle başlar (#ab88c8f5).
    { id: 'tour', label: tr('settings.menu.tour'), keywords: 'tour guide tanitim turu rehber yardim help', run: () => startTour() },
    { id: 'whats-new', label: tr('board.cmd.whatsNew'), keywords: 'changelog yenilikler surum notlari release', shortcut: 'whats-new' as const, run: () => setShowWhatsNew(true) },
    { id: 'create-team', label: tr('board.cmd.createTeam'), keywords: 'team takim yeni new', run: () => setShowCreateTeam(true) },
    { id: 'join-team', label: tr('board.cmd.joinTeam'), keywords: 'team takim join katil kod code', run: () => setShowJoinTeam(true) },
    ...(isAdmin ? [{ id: 'admin', label: tr('board.cmd.admin'), keywords: 'admin yonetim sunucu server', shortcut: 'admin' as const, run: () => go(navigate, '/admin') }] : []),
    { id: 'sign-out', label: tr('board.cmd.signOut'), keywords: 'sign out logout cikis', run: () => void signOut() },
  ]

  // Ağaç işlemleri: kenar çubuğu prop olarak, konum çubuklarının sağ tık menüsü
  // bağlamdan alır (#c675e160) — iki menü aynı yollardan geçsin.
  const treeActions: TreeActions = {
    createList: (team, folderId) => { setListModal({ team, folderId }); setSidebarOpen(false) },
    editList: (team, list) => { setListModal({ team, list }); setSidebarOpen(false) },
    createFolder: (team, parentId) => { setFolderModal({ team, parentId }); setSidebarOpen(false) },
    editFolder: (team, folder) => { setFolderModal({ team, folder }); setSidebarOpen(false) },
    openSettings: (team, tab) => { setSettingsTeamTab(tab); setSettingsTeam(team); setSidebarOpen(false) },
    projectDeleted: (projectId) => { if (currentProject?.id === projectId) clearSelection() },
    createPage: (team, parent, kind) => { void openNewPage(team.id, parent, kind); setSidebarOpen(false) },
  }

  return (
    <TreeActionsContext.Provider value={treeActions}>
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-app">
      {/* İlk Tab durağı: klavye kullanıcısı üst çubuğu ve kenar çubuğunu atlar. DOM'da
          en başta olmalı — içerik sütununun içindeyken üst çubuk, şerit ve bütün
          ağaçtan *sonra* geliyordu, yani atlatması gereken her şeyden sonra (#990dfec5). */}
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[10000] focus:px-3 focus:py-2 focus:rounded-lg focus:bg-primary-600 focus:text-white focus:text-sm focus:font-semibold">{tr('board.skipToContent')}</a>
      <TopBar
        onHome={goHome}
        profile={currentUserProfile}
        onOpenSettings={(tab) => setSettingsTab(tab)}
        onShowWhatsNew={() => setShowWhatsNew(true)}
        commands={commands}
        teams={myTeams}
        onOpenTicket={(id) => { setInboxOpen(false); openTicket(navigate, id) }}
        onOpenPage={(id) => { setInboxOpen(false); go(navigate, `/page/${id}`) }}
        onOpenProject={(id) => { setInboxOpen(false); void openProjectById(id) }}
        onOpenTeam={(id) => { setInboxOpen(false); leaveTicket(); openRailPanel('teams', id); setSidebarOpen(true) }}
      />
      {/* Bağlantı bandı üst çubuğun hemen altında, tam genişlikte ve akışta:
          ekranın geri kalanını aşağı itiyor, hiçbir şeyin üstünü örtmüyor
          (kullanıcı, 28 Eyl). Kenar çubuğu da bandın altından başlıyor. */}
      <ConnectionBanner />
      {/* Yumuşak kabukta (beta, #1aae9955) oluk kabuk grisidir, içerik yaprağı onun içinde yüzer. */}
      <div data-shell-gutter className="flex-1 min-h-0 flex overflow-hidden">
      <Sidebar
        // Yönetim ekranı listenin *yerine* açılıyor: seçili liste vurgusu da kalkar
        // (kullanıcı raporu: "üzerine açılan bir şey değil, yerine açılan bir ekran").
        selectedProjectId={adminTab ? null : currentProject?.id ?? null}
        // Adreste liste varken son liste geri yüklenmez (#b60bbcf6): ikisi de listeyi
        // sunucudan ayrı ayrı çekiyordu, geç dönen kazanıyordu — paylaşılan bağlantı
        // ara sıra önceki listeyi açıyordu. Bağlantının listesi seçilince adres `/`'a
        // düşer; o anda seçim dolu olduğu için geri yükleme yine çalışmaz.
        restoreProjectId={listId ? null : (globalPrefs.prefs as { lastProjectId?: string }).lastProjectId ?? null}
        onSelectProject={handleSelectProject}
        onCreateTeam={() => { setShowCreateTeam(true); setSidebarOpen(false) }}
        onJoinTeam={() => { setShowJoinTeam(true); setSidebarOpen(false) }}
        onShowChangelog={() => { setShowWhatsNew(true); setSidebarOpen(false) }}
        onCreateList={treeActions.createList}
        onEditList={treeActions.editList}
        onCreateFolder={treeActions.createFolder}
        onEditFolder={treeActions.editFolder}
        onOpenSettings={treeActions.openSettings}
        onProjectDeleted={treeActions.projectDeleted}
        activePageId={pageId ?? null}
        onOpenPage={(id) => { go(navigate, `/page/${id}`); setSidebarOpen(false); setInboxOpen(false) }}
        onToggleInbox={() => setInboxOpen((o) => !o)}
        inboxOpen={inboxOpen}
        onCreatePage={treeActions.createPage}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div data-shell-sheet className="relative flex-1 flex flex-col overflow-hidden">
        {inboxOpen && <Suspense fallback={null}><InboxDrawer focus={inboxTarget} onClose={closeInbox} onOpenTicket={(id) => { closeInbox(); openTicket(navigate, id) }} onShowChangelog={() => { closeInbox(); setShowWhatsNew(true) }} /></Suspense>}
        {/* Yönetim ekranında bağlam çubuğu yalnız "Yönetim" yazıyordu ve sekme
            zaten şeritte seçili (kullanıcı isteği, #7ab2d9f3); sayfa görünümüyle
            aynı kural: masaüstünde çubuk yok, telefonda hamburger için kalıyor. */}
        <Header
          onMenuToggle={() => setSidebarOpen(prev => !prev)}
          project={pageId || meView || adminTab ? null : currentProject}
          team={meView || adminTab ? null : currentTeam}
          contextLabel={meView === 'recents' ? tr('me.recents.title') : meView === 'agents' ? tr('me.agents.title') : meView ? tr('me.tasks.title') : undefined}
          bare={!!pageId || !!adminTab}
          filters={filters}
          onFiltersChange={setFilters}
          statuses={statuses}
          onTeam={currentTeam ? () => { setInboxOpen(false); openRailPanel('teams', currentTeam.id); setSidebarOpen(true) } : undefined}
          onEditList={perms.canWrite ? editCurrentList : undefined}
          editListLabel={tr(perms.canManage ? 'board.header.editList' : 'board.header.editStatuses')}
          views={currentProject && !adminTab ? (
            // Pano · Liste · saved views (#9ab8db99, in the header row).
            <ViewBar
              saved={savedViews}
              canShare={!!currentTeam && perms.canWrite}
              canManageTeam={perms.canManage}
              builtins={[
                { key: 'board', label: tr('board.header.kanban'), active: view === 'board' && !savedViews.active, onSelect: () => { savedViews.select(null); setView('board') } },
                { key: 'list', label: tr('board.header.list'), active: view === 'list' && !savedViews.active, onSelect: () => { savedViews.select(null); setView('list') } },
              ]}
            />
          ) : undefined}
        />

        <AnnouncementBanner />
        <ServerDiskBanner />
        <PendingInvitationsBanner />

        <main id="main" tabIndex={-1} className="relative flex-1 overflow-hidden px-5 py-4 outline-none">
          {/* List background (migration 043). A veil keeps cards and text readable
              on top of it, and follows the theme. */}
          {!pageId && !meView && !adminTab && currentProject?.background_url && (
            <>
              <div
                aria-hidden
                className="absolute inset-0 bg-cover bg-center pointer-events-none"
                style={{ backgroundImage: `url(${currentProject.background_url})` }}
              />
              <div aria-hidden className="absolute inset-0 pointer-events-none bg-app/75 dark:bg-app/80" />
            </>
          )}
          <div className="relative h-full">
          {adminTab ? (
            <Suspense fallback={null}><AdminView tab={adminTab} /></Suspense>
          ) : meView ? (
            <Suspense fallback={<AreaLoading />}>
              {meView === 'recents'
                ? <RecentsView onOpenProject={(id) => void openProjectById(id)} />
                : meView === 'agents'
                  ? <AgentPanel agentId={new URLSearchParams(location.search).get('agent')} onClearAgent={() => go(navigate, '/me/agents')} teamId={new URLSearchParams(location.search).get('team')} onClearTeam={() => go(navigate, '/me/agents')} />
                  : <MyTasksView />}
            </Suspense>
          ) : pageId ? (
            <div className="-mx-5 -my-4 h-[calc(100%+2rem)]">
              <Suspense fallback={<AreaLoading />}>
              <PageScreen
                key={pageId}
                pageId={pageId}
                onOpenList={(list) => {
                  const team = myTeams.find((x) => x.id === list.team_id)
                  if (team) handleSelectProject(list, team, { explicit: true })
                }}
                onCreatePage={(teamId, parent, kind) => void openNewPage(teamId, parent, kind)}
              />
              </Suspense>
            </div>
          ) : !currentProject ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <div className="text-center px-6">
                <div className="w-16 h-16 rounded-xl bg-primary-50 dark:bg-primary-950/30 flex items-center justify-center mx-auto mb-4">
                  <Icon name="text" size={32} className="text-primary-500" />
                </div>
                <p className="text-fg-2 text-sm font-medium mb-1">{tr('board.noList.title')}</p>
                <p className="text-fg-faint text-xs mb-5">{tr('board.noList.hint')}</p>
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="md:hidden inline-flex items-center gap-2 bg-primary-600 text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors shadow-sm"
                >
                  <Icon name="menu" />
                  {tr('board.noList.cta')}
                </button>
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary-600 border-t-transparent" />
            </div>
          ) : (
            <>
              <div className="h-full flex flex-col gap-3">
              <div className="flex-1 min-h-0">
              {view === 'board' ? (
                <KanbanBoard tickets={visibleTickets} statuses={statuses} projectId={currentProject.id} perms={perms} teamId={currentTeam?.id ?? null} filters={filters} totals={statusTotals} onFiltersChange={setFilters} />
              ) : (
                <Suspense fallback={<AreaLoading />}>
                <TicketListView
                  source={{ kind: 'project', projectId: currentProject.id, teamId: currentTeam?.id ?? null, tickets: listTickets, isLoading: false, canWrite: perms.canWrite, statuses }}
                  config={listView.config}
                  onConfigChange={listView.setConfig}
                  filters={filters}
                  onFiltersChange={setFilters}
                  defaultConfig={BOARD_LIST_VIEW}
                />
                </Suspense>
              )}
              </div>
              </div>
            </>
          )}
          </div>
        </main>
      </div>
      </div>

      {ticketId && (
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-black/20 dark:bg-black/40"><AreaLoading /></div>}>
          <TicketModal projectId={currentProject?.id ?? null} />
        </Suspense>
      )}

      {showCreateTeam && <CreateTeamModal onClose={() => setShowCreateTeam(false)} />}
      {showJoinTeam && <JoinTeamModal onClose={() => setShowJoinTeam(false)} />}
      {settingsTeam && (
        <Suspense fallback={null}>
        <TeamSettingsModal
          team={settingsTeam}
          initialTab={settingsTeamTab}
          onClose={() => setSettingsTeam(null)}
          onDeleted={() => { if (currentTeam?.id === settingsTeam.id) clearSelection() }}
        />
        </Suspense>
      )}
      {listModal && (
        <Suspense fallback={null}>
        <ListModal
          team={listModal.team}
          list={listModal.list ?? null}
          defaultFolderId={listModal.folderId ?? null}
          onClose={() => setListModal(null)}
          onCreated={(list) => handleSelectProject(list, listModal.team)}
        />
        </Suspense>
      )}
      {folderModal && (
        <FolderModal
          team={folderModal.team}
          folder={folderModal.folder ?? null}
          parentId={folderModal.parentId ?? null}
          canManage
          onClose={() => setFolderModal(null)}
        />
      )}

      {showWhatsNew && <Suspense fallback={null}><ChangelogModal onClose={handleCloseWhatsNew} /></Suspense>}
      {showShortcuts && <Suspense fallback={null}><ShortcutsDialog onClose={() => setShowShortcuts(false)} onEdit={() => { setShowShortcuts(false); setSettingsTab('shortcuts') }} /></Suspense>}
      {settingsTab && (
        <Suspense fallback={null}>
        <SettingsModal
          tab={settingsTab}
          onTabChange={setSettingsTab}
          onClose={() => setSettingsTab(null)}
          onProfileUpdated={(profile) => setCurrentUserProfile(profile)}
        />
        </Suspense>
      )}
      <TaskTray hidden={!!ticketId} />
      <NotificationHost />
      <ShortcutLayer />
      <AppTour />
    </div>
    </TreeActionsContext.Provider>
  )
}

// ── prefs helpers ──────────────────────────────────────────────────────────
const FILTER_KEYS = ['status_id', 'priority', 'assignee_ids', 'tag_ids', 'due', 'show_closed', 'show_children', 'show_backlog'] as const
/** Keys where `false` is a real choice (not "unset") and must survive the round trip. */
const FALSE_IS_MEANINGFUL = new Set<string>(['show_backlog'])
/** Full filter object with explicit nulls for cleared keys (server deletes null keys; unknown keys from newer builds survive). */
function filtersPatch(f: TicketFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of FILTER_KEYS) {
    const v = (f as Record<string, unknown>)[k]
    const cleared = v === undefined || (Array.isArray(v) && v.length === 0) || (v === false && !FALSE_IS_MEANINGFUL.has(k))
    out[k] = cleared ? null : v
  }
  return out
}
/** Keep only known, well-typed filter keys from stored prefs (ids are validated lazily by the UI). */
function sanitizeFilters(p: TicketFilters | undefined): TicketFilters {
  if (!p || typeof p !== 'object') return {}
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : undefined)
  const f: TicketFilters = {}
  const st = arr(p.status_id); if (st?.length) f.status_id = st
  const pr = arr(p.priority); if (pr?.length) f.priority = pr as TicketFilters['priority']
  const as = arr(p.assignee_ids); if (as?.length) f.assignee_ids = as
  const tg = arr(p.tag_ids); if (tg?.length) f.tag_ids = tg
  const du = arr(p.due); if (du?.length) f.due = du as TicketFilters['due']
  if (p.show_closed === true) f.show_closed = true
  if (p.show_children === true) f.show_children = true
  if (p.show_backlog === false) f.show_backlog = false
  return f
}
