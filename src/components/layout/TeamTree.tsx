import { useEffect, useRef, useState } from 'react'
import { go } from '../../lib/nav'
import { Icon } from '../ui/Icon'
import { CollisionDetection, DndContext, DragEndEvent, DragMoveEvent, DragOverEvent, DragOverlay, DragStartEvent, KeyboardSensor, MeasuringStrategy, PointerSensor, closestCenter, pointerWithin, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, useSortable, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { isCanvasKind, type CanvasKind, type Page, type PageKind, type PageParent, type Project, type Team, type TeamFolder } from '../../types'
import { PageBranch, AddPageIcon, KindIcon, DrawingIcon, WhiteboardIcon } from '../page/PageTree'
import { useBeta } from '../../hooks/useBeta'
import { useRowMenu, rowMenuSlot } from '../ui/RowMenu'
import { folderMenuItems, listMenuItems } from './treeMenus'
import { byPageOrder, useTrashPage } from '../../hooks/usePages'
import { useNavigate } from 'react-router-dom'
import { emitError } from '../../lib/errorToast'
import { ListAvatar, ListIcon, DEFAULT_FOLDER_ICON } from '../ui/ListIcon'
import { useReorderLists } from '../../hooks/useProjects'
import { useMoveFolder } from '../../hooks/useFolders'
import { useMovePages } from '../../hooks/usePages'
import { LIST, FOLDER, FOLDER_DROP, PAGE, ROOT_DROP, dropMode, edgeMode, nestClass, holdStill, type DropHint, type DropMode } from './treeDnd'
import { useIsFavorite, useToggleFavorite } from '../../lib/favorites'
import { useT } from '../../i18n'
import { childFolders } from '../../lib/folders'

/** Measured on every frame, not once at drag start: rows appear (the root landing
 *  strip) and reflow while dragging, and stale boxes send drops to the wrong row.
 *  Module-level so the config keeps its identity between renders. */
const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } }

const PlusIcon = () => <Icon name="plus" />
const Chevron = ({ open }: { open: boolean }) => (
  <Icon name="chevronRight" className={`text-fg-faint transition-transform ${open ? 'rotate-90' : ''}`} />
)

const CanvasMenuIcon = ({ kind }: { kind: CanvasKind }) => (kind === 'drawing' ? <DrawingIcon /> : <WhiteboardIcon />)

export interface TeamTreeProps {
  team: Team
  folders: TeamFolder[]
  lists: Project[]
  colorHex: (id: string | null) => string | null
  canManage: boolean
  /** Members may add pages even where they cannot add lists (064). */
  canWrite: boolean
  /** Who may move a page to the trash (creator or a manager). */
  canDeletePage: (createdBy: string | null | undefined) => boolean
  /** Every live page of the team; the tree places them under root, folders and lists. */
  pages: Page[]
  activePageId: string | null
  onOpenPage: (id: string) => void
  /** `kind` absent = a page; a canvas kind only when its beta is on (096). */
  onCreatePage: (team: Team, parent: PageParent, kind?: PageKind) => void
  selectedProjectId: string | null
  onSelectProject: (project: Project, team: Team, opts?: { explicit?: boolean }) => void
  onCreateList: (team: Team, folderId: string | null) => void
  onEditList: (team: Team, list: Project) => void
  onEditFolder: (team: Team, folder: TeamFolder) => void
  /** A folder inside `parentId` (068). */
  onCreateFolder: (parentId: string) => void
  onDeleteList: (list: Project) => void
  /** Open/closed branches live one level up, so the team menu can open or close a whole team (#1F44279C). */
  openFolders: Record<string, boolean>
  openPages: Record<string, boolean>
  /** Sayfası olan listeler de katlanabilir (#960a5d22); varsayılan açık. */
  openLists: Record<string, boolean>
  onToggleFolder: (id: string, open: boolean) => void
  onTogglePage: (id: string, open: boolean) => void
  onToggleList: (id: string, open: boolean) => void
  /** Open or close a folder and everything under it (null = the whole team). */
  onSetBranchOpen: (folderId: string | null, open: boolean) => void
  /** Delete a folder with everything in it. */
  onDeleteFolderDeep: (folder: TeamFolder) => void
  onDeleteFolder: (folder: TeamFolder) => void
}


function ListRow({ list, colorHex, active, canManage, canWrite, onSelect, onEdit, onDelete, onAddPage, onAddCanvas, canvasKinds = [], dragging, hinted, edge, pageCount = 0, open = true, onToggle }: {
  list: Project; colorHex: string | null; active: boolean; canManage: boolean; canWrite: boolean; dragging?: boolean; hinted?: boolean
  /** Listenin altındaki sayfa sayısı; 0 ise ok yerine boşluk konur (hizalama). */
  pageCount?: number; open?: boolean; onToggle?: () => void
  /** Dragging another list over this one: which side it would land on. */
  edge?: DropMode | null
  onSelect: () => void; onEdit: () => void; onDelete: () => void; onAddPage: () => void
  onAddCanvas?: (kind: CanvasKind) => void; canvasKinds?: CanvasKind[]
}) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: LIST + list.id, disabled: !canManage, data: { type: 'list', folderId: list.folder_id ?? null } })
  const isFav = useIsFavorite('project', list.id)
  const toggleFav = useToggleFavorite()
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging || dragging ? 0.4 : 1 }
  // Öğeler treeMenus'ta; konum çubuklarının menüsü de aynısını kurar (#c675e160).
  const items = listMenuItems({ list, isFav, canManage, canWrite, canvasKinds: onAddCanvas ? canvasKinds : [] }, {
    open: onSelect,
    toggleFav: () => toggleFav('project', list.id),
    newPage: (k) => (k ? onAddCanvas?.(k) : onAddPage()),
    edit: onEdit,
    remove: onDelete,
  })
  const menu = useRowMenu(items, { title: list.name, label: t('board.menu.more', { name: list.name }) })
  return (
    <div ref={setNodeRef} data-dnd-id={LIST + list.id} data-tree-item style={style} {...attributes} {...listeners} onContextMenu={menu.onContextMenu} className={`group/list relative flex items-center my-0.5 rounded-lg transition-colors ${hinted ? 'ring-2 ring-primary-400 bg-primary-50/60 dark:bg-primary-950/30' : ''}`} title={canManage ? `${list.name} · ${t('board.tree.listDragHint')}` : list.name}>
      {edge === 'before' && <span className="absolute left-0 right-0 -top-0.5 h-0.5 bg-primary-500 rounded-full" aria-hidden />}
      {edge === 'after' && <span className="absolute left-0 right-0 -bottom-0.5 h-0.5 bg-primary-500 rounded-full" aria-hidden />}
      <button
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        data-tree-row
        className={`flex-1 text-left pl-2 pr-7 py-1.5 rounded-lg text-sm transition-all flex items-center gap-2 min-w-0 ${active ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/30 dark:text-primary-300 font-semibold' : 'text-fg-2 hover:bg-raised hover:text-fg'}`}
      >
        <ListAvatar icon={list.icon} iconUrl={list.icon_url} color={colorHex} size="sm" />
        <span className="truncate font-medium text-xs">{list.name}</span>
      </button>

      {/* Katlama oku satırın **sağında** (kullanıcı, 28 Eyl: "paneldeki tüm
          chevron'ları sağa alalım"); seçme düğmesinin dışında ki tıklayınca
          liste açılmasın. Satır menüsü onun soluna kayar. */}
      {pageCount > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle?.() }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-expanded={open}
          aria-label={open ? t('board.tree.collapseList', { name: list.name }) : t('board.tree.expandList', { name: list.name })}
          title={open ? t('board.tree.collapseList', { name: list.name }) : t('board.tree.expandList', { name: list.name })}
          className="tap absolute right-1 w-6 h-6 flex items-center justify-center rounded-md hover:bg-raised text-fg-faint"
          data-list-toggle={list.id}
        >
          <Chevron open={open} />
        </button>
      )}
      {menu.trigger && <div className={`absolute right-7 ${rowMenuSlot('group-hover/list:opacity-100', menu.open)}`}>{menu.trigger}</div>}
      {menu.menu}
    </div>
  )
}

function FolderBlock({ folder, count, open, onToggle, colorHex, canManage, canWrite, children, onCreateList, onCreatePage, onCreateCanvas, canvasKinds = [], onCreateFolder, onEdit, onDelete, onDeleteDeep, onExpandAll, onCollapseAll, hasChildren, hint }: {
  folder: TeamFolder; count: number; open: boolean; onToggle: () => void; colorHex: string | null; canManage: boolean; canWrite: boolean
  children: React.ReactNode; onCreateList: () => void; onCreatePage: () => void; onCreateFolder: () => void; onEdit: () => void; onDelete: () => void
  onDeleteDeep: () => void; onExpandAll: () => void; onCollapseAll: () => void; hasChildren: boolean; hint: DropMode | null
  onCreateCanvas?: (kind: CanvasKind) => void; canvasKinds?: CanvasKind[]
}) {
  const t = useT()
  const sortable = useSortable({ id: FOLDER + folder.id, disabled: !canManage, data: { type: 'folder' } })
  const drop = useDroppable({ id: FOLDER_DROP + folder.id, disabled: !canManage })
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition, opacity: sortable.isDragging ? 0.4 : 1 }
  const items = folderMenuItems({ canManage, canWrite, canvasKinds: onCreateCanvas ? canvasKinds : [], hasChildren }, {
    newList: onCreateList,
    newPage: (k) => (k ? onCreateCanvas?.(k) : onCreatePage()),
    newFolder: onCreateFolder,
    expandAll: onExpandAll,
    collapseAll: onCollapseAll,
    edit: onEdit,
    remove: onDelete,
    removeDeep: onDeleteDeep,
  })
  const menu = useRowMenu(items, { title: folder.name, label: t('board.menu.more', { name: folder.name }) })
  return (
    <div ref={drop.setNodeRef} data-dnd-id={FOLDER_DROP + folder.id} data-tree-item style={style} className="my-0.5">
      <div ref={sortable.setNodeRef} data-dnd-id={FOLDER + folder.id} onContextMenu={menu.onContextMenu} className={`group/folder relative flex items-center rounded-lg transition-colors ${nestClass(hint)}`}>
        {hint === 'before' && <span className="absolute left-0 right-0 -top-0.5 h-0.5 bg-primary-500 rounded-full" aria-hidden />}
        {hint === 'after' && <span className="absolute left-0 right-0 -bottom-0.5 h-0.5 bg-primary-500 rounded-full" aria-hidden />}
        <button
          {...sortable.attributes} {...sortable.listeners}
          onClick={onToggle}
          aria-expanded={open}
          title={canManage ? `${folder.name} · ${t('board.tree.folderDragHint2')}` : folder.name}
          data-tree-row
          className="flex-1 text-left pl-2 pr-7 py-1.5 rounded-lg text-xs font-semibold text-fg-2 hover:bg-raised flex items-center gap-2 min-w-0"
        >
          <ListAvatar icon={DEFAULT_FOLDER_ICON} color={colorHex} size="sm" fallbackIcon={DEFAULT_FOLDER_ICON} />
          <span className="truncate">{folder.name}</span>
          {/* the count gives way to the menu button on hover */}
          <span className={`ml-auto text-2xs font-normal text-fg-faint tabular-nums ${menu.trigger ? 'group-hover/folder:invisible group-focus-within/folder:invisible [@media(hover:none)]:invisible' : ''} ${menu.open ? 'invisible' : ''}`}>{count}</span>
        </button>
        {/* Ok satırın sağında; tıklama satırın kendi düğmesine geçer (klasörde
            satıra tıklamak zaten açıp kapatıyor). */}
        <span aria-hidden className="absolute right-1 w-4 h-5 flex items-center justify-center text-fg-faint pointer-events-none"><Chevron open={open} /></span>
        {menu.trigger && <div className={`absolute right-7 ${rowMenuSlot('group-hover/folder:opacity-100', menu.open)}`}>{menu.trigger}</div>}
        {menu.menu}
      </div>
      {/* Seviye çizgisi, açan satırın simgesinin tam ortasından iner (kullanıcı, 28 Eyl):
          satır dolgusu 8 px + 20 px simgenin yarısı = 18 px. */}
      {open && <div data-tree-guide className="ml-[18px] pl-2 border-l border-line-soft">{children}</div>}
    </div>
  )
}

/** Team → Folder → List tree with drag & drop: folders reorder, lists reorder within / move between folders and root. */
export function TeamTree(p: TeamTreeProps) {
  const t = useT()
  const { kinds: canvasKinds } = useBeta()
  const [activeId, setActiveId] = useState<string | null>(null)
  /** The row a drop would land on, and whether it goes in it or next to it. */
  const [hint, setHint] = useState<DropHint | null>(null)
  /** Where the pointer really is. dnd-kit's own rects are measured when the drag
   *  starts and did not line up with the rows, so the zone is read from the live
   *  row box instead (`data-dnd-id`) against this. */
  const pointer = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const h = (e: PointerEvent) => { pointer.current = { x: e.clientX, y: e.clientY } }
    window.addEventListener('pointermove', h, { passive: true })
    return () => window.removeEventListener('pointermove', h)
  }, [])
  const { openFolders, openPages, openLists } = p
  const openFolder = (id: string, open: boolean) => p.onToggleFolder(id, open)
  const reorderLists = useReorderLists()
  const moveFolder = useMoveFolder()
  const movePages = useMovePages()
  const byOrder = <T extends { order_index: number; name: string }>(a: T, b: T) => a.order_index - b.order_index || a.name.localeCompare(b.name, 'tr')
  const folders = [...p.folders].sort(byOrder)
  const listsOf = (folderId: string | null) => p.lists.filter((l) => (folderId ? l.folder_id === folderId : !l.folder_id || !p.folders.some((f) => f.id === l.folder_id))).sort(byOrder)
  const isFolderOpen = (f: TeamFolder) => openFolders[f.id] ?? true
  const folderIds = new Set(p.folders.map((f) => f.id))
  const rootDrop = useDroppable({ id: ROOT_DROP + p.team.id, disabled: !p.canManage })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const activeList = activeId?.startsWith(LIST) ? p.lists.find((l) => l.id === activeId.slice(LIST.length)) ?? null : null
  const activeFolder = activeId?.startsWith(FOLDER) ? p.folders.find((f) => f.id === activeId.slice(FOLDER.length)) ?? null : null
  const activePage = activeId?.startsWith(PAGE) ? p.pages.find((pg) => pg.id === activeId.slice(PAGE.length)) ?? null : null

  /**
   * What each kind may be dropped on, most specific first: a page prefers
   * another page (reorder / subpage) over the list or folder that holds it, and
   * a folder never lands on a list or a page.
   */
  const ALLOWED: Record<string, string[]> = {
    [FOLDER]: [FOLDER, FOLDER_DROP, ROOT_DROP],
    [LIST]: [LIST, FOLDER, FOLDER_DROP, ROOT_DROP],
    [PAGE]: [PAGE, LIST, FOLDER, FOLDER_DROP, ROOT_DROP],
  }
  const kindOf = (id: string) => (id.startsWith(FOLDER_DROP) ? LIST : id.startsWith(FOLDER) ? FOLDER : id.startsWith(PAGE) ? PAGE : LIST)
  /**
   * What the pointer is over, read from the DOM. dnd-kit measures its own boxes
   * when a drag starts and those drifted from the real rows here (long trees,
   * rows that appear mid-drag), which sent drops to rows far from the pointer —
   * so the tree hit-tests the live rows instead. `data-dnd-id` marks them.
   */
  const targetUnder = (draggedId: string): { id: string; rect: DOMRect } | null => {
    const allowed = ALLOWED[kindOf(draggedId)] ?? []
    const stack = typeof document.elementsFromPoint === 'function'
      ? (document.elementsFromPoint(pointer.current.x, pointer.current.y) as Element[])
      : []
    for (const el of stack) {
      const row = el.closest?.('[data-dnd-id]') as HTMLElement | null
      const id = row?.dataset.dndId
      if (!id || id === draggedId) continue
      if (!allowed.some((prefix) => id.startsWith(prefix))) continue
      return { id, rect: row!.getBoundingClientRect() }
    }
    return null
  }
  const collision: CollisionDetection = (args) => {
    const found = pointerWithin(args)
    const hits = found.length ? found : closestCenter(args)
    const dragging = String(args.active.id)
    const allowed = ALLOWED[kindOf(dragging)] ?? []
    for (const prefix of allowed) {
      const preferred = hits.filter((h) => String(h.id).startsWith(prefix) && String(h.id) !== dragging)
      if (preferred.length) return preferred
    }
    return []
  }

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const e = activatorEvent as PointerEvent
    pointer.current = { x: e.clientX ?? 0, y: e.clientY ?? 0 }
    setActiveId(String(active.id))
  }
  /**
   * Which row the drop would land on, and where in it. Recomputed on every move
   * rather than in `onDragOver`: that one only fires when the row under the
   * pointer changes, so entering a row at its edge froze the answer at "next to
   * it" and its middle could never be reached.
   */
  const isLeafRow = (dndId: string) => isCanvasKind(p.pages.find((x) => x.id === dndId.slice(PAGE.length))?.kind)
  const trackHint = (draggedId: string, activatorEvent: Event, delta: { x: number; y: number }) => {
    // Touch does not send pointermove to the window while dragging; fall back to the delta.
    const e = activatorEvent as PointerEvent
    if (e?.pointerType === 'touch') pointer.current = { x: (e.clientX ?? 0) + delta.x, y: (e.clientY ?? 0) + delta.y }
    const t = targetUnder(draggedId)
    if (!t) { setHint(null); return }
    // Only rows have an inside and edges; a folder's body just takes the drop.
    // A list row takes a page *in*, but another list only next to it — so for a
    // dragged list it splits in half instead of keeping a dead middle third.
    // A drawing / whiteboard row takes nothing inside it (096): only next to it.
    const mode: DropMode = t.id.startsWith(PAGE) && isLeafRow(t.id)
      ? edgeMode(t.rect, pointer.current.y)
      : t.id.startsWith(PAGE) || (t.id.startsWith(FOLDER) && !t.id.startsWith(FOLDER_DROP))
      ? dropMode(t.rect, pointer.current.y)
      : t.id.startsWith(LIST) && draggedId.startsWith(LIST)
        ? edgeMode(t.rect, pointer.current.y)
        : 'nest'
    setHint((prev) => (prev && prev.id === t.id && prev.mode === mode ? prev : { id: t.id, mode }))
  }
  const onDragMove = ({ active, activatorEvent, delta }: DragMoveEvent) => trackHint(String(active.id), activatorEvent, delta)
  const onDragOver = ({ active, activatorEvent, delta }: DragOverEvent) => trackHint(String(active.id), activatorEvent, delta)

  // ── where a dragged thing may go ──────────────────────────────────────────
  /** A folder and everything under it — a folder cannot be dropped into its own branch. */
  const folderSubtree = (id: string) => {
    const ids = new Set([id])
    for (let grew = true; grew;) {
      grew = false
      for (const f of folders) if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) { ids.add(f.id); grew = true }
    }
    return ids
  }
  const pageParentOf = (pg: Page): PageParent =>
    pg.parent_page_id ? { kind: 'page', id: pg.parent_page_id }
      : pg.project_id ? { kind: 'list', id: pg.project_id }
        : pg.folder_id && folderIds.has(pg.folder_id) ? { kind: 'folder', id: pg.folder_id }
          : { kind: 'team' }
  const sameParent = (a: PageParent, b: PageParent) => a.kind === b.kind && ('id' in a ? a.id : null) === ('id' in b ? b.id : null)
  const pagesOf = (parent: PageParent) => p.pages.filter((pg) => sameParent(pageParentOf(pg), parent)).sort(byPageOrder)
  /** True when `id` is the page itself or sits under it. */
  const withinPage = (rootId: string, id: string) => {
    for (let cur = p.pages.find((x) => x.id === id), hops = 0; cur && hops < 60; hops++) {
      if (cur.id === rootId) return true
      cur = cur.parent_page_id ? p.pages.find((x) => x.id === cur!.parent_page_id) : undefined
    }
    return false
  }
  const movePageTo = (page: Page, parent: PageParent, index: number | null) => {
    const sibs = pagesOf(parent).filter((x) => x.id !== page.id)
    sibs.splice(index === null || index < 0 ? sibs.length : index, 0, page)
    movePages.mutate({ teamId: p.team.id, updates: sibs.map((x, i) => ({ id: x.id, order_index: i, parent })) })
  }
  const moveFolderTo = (folder: TeamFolder, parentId: string | null, index: number | null) => {
    const sibs = childFolders(folders, parentId).filter((f) => f.id !== folder.id)
    sibs.splice(index === null || index < 0 ? sibs.length : index, 0, folder)
    moveFolder.mutate({ teamId: p.team.id, updates: sibs.map((f, i) => ({ id: f.id, order_index: i, parent_id: parentId })) })
  }
  const onDragEnd = ({ active }: DragEndEvent) => {
    const a = String(active.id)
    // Where the pointer actually is, which is what the highlight showed.
    const landed = targetUnder(a)
    const mode: DropMode = landed && hint && hint.id === landed.id ? hint.mode : 'nest'
    setActiveId(null); setHint(null)
    if (!landed) return
    const o = landed.id
    if (a === o) return

    // folder → another level, or next to a folder on its own level
    if (a.startsWith(FOLDER)) {
      const dragged = folders.find((f) => f.id === a.slice(FOLDER.length))
      if (!dragged) return
      if (o.startsWith(ROOT_DROP)) { moveFolderTo(dragged, null, null); return }
      const overId = o.startsWith(FOLDER) ? o.slice(FOLDER.length) : o.startsWith(FOLDER_DROP) ? o.slice(FOLDER_DROP.length) : null
      const target = overId ? folders.find((f) => f.id === overId) : null
      // Into its own branch would orphan the tree (the 068 trigger refuses it too).
      if (!target || folderSubtree(dragged.id).has(target.id)) return
      if (mode === 'nest') { moveFolderTo(dragged, target.id, null); openFolder(target.id, true); return }
      const parentId = target.parent_id && folderIds.has(target.parent_id) ? target.parent_id : null
      const sibs = childFolders(folders, parentId).filter((f) => f.id !== dragged.id)
      const at = sibs.findIndex((f) => f.id === target.id)
      moveFolderTo(dragged, parentId, mode === 'after' ? at + 1 : at)
      return
    }

    // page → folder, list, another page (as a subpage or next to it), or the team root
    if (a.startsWith(PAGE)) {
      const page = p.pages.find((x) => x.id === a.slice(PAGE.length))
      if (!page) return
      if (o.startsWith(ROOT_DROP)) { movePageTo(page, { kind: 'team' }, null); return }
      if (o.startsWith(FOLDER) || o.startsWith(FOLDER_DROP)) {
        const id = o.startsWith(FOLDER_DROP) ? o.slice(FOLDER_DROP.length) : o.slice(FOLDER.length)
        movePageTo(page, { kind: 'folder', id }, null); openFolder(id, true)
        return
      }
      if (o.startsWith(LIST)) { movePageTo(page, { kind: 'list', id: o.slice(LIST.length) }, null); return }
      if (!o.startsWith(PAGE)) return
      const target = p.pages.find((x) => x.id === o.slice(PAGE.length))
      // Into itself or its own subpages: there would be no way back to the tree.
      if (!target || withinPage(page.id, target.id)) return
      if (mode === 'nest' && !isCanvasKind(target.kind)) { movePageTo(page, { kind: 'page', id: target.id }, null); p.onTogglePage(target.id, true); return }
      const parent = pageParentOf(target)
      const sibs = pagesOf(parent).filter((x) => x.id !== page.id)
      const at = sibs.findIndex((x) => x.id === target.id)
      movePageTo(page, parent, mode === 'after' || mode === 'nest' ? at + 1 : at)
      return
    }

    // list → somewhere
    if (!a.startsWith(LIST)) return
    const list = p.lists.find((l) => l.id === a.slice(LIST.length))
    if (!list) return
    let targetFolder: string | null
    let targetIndex: number | null = null
    if (o.startsWith(LIST)) {
      const overList = p.lists.find((l) => l.id === o.slice(LIST.length))
      if (!overList) return
      targetFolder = overList.folder_id && p.folders.some((f) => f.id === overList.folder_id) ? overList.folder_id : null
      const at = listsOf(targetFolder).filter((l) => l.id !== list.id).findIndex((l) => l.id === overList.id)
      // Dropped on the lower half: after that row, not before it.
      targetIndex = at < 0 ? at : mode === 'after' ? at + 1 : at
    } else if (o.startsWith(FOLDER_DROP) || o.startsWith(FOLDER)) {
      targetFolder = o.startsWith(FOLDER_DROP) ? o.slice(FOLDER_DROP.length) : o.slice(FOLDER.length)
      if (!isFolderOpen(p.folders.find((f) => f.id === targetFolder)!)) openFolder(targetFolder as string, true)
    } else if (o.startsWith(ROOT_DROP)) {
      targetFolder = null
    } else return

    const target = listsOf(targetFolder).filter((l) => l.id !== list.id)
    const idx = targetIndex === null || targetIndex < 0 ? target.length : targetIndex
    target.splice(idx, 0, { ...list, folder_id: targetFolder })
    const sourceFolder = list.folder_id && p.folders.some((f) => f.id === list.folder_id) ? list.folder_id : null
    const updates = target.map((l, i) => ({ id: l.id, order_index: i, folder_id: targetFolder }))
    if (sourceFolder !== targetFolder) listsOf(sourceFolder).filter((l) => l.id !== list.id).forEach((l, i) => updates.push({ id: l.id, order_index: i, folder_id: sourceFolder }))
    reorderLists.mutate({ teamId: p.team.id, updates })
  }

  // Pages: a list's own pages sit right under it; subpages fold under their page.
  const pagesWhere = (match: (pg: Page) => boolean) => p.pages.filter(match).sort(byPageOrder)
  // Moving a page (and its subpages) to the trash from its menu. If the open
  // page goes with it, show its parent — or the board for a top-level page.
  const trashPage = useTrashPage()
  const navigate = useNavigate()
  const onTrash = (page: Page) => {
    const within = (id: string | null) => { for (let cur = p.pages.find((x) => x.id === id); cur; cur = p.pages.find((x) => x.id === cur!.parent_page_id)) if (cur.id === page.id) return true; return false }
    const leaving = within(p.activePageId)
    void trashPage.mutateAsync({ id: page.id }).then(() => {
      if (!leaving) return
      if (page.parent_page_id) p.onOpenPage(page.parent_page_id)
      else go(navigate, '/', { up: true })
    }, emitError)
  }
  const branch = (items: Page[]) => items.length > 0 && (
    <PageBranch all={p.pages} items={items} activePageId={p.activePageId} canWrite={p.canWrite} canDelete={p.canDeletePage}
      onOpen={p.onOpenPage} onCreate={(parent, kind) => p.onCreatePage(p.team, parent, kind)} onTrash={onTrash}
      openMap={openPages} onToggleOpen={p.onTogglePage} draggable={p.canWrite} dropHint={hint} canvasKinds={canvasKinds} />
  )

  const row = (list: Project) => {
    const own = pagesWhere((pg) => pg.project_id === list.id)
    const open = openLists[list.id] ?? true
    return (
      <div key={list.id}>
        <ListRow list={list} colorHex={p.colorHex(list.color_id)} active={p.selectedProjectId === list.id && !p.activePageId} canManage={p.canManage} canWrite={p.canWrite}
          hinted={hint?.id === LIST + list.id && !!activePage}
          edge={hint?.id === LIST + list.id && !!activeList ? hint.mode : null}
          pageCount={own.length} open={open} onToggle={() => p.onToggleList(list.id, !open)}
          onSelect={() => p.onSelectProject(list, p.team, { explicit: true })} onEdit={() => p.onEditList(p.team, list)} onDelete={() => p.onDeleteList(list)}
          onAddPage={() => p.onCreatePage(p.team, { kind: 'list', id: list.id })}
          canvasKinds={canvasKinds} onAddCanvas={(k) => p.onCreatePage(p.team, { kind: 'list', id: list.id }, k)} />
        {own.length > 0 && open && <div className="ml-4 pl-1" aria-label={t('page.listPages', { n: own.length })}>{branch(own)}</div>}
      </div>
    )
  }
  /** A folder with what it holds: subfolders (068), lists, pages — nested as deep as they go. */
  const renderFolder = (folder: TeamFolder): React.ReactNode => {
    const subs = childFolders(folders, folder.id)
    const inner = listsOf(folder.id)
    const folderPages = pagesWhere((pg) => pg.folder_id === folder.id)
    const empty = subs.length === 0 && inner.length === 0 && folderPages.length === 0
    return (
      <FolderBlock key={folder.id} folder={folder} count={subs.length + inner.length + folderPages.length} open={isFolderOpen(folder)} onToggle={() => openFolder(folder.id, !isFolderOpen(folder))}
        colorHex={p.colorHex(folder.color_id)} canManage={p.canManage} canWrite={p.canWrite}
        onCreateList={() => p.onCreateList(p.team, folder.id)}
        onCreatePage={() => { openFolder(folder.id, true); p.onCreatePage(p.team, { kind: 'folder', id: folder.id }) }}
        canvasKinds={canvasKinds} onCreateCanvas={(k) => { openFolder(folder.id, true); p.onCreatePage(p.team, { kind: 'folder', id: folder.id }, k) }}
        onCreateFolder={() => { openFolder(folder.id, true); p.onCreateFolder(folder.id) }}
        onEdit={() => p.onEditFolder(p.team, folder)} onDelete={() => p.onDeleteFolder(folder)}
        onDeleteDeep={() => p.onDeleteFolderDeep(folder)} hasChildren={!empty}
        hint={hint?.id === FOLDER + folder.id ? hint.mode : hint?.id === FOLDER_DROP + folder.id ? 'nest' : null}
        onExpandAll={() => p.onSetBranchOpen(folder.id, true)} onCollapseAll={() => p.onSetBranchOpen(folder.id, false)}>
        {subs.length > 0 && (
          <SortableContext items={subs.map((f) => FOLDER + f.id)} strategy={holdStill}>
            {subs.map(renderFolder)}
          </SortableContext>
        )}
        <SortableContext items={inner.map((l) => LIST + l.id)} strategy={holdStill}>
          {inner.map(row)}
          {inner.length === 0 && (activeList || empty) && <p className="text-xs text-fg-faint px-2 py-1">{activeList ? t('board.dropHere') : t('board.tree.emptyFolder')}</p>}
        </SortableContext>
        {branch(folderPages)}
      </FolderBlock>
    )
  }
  const rootLists = listsOf(null)
  // A page whose folder is gone shows at the root (the FK nulls folder_id; this covers a stale cache).
  const rootPages = pagesWhere((pg) => !pg.project_id && !pg.ticket_id && !pg.parent_page_id && (!pg.folder_id || !folderIds.has(pg.folder_id)))

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      measuring={MEASURING}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => { setActiveId(null); setHint(null) }}
    >
      {/* Takımın seviye çizgisi de logosunun ortasından iner: satır 0 + 12 px dolgu + 24 px logonun yarısı = 24 px. */}
      <div className="ml-6 mr-2 mt-0.5 mb-1">
      <div data-tree-guide className="pl-3 border-l-2 border-line-soft">
        <SortableContext items={childFolders(folders, null).map((f) => FOLDER + f.id)} strategy={holdStill}>
          {childFolders(folders, null).map(renderFolder)}
        </SortableContext>

        <div className="relative rounded-lg">
          <SortableContext items={rootLists.map((l) => LIST + l.id)} strategy={holdStill}>
            {rootLists.map(row)}
          </SortableContext>
          {branch(rootPages)}
          {/* Adding lives in the team / folder / list menus (the menu button or a right
              click). Only an empty team keeps written buttons, so a new team is not a
              dead end (CLAUDE.md: discoverability). */}
        </div>
      </div>
      {/* Kök bırakma alanı seviye çizgisinin **dışında** (kullanıcı, 28 Eyl:
          "drag and drop hedefinin sol tarafında takım çizgisi çıkmasın"):
          takımın kendi seviyesi, ağacın bir dalı değil. Girinti aynı kalır. */}
      <div className="pl-3">
          {/* The team's own level, as a row of its own: somewhere to drop "back to
              the top level". It is always in the flow (a strip that appeared only
              mid-drag moved every row below it and drops missed). */}
          <div
            ref={rootDrop.setNodeRef}
            data-dnd-id={ROOT_DROP + p.team.id}
            className={`h-[26px] flex items-center px-2 rounded-lg text-xs text-fg-faint transition-colors ${hint?.id === ROOT_DROP + p.team.id ? 'ring-2 ring-primary-400 bg-primary-50/60 dark:bg-primary-950/30' : ''}`}
          >
            {(activeList?.folder_id || activeFolder?.parent_id || (activePage && (activePage.folder_id || activePage.project_id || activePage.parent_page_id))) ? t('board.tree.dropAtRoot') : ''}
          </div>
          {p.lists.length === 0 && p.folders.length === 0 && rootPages.length === 0 && (
            <div className="px-2 py-1">
              <p className="text-xs text-fg-faint mb-0.5">{t('board.tree.noLists')}</p>
              {p.canManage && (
                <button onClick={() => p.onCreateList(p.team, null)} className="w-full text-left py-1 rounded-lg text-xs text-fg-faint hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center gap-2">
                  <PlusIcon /> {t('board.tree.addList')}
                </button>
              )}
              {p.canWrite && (
                <button onClick={() => p.onCreatePage(p.team, { kind: 'team' })} className="w-full text-left py-1 rounded-lg text-xs text-fg-faint hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center gap-2">
                  <AddPageIcon /> {t('page.addPage')}
                </button>
              )}
              {p.canWrite && canvasKinds.map((k) => (
                <button key={k} onClick={() => p.onCreatePage(p.team, { kind: 'team' }, k)} className="w-full text-left py-1 rounded-lg text-xs text-fg-faint hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center gap-2">
                  <CanvasMenuIcon kind={k} /> {t(`canvas.add.${k}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }} style={{ pointerEvents: 'none' }}>
        {activeList && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface shadow-lg ring-1 ring-primary-300 text-xs font-medium text-fg w-52">
            <ListAvatar icon={activeList.icon} iconUrl={activeList.icon_url} color={p.colorHex(activeList.color_id)} size="sm" /><span className="truncate">{activeList.name}</span>
          </div>
        )}
        {activePage && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface shadow-lg ring-1 ring-primary-300 text-xs text-fg-2 w-52">
            <KindIcon kind={activePage.kind} /><span className="truncate">{activePage.title.trim() || (isCanvasKind(activePage.kind) ? t(`canvas.untitled.${activePage.kind}`) : t('page.untitled'))}</span>
          </div>
        )}
        {activeFolder && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface shadow-lg ring-1 ring-primary-300 text-xs font-semibold text-fg-2 w-52">
            <ListIcon name={DEFAULT_FOLDER_ICON} /><span className="truncate">{activeFolder.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
