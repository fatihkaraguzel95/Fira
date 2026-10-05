/**
 * Ağaç satırlarının menüleri tek yerde (#c675e160). Soldaki ağacın takım,
 * klasör, liste ve sayfa satırları ile konum çubukları (liste başlığı, görev
 * penceresi, sayfa) öğelerini buradan alır; biri değişince öteki geride kalmaz.
 * Menüye öğe eklerken buradaki kurucuya ekle, satıra ayrı dizi yazma.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import { go, goList } from '../../lib/nav'
import { useLocation, useNavigate } from 'react-router-dom'
import { isCanvasKind, type CanvasKind, type Page, type PageKind, type PageParent, type Project, type Team, type TeamFolder } from '../../types'
import type { TeamSettingsTab } from '../team/TeamSettingsModal'
import { t } from '../../i18n'
import { MenuIcons, MenuPopover, type MenuPos, type RowMenuItem } from '../ui/RowMenu'
import { DrawingIcon, WhiteboardIcon } from '../page/canvasIcons'
import { ConfirmDeleteModal } from './ConfirmDeleteModal'
import { readHomePrefs } from './homePrefs'
import { copyLink, listUrl, pageUrl } from '../../lib/shareLink'
import { useIsFavorite, useToggleFavorite } from '../../lib/favorites'
import { revealInTree } from '../../lib/revealTree'
import { folderChain } from '../../lib/folders'
import { emitError } from '../../lib/errorToast'
import { useImportLock } from '../../lib/importJob'
import { useAuth } from '../../hooks/useAuth'
import { useBeta } from '../../hooks/useBeta'
import { usePrefs } from '../../hooks/usePrefs'
import { permissionsFor, useMyTeams } from '../../hooks/useTeams'
import { useDeleteProject, useProjects } from '../../hooks/useProjects'
import { useDeleteFolder, useDeleteFolderDeep, useFolders } from '../../hooks/useFolders'
import { descendantCount, useTeamPages, useTrashPage } from '../../hooks/usePages'

const canvasIcon = (k: CanvasKind) => (k === 'drawing' ? <DrawingIcon /> : <WhiteboardIcon />)

// ─── Menü kurucuları ─────────────────────────────────────────────────────────

export function teamMenuItems(o: {
  /** Oluşturma öğeleri için: OneNote aktarımı sürerken kapalı (#684A9085). */
  edit: { canManage: boolean; canWrite: boolean }
  /** OneNote ve silme için kilitsiz yetki. */
  perms: { canManage: boolean; isOwner: boolean }
  canvasKinds: CanvasKind[]
  /** Takımda klasör, liste ya da sayfa var (tümünü aç/kapat anlamlı). */
  hasContent: boolean
  onHome: boolean
}, h: {
  newList: () => void
  newFolder: () => void
  newPage: (kind?: CanvasKind) => void
  expandAll: () => void
  collapseAll: () => void
  toggleHome: () => void
  openSettings: (tab: TeamSettingsTab) => void
  /** The agent panel, narrowed to this team (#90e67e48). */
  openAgents: () => void
}): RowMenuItem[] {
  return [
    ...(o.edit.canManage ? [
      { key: 'list', label: t('board.sidebar.newList'), icon: MenuIcons.list, onSelect: h.newList },
      { key: 'folder', label: t('board.sidebar.newFolder'), icon: MenuIcons.folder, onSelect: h.newFolder },
    ] : []),
    ...(o.edit.canWrite ? [{ key: 'page', label: t('page.newInTeam'), icon: MenuIcons.page, onSelect: () => h.newPage() }] : []),
    ...(o.edit.canWrite ? o.canvasKinds.map((k) => ({ key: `canvas-${k}`, label: t(`canvas.newIn.team.${k}`), icon: canvasIcon(k), onSelect: () => h.newPage(k) })) : []),
    ...(o.hasContent ? [
      { key: 'expand', label: t('board.tree.expandAll'), icon: MenuIcons.expand, onSelect: h.expandAll, separated: o.edit.canWrite || o.edit.canManage },
      { key: 'collapse', label: t('board.tree.collapseAll'), icon: MenuIcons.collapse, onSelect: h.collapseAll },
    ] : []),
    { key: 'home', label: o.onHome ? t('board.menu.removeHome') : t('board.menu.addHome'), icon: MenuIcons.home, onSelect: h.toggleHome, separated: true },
    { key: 'members', label: t('board.menu.members'), icon: MenuIcons.members, onSelect: () => h.openSettings('members'), separated: true },
    { key: 'agents', label: t('board.cmd.agents'), icon: MenuIcons.agent, onSelect: h.openAgents },
    { key: 'trash', label: t('page.trash.tab'), icon: MenuIcons.trash, onSelect: () => h.openSettings('trash') },
    ...(o.perms.canManage ? [{ key: 'onenote', label: t('board.menu.onenote'), icon: MenuIcons.import, onSelect: () => h.openSettings('onenote') }] : []),
    { key: 'settings', label: t('board.menu.teamSettings'), icon: MenuIcons.settings, onSelect: () => h.openSettings('general') },
    ...(o.perms.isOwner ? [{ key: 'delete', label: t('board.menu.deleteTeam'), icon: MenuIcons.trash, onSelect: () => h.openSettings('general'), danger: true, separated: true }] : []),
  ]
}

export function folderMenuItems(o: { canManage: boolean; canWrite: boolean; canvasKinds: CanvasKind[]; hasChildren: boolean }, h: {
  newList: () => void
  newPage: (kind?: CanvasKind) => void
  newFolder: () => void
  expandAll: () => void
  collapseAll: () => void
  edit: () => void
  remove: () => void
  removeDeep: () => void
}): RowMenuItem[] {
  return [
    ...(o.canManage ? [{ key: 'list', label: t('board.tree.addListToFolder'), icon: MenuIcons.list, onSelect: h.newList }] : []),
    ...(o.canWrite ? [{ key: 'page', label: t('page.newInFolder'), icon: MenuIcons.page, onSelect: () => h.newPage() }] : []),
    ...(o.canWrite ? o.canvasKinds.map((k) => ({ key: `canvas-${k}`, label: t(`canvas.newIn.folder.${k}`), icon: canvasIcon(k), onSelect: () => h.newPage(k) })) : []),
    ...(o.canManage ? [{ key: 'folder', label: t('board.tree.addSubfolder'), icon: MenuIcons.folder, onSelect: h.newFolder }] : []),
    // Derin bir ağaçta dalları tek tek açmak yorucu (#1F44279C).
    ...(o.hasChildren ? [
      { key: 'expand', label: t('board.tree.expandAll'), icon: MenuIcons.expand, onSelect: h.expandAll, separated: true },
      { key: 'collapse', label: t('board.tree.collapseAll'), icon: MenuIcons.collapse, onSelect: h.collapseAll },
    ] : []),
    ...(o.canManage ? [
      { key: 'edit', label: t('board.editFolder'), icon: MenuIcons.edit, onSelect: h.edit, separated: true },
      { key: 'delete', label: t('board.tree.deleteFolderHint'), icon: MenuIcons.trash, onSelect: h.remove, danger: true },
      { key: 'deleteDeep', label: t('board.tree.deleteFolderDeep'), icon: MenuIcons.trash, onSelect: h.removeDeep, danger: true },
    ] : []),
  ]
}

export function listMenuItems(o: { list: Project; isFav: boolean; canManage: boolean; canWrite: boolean; canvasKinds: CanvasKind[] }, h: {
  open: () => void
  toggleFav: () => void
  newPage: (kind?: CanvasKind) => void
  edit: () => void
  remove: () => void
}): RowMenuItem[] {
  return [
    { key: 'open', label: t('common.open'), icon: MenuIcons.open, onSelect: h.open },
    { key: 'fav', label: o.isFav ? t('board.fav.remove') : t('board.fav.add'), icon: MenuIcons.star, onSelect: h.toggleFav },
    // Bağlantı olarak kopyala (#d46f6d70): liste, sayfa ve görev satırlarının hepsinde aynı seçenek.
    { key: 'link', label: t('common.copyLink'), icon: MenuIcons.link, onSelect: () => void copyLink(listUrl(o.list.id), o.list.name) },
    ...(o.canWrite ? [{ key: 'page', label: t('page.newInList'), icon: MenuIcons.page, onSelect: () => h.newPage() }] : []),
    ...(o.canWrite ? o.canvasKinds.map((k) => ({ key: `canvas-${k}`, label: t(`canvas.newIn.list.${k}`), icon: canvasIcon(k), onSelect: () => h.newPage(k) })) : []),
    // Durumlar liste penceresinde (#9ab8db99); listeyi düzenleyemeyen yazar yalnız o bölümü görür.
    ...(o.canWrite && !o.canManage ? [{ key: 'statuses', label: t('board.status.manager'), icon: MenuIcons.edit, onSelect: h.edit, separated: true }] : []),
    ...(o.canManage ? [
      { key: 'edit', label: t('board.editList'), icon: MenuIcons.edit, onSelect: h.edit, separated: true },
      { key: 'delete', label: t('board.deleteList'), icon: MenuIcons.trash, onSelect: h.remove, danger: true, separated: true },
    ] : []),
  ]
}

export function pageMenuItems(o: { page: Page; title: string; isFav: boolean; canWrite: boolean; canTrash: boolean; descendants: number; canvasKinds: CanvasKind[] }, h: {
  open: () => void
  toggleFav: () => void
  newPage: (kind?: CanvasKind) => void
  trash: () => void
}): RowMenuItem[] {
  // Çizim ve whiteboard yapraktır (096): altına bir şey eklenmez.
  const leaf = isCanvasKind(o.page.kind)
  return [
    { key: 'open', label: t('common.open'), icon: MenuIcons.open, onSelect: h.open },
    { key: 'fav', label: o.isFav ? t('board.fav.remove') : t('board.fav.add'), icon: MenuIcons.star, onSelect: h.toggleFav },
    { key: 'link', label: t('common.copyLink'), icon: MenuIcons.link, onSelect: () => void copyLink(pageUrl(o.page.id), o.title) },
    ...(o.canWrite && !leaf ? [{ key: 'sub', label: t('page.newInPage'), icon: MenuIcons.page, onSelect: () => h.newPage() }] : []),
    ...(o.canWrite && !leaf ? o.canvasKinds.map((k) => ({ key: `sub-${k}`, label: t(`canvas.newIn.page.${k}`), icon: canvasIcon(k), onSelect: () => h.newPage(k) })) : []),
    // 60 gün geri alınabilir (Takım ayarları › Çöp kutusu), onay adımı yok.
    ...(o.canTrash ? [{ key: 'trash', label: o.descendants ? t('page.trash.moveWithChildren', { n: o.descendants }) : t('page.trash.move'), icon: MenuIcons.trash, onSelect: h.trash, danger: true, separated: true }] : []),
  ]
}

/** Bir klasörün dalı: kendisi ve alt klasörleri, içlerindeki listeler ve sayfalar (derin silme onayı, tümünü aç/kapat). */
export function folderBranch(rootId: string, folders: TeamFolder[], lists: Project[], pages: Page[]) {
  const ids = new Set<string>([rootId])
  for (let grew = true; grew;) {
    grew = false
    for (const f of folders) if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) { ids.add(f.id); grew = true }
  }
  const inLists = lists.filter((l) => l.folder_id && ids.has(l.folder_id))
  const listIds = new Set(inLists.map((l) => l.id))
  const holder = (pg: Page): Page => {
    let cur = pg
    for (let i = 0; i < 60 && cur.parent_page_id; i++) { const up = pages.find((x) => x.id === cur.parent_page_id); if (!up) break; cur = up }
    return cur
  }
  const inPages = pages.filter((pg) => { const h = holder(pg); return !!(h.folder_id && ids.has(h.folder_id)) || !!(h.project_id && listIds.has(h.project_id)) })
  return { folderIds: ids, lists: inLists, pages: inPages }
}

// ─── Konum çubuklarının menüsü ───────────────────────────────────────────────

/** BoardPage'in ağaç işlemleri (kenar çubuğuna prop olarak verdiklerinin aynısı). */
export interface TreeActions {
  createList: (team: Team, folderId: string | null) => void
  editList: (team: Team, list: Project) => void
  createFolder: (team: Team, parentId?: string | null) => void
  editFolder: (team: Team, folder: TeamFolder) => void
  openSettings: (team: Team, tab?: TeamSettingsTab) => void
  projectDeleted: (projectId: string) => void
  createPage: (team: Team, parent: PageParent, kind?: PageKind) => void
}

export const TreeActionsContext = createContext<TreeActions | null>(null)

export type CrumbNode =
  | { kind: 'team'; teamId: string }
  | { kind: 'folder' | 'list' | 'page'; teamId: string; id: string }

/**
 * Konum çubuğunun bir parçası (#c675e160): sağ tık ya da menü tuşu, soldaki
 * ağaçta aynı satırın menüsünü açar. Sarmalayıcı `display: contents`, yerleşimi
 * değiştirmez. Menünün verisi yalnız menü açılınca okunur; başlık her
 * çizildiğinde sorgu açılmasın.
 */
export function CrumbMenu({ node, children }: { node: CrumbNode | null | undefined; children: React.ReactNode }) {
  const actions = useContext(TreeActionsContext)
  const [open, setOpen] = useState<{ seq: number; pos: MenuPos; el: HTMLElement | null } | null>(null)
  if (!node || !actions) return <>{children}</>
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = (e.target as HTMLElement).closest<HTMLElement>('button, a, [tabindex]')
    // Klavyenin menü tuşu (0, 0) bildirir: parçanın altında aç.
    const r = e.clientX === 0 && e.clientY === 0 ? (el ?? (e.target as HTMLElement)).getBoundingClientRect() : null
    setOpen((cur) => ({ seq: (cur?.seq ?? 0) + 1, pos: r ? { x: r.left, y: r.bottom + 4 } : { x: e.clientX, y: e.clientY }, el }))
  }
  return (
    <>
      <span className="contents" onContextMenu={onContextMenu}>{children}</span>
      {open && <CrumbMenuHost key={open.seq} node={node} actions={actions} at={open.pos} returnFocus={open.el} onDone={() => setOpen(null)} />}
    </>
  )
}

function CrumbMenuHost({ node, actions, at, returnFocus, onDone }: { node: CrumbNode; actions: TreeActions; at: MenuPos; returnFocus: HTMLElement | null; onDone: () => void }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user } = useAuth()
  const { kinds: canvasKinds } = useBeta()
  const { data: teams = [] } = useMyTeams()
  const { data: lists = [] } = useProjects(node.teamId)
  const { data: folders = [] } = useFolders(node.teamId)
  const { data: pages = [] } = useTeamPages(node.teamId)
  const prefs = usePrefs('global')
  const importing = useImportLock(node.teamId)
  const targetId = node.kind === 'team' ? null : node.id
  const isFav = useIsFavorite(node.kind === 'page' ? 'page' : 'project', node.kind === 'list' || node.kind === 'page' ? targetId : null)
  const toggleFav = useToggleFavorite()
  const deleteList = useDeleteProject()
  const deleteFolder = useDeleteFolder()
  const deleteFolderDeep = useDeleteFolderDeep()
  const trashPage = useTrashPage()
  const [menuOpen, setMenuOpen] = useState(true)
  const [confirm, setConfirm] = useState<'list' | 'folder' | 'deep' | null>(null)
  // Menü kapanıp onay da yoksa bitti. Seçilen öğe onay açıyorsa ikisi aynı olayda
  // değişir; etki sonuçta onayı görür ve pencere açık kalır.
  useEffect(() => { if (!menuOpen && !confirm) onDone() }, [menuOpen, confirm]) // eslint-disable-line react-hooks/exhaustive-deps

  const team = teams.find((x) => x.id === node.teamId)
  if (!team) return null
  const perms = permissionsFor(team.my_role, user?.id ?? null)
  // Takıma OneNote aktarılırken ağacı salt okunur (#684A9085).
  const edit = importing ? { canManage: false, canWrite: false, canDelete: () => false } : perms
  const folder = node.kind === 'folder' ? folders.find((f) => f.id === targetId) : undefined
  const list = node.kind === 'list' ? lists.find((l) => l.id === targetId) : undefined
  const page = node.kind === 'page' ? pages.find((p) => p.id === targetId) : undefined
  /** Ağaçta gösterip dalı açar ya da kapatır (panel kapalıysa önce açılır). */
  const branch = (folderId: string | null, open: boolean) => revealInTree({
    teamId: team.id,
    folderIds: folderId ? folderChain(folders, folders.find((f) => f.id === folderId)?.parent_id ?? null).map((f) => f.id) : undefined,
    node: folderId ? { kind: 'folder', id: folderId } : { kind: 'team', id: team.id },
    branch: { folderId, open },
  })

  let title = team.name
  let items: RowMenuItem[] = []
  if (node.kind === 'team') {
    const home = readHomePrefs(prefs.prefs)
    const onHome = home.teams.includes(team.id)
    items = teamMenuItems({ edit, perms, canvasKinds, hasContent: !!(folders.length || lists.length || pages.length), onHome }, {
      newList: () => actions.createList(team, null),
      newFolder: () => actions.createFolder(team),
      newPage: (k) => actions.createPage(team, { kind: 'team' }, k),
      expandAll: () => branch(null, true),
      collapseAll: () => branch(null, false),
      toggleHome: () => prefs.patch({ home: { ...home, teams: onHome ? home.teams.filter((id) => id !== team.id) : [...home.teams, team.id] } }),
      openSettings: (tab) => actions.openSettings(team, tab),
      openAgents: () => go(navigate, `/me/agents?team=${team.id}`),
    })
  } else if (folder) {
    title = folder.name
    const hasChildren = folders.some((f) => f.parent_id === folder.id) || lists.some((l) => l.folder_id === folder.id) || pages.some((pg) => pg.folder_id === folder.id)
    items = folderMenuItems({ canManage: edit.canManage, canWrite: edit.canWrite, canvasKinds, hasChildren }, {
      newList: () => actions.createList(team, folder.id),
      newPage: (k) => actions.createPage(team, { kind: 'folder', id: folder.id }, k),
      newFolder: () => actions.createFolder(team, folder.id),
      expandAll: () => branch(folder.id, true),
      collapseAll: () => branch(folder.id, false),
      edit: () => actions.editFolder(team, folder),
      remove: () => setConfirm('folder'),
      removeDeep: () => setConfirm('deep'),
    })
  } else if (list) {
    title = list.name
    items = listMenuItems({ list, isFav, canManage: edit.canManage, canWrite: edit.canWrite, canvasKinds }, {
      // `/list/<id>` hangi ekran açık olursa olsun listeyi seçer (görev penceresi dahil).
      open: () => goList(navigate, list.id),
      toggleFav: () => toggleFav('project', list.id),
      newPage: (k) => actions.createPage(team, { kind: 'list', id: list.id }, k),
      edit: () => actions.editList(team, list),
      remove: () => setConfirm('list'),
    })
  } else if (page) {
    title = page.title.trim() || (isCanvasKind(page.kind) ? t(`canvas.untitled.${page.kind as CanvasKind}`) : t('page.untitled'))
    items = pageMenuItems({ page, title, isFav, canWrite: edit.canWrite, canTrash: edit.canDelete(page.created_by), descendants: descendantCount(pages, page.id), canvasKinds }, {
      open: () => go(navigate, `/page/${page.id}`),
      toggleFav: () => toggleFav('page', page.id),
      newPage: (k) => actions.createPage(team, { kind: 'page', id: page.id }, k),
      // Açık sayfa da gidiyorsa üst sayfaya, en üstteyse panoya dön (ağaçtaki gibi).
      trash: () => {
        const active = pathname.match(/^\/page\/([0-9a-f-]{36})/)?.[1] ?? null
        let leaving = false
        for (let cur = pages.find((x) => x.id === active); cur && !leaving; cur = pages.find((x) => x.id === cur!.parent_page_id)) leaving = cur.id === page.id
        void trashPage.mutateAsync({ id: page.id }).then(() => {
          if (!leaving) return
          go(navigate, page.parent_page_id ? `/page/${page.parent_page_id}` : '/', { up: true })
        }, emitError)
      },
    })
  }
  if (!items.length) return null

  const deep = confirm === 'deep' && folder ? folderBranch(folder.id, folders, lists, pages) : null
  return (
    <>
      {menuOpen && <MenuPopover pos={at} items={items} title={title} onClose={(refocus) => { setMenuOpen(false); if (refocus) returnFocus?.focus() }} />}
      {confirm === 'list' && list && (
        <ConfirmDeleteModal title={t('board.deleteList')} name={list.name} warning={t('board.sidebar.deleteListWarning', { name: list.name })} onClose={() => setConfirm(null)}
          onConfirm={() => void deleteList.mutateAsync({ projectId: list.id, teamId: team.id }).then(() => { actions.projectDeleted(list.id); setConfirm(null) }, () => {})} />
      )}
      {confirm === 'folder' && folder && (
        <ConfirmDeleteModal title={t('board.deleteFolder')} name={folder.name} warning={t('board.sidebar.deleteFolderWarning')} onClose={() => setConfirm(null)}
          onConfirm={() => void deleteFolder.mutateAsync({ id: folder.id, teamId: team.id }).then(() => setConfirm(null), () => {})} />
      )}
      {deep && folder && (
        <ConfirmDeleteModal title={t('board.tree.deleteFolderDeepTitle')} name={folder.name}
          warning={t('board.tree.deleteFolderDeepWarning', { name: folder.name, folders: deep.folderIds.size - 1, lists: deep.lists.length, pages: deep.pages.length })}
          onClose={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); void deleteFolderDeep.mutateAsync({ id: folder.id, teamId: team.id }).catch(emitError) }} />
      )}
    </>
  )
}
