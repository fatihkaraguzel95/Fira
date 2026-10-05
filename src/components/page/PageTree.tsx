import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { useIsFavorite, useToggleFavorite } from '../../lib/favorites'
import { SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { isCanvasKind, type CanvasKind, type Page, type PageKind, type PageParent } from '../../types'
import { PAGE, nestClass, holdStill, type DropHint } from '../layout/treeDnd'
import { childrenOf, descendantCount as descendants } from '../../hooks/usePages'
import { useT } from '../../i18n'
import { useRowMenu, rowMenuSlot } from '../ui/RowMenu'
import { pageMenuItems } from '../layout/treeMenus'
import { DrawingIcon, WhiteboardIcon } from './canvasIcons'

export { DrawingIcon, WhiteboardIcon }

/** A sheet with a folded corner — the page's mark wherever it is listed. */
export const PageIcon = ({ size = 16, className = '' }: { size?: number; className?: string }) => (
  <Icon name="page" size={size} className={className} />
)

/** The mark of a page row by its kind. */
export function KindIcon({ kind, size = 16, className = '' }: { kind?: PageKind | null; size?: number; className?: string }) {
  if (kind === 'drawing') return <DrawingIcon size={size} className={className} />
  if (kind === 'whiteboard') return <WhiteboardIcon size={size} className={className} />
  return <PageIcon size={size} className={className} />
}

/** Same sheet with a plus — "add a page here". */
export const AddPageIcon = () => (
  <Icon name="pageAdd" />
)

const Chevron = ({ open }: { open: boolean }) => (
  <Icon name="chevronRight" className={`text-fg-faint transition-transform ${open ? 'rotate-90' : ''}`} />
)

/** True when `id` is `ancestorId` or sits somewhere below it. */
function isWithin(all: Page[], ancestorId: string, id: string | null): boolean {
  let cur = id ? all.find((p) => p.id === id) : undefined
  for (let hops = 0; cur && hops < 60; hops++) {
    if (cur.id === ancestorId) return true
    cur = cur.parent_page_id ? all.find((p) => p.id === cur!.parent_page_id) : undefined
  }
  return false
}

export interface PageBranchProps {
  /** Every page of the team (the tree reads parent links from it). */
  all: Page[]
  /** The pages to render at this level. */
  items: Page[]
  activePageId: string | null
  canWrite: boolean
  /** Who may move a page to the trash; absent = nobody here. */
  canDelete?: (createdBy: string | null | undefined) => boolean
  onOpen: (id: string) => void
  /** `kind` absent = a page; a canvas kind only when its beta is on (096). */
  onCreate: (parent: PageParent, kind?: PageKind) => void
  /** Canvas kinds this user switched on — offered next to "add a subpage". */
  canvasKinds?: CanvasKind[]
  onTrash?: (page: Page) => void
  /** Branches the tree was told to open or close (recursive open/close, #1F44279C);
   *  a page that is not in here keeps its own state. */
  openMap?: Record<string, boolean>
  onToggleOpen?: (id: string, open: boolean) => void
  /** Pages can be dragged (order and place in the tree, #AC4BC182); off where there is no DndContext. */
  draggable?: boolean
  /** The row a drop would land on right now, and how. */
  dropHint?: DropHint | null
}

/** Pages in the sidebar. Subpages stay folded until opened, except along the path to the open page. */
export function PageBranch(p: PageBranchProps) {
  const nodes = p.items.map((page) => <PageNode key={page.id} page={page} {...p} />)
  // One sortable context per level: a page reorders among its own siblings.
  return p.draggable
    ? <SortableContext items={p.items.map((pg) => PAGE + pg.id)} strategy={holdStill}>{nodes}</SortableContext>
    : <>{nodes}</>
}

function PageNode({ page, all, activePageId, canWrite, canDelete, onOpen, onCreate, onTrash, openMap, onToggleOpen, draggable, dropHint, canvasKinds = [] }: PageBranchProps & { page: Page }) {
  const t = useT()
  const kids = childrenOf(all, page.id)
  const active = activePageId === page.id
  const [own, setOwn] = useState<boolean | null>(null)
  // Until the user folds or unfolds it, a branch is open exactly when the open page is inside it.
  const isOpen = openMap?.[page.id] ?? own ?? (!active && isWithin(all, page.id, activePageId))
  const setOpen = (v: boolean) => { setOwn(v); onToggleOpen?.(page.id, v) }
  // Çizim ve whiteboard yapraktır (096): altına bir şey eklenmez, ağaçta katlanmaz.
  const leaf = isCanvasKind(page.kind)
  const title = page.title.trim() || (leaf ? t(`canvas.untitled.${page.kind as CanvasKind}`) : t('page.untitled'))
  const isFav = useIsFavorite('page', page.id)
  const toggleFav = useToggleFavorite()
  // Öğeler treeMenus'ta; konum çubuklarının menüsü de aynısını kurar (#c675e160).
  const items = pageMenuItems({ page, title, isFav, canWrite, canTrash: !!onTrash && !!canDelete?.(page.created_by), descendants: kids.length ? descendants(all, page.id) : 0, canvasKinds }, {
    open: () => onOpen(page.id),
    toggleFav: () => toggleFav('page', page.id),
    newPage: (k) => { setOpen(true); onCreate({ kind: 'page', id: page.id }, k) },
    trash: () => onTrash?.(page),
  })
  const menu = useRowMenu(items, { title, label: t('board.menu.more', { name: title }) })
  const sortable = useSortable({ id: PAGE + page.id, disabled: !draggable, data: { type: 'page' } })
  const hint = dropHint?.id === PAGE + page.id ? dropHint.mode : null
  return (
    <div data-tree-item className="my-0.5">
      <div
        ref={sortable.setNodeRef}
        style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition, opacity: sortable.isDragging ? 0.4 : 1 }}
        {...(draggable ? sortable.attributes : {})}
        {...(draggable ? sortable.listeners : {})}
        data-dnd-id={PAGE + page.id}
        data-dnd-leaf={leaf ? '1' : undefined}
        onContextMenu={menu.onContextMenu}
        title={draggable ? `${title} · ${t('board.tree.pageDragHint')}` : title}
        className={`group/page relative flex items-center rounded-lg transition-colors ${nestClass(hint)}`}
      >
        {hint === 'before' && <span className="absolute left-0 right-0 -top-0.5 h-0.5 bg-primary-500 rounded-full" aria-hidden />}
        {hint === 'after' && <span className="absolute left-0 right-0 -bottom-0.5 h-0.5 bg-primary-500 rounded-full" aria-hidden />}
        <button
          type="button"
          // A page with subpages opens and folds/unfolds its branch in one click (#1F44279C).
          onClick={() => { onOpen(page.id); if (kids.length > 0) setOpen(!isOpen) }}
          aria-expanded={kids.length > 0 ? isOpen : undefined}
          aria-current={active ? 'page' : undefined}
          title={title}
          data-tree-row
          className={`flex-1 min-w-0 text-left pl-2 pr-7 py-1.5 rounded-lg text-xs transition-all flex items-center gap-2 ${active ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/30 dark:text-primary-300 font-semibold' : 'text-fg-2 hover:bg-raised hover:text-fg'}`}
        >
          <KindIcon kind={page.kind} />
          <span className={`truncate ${page.title.trim() ? '' : 'italic text-fg-faint'}`}>{title}</span>
        </button>
        {/* Ok satırın sağında (kullanıcı, 28 Eyl); sayfa satırında tıklamak
            hem açar hem katlar, o yüzden ok yalnız katlar. */}
        {kids.length > 0 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(!isOpen) }} onPointerDown={(e) => e.stopPropagation()} aria-expanded={isOpen} title={isOpen ? t('page.collapse') : t('page.expand')} aria-label={isOpen ? t('page.collapse') : t('page.expand')}
            className="tap absolute right-1 w-6 h-6 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-raised">
            <Chevron open={isOpen} />
          </button>
        )}
        {items.length > 1 && <div className={`absolute right-7 ${rowMenuSlot('group-hover/page:opacity-100', menu.open)}`}>{menu.trigger}</div>}
        {menu.menu}
      </div>
      {isOpen && kids.length > 0 && (
        <div data-tree-guide className="ml-[15px] pl-2 border-l border-line-soft">
          <PageBranch all={all} items={kids} activePageId={activePageId} canWrite={canWrite} canDelete={canDelete} onOpen={onOpen} onCreate={onCreate} onTrash={onTrash} openMap={openMap} onToggleOpen={onToggleOpen} draggable={draggable} dropHint={dropHint} canvasKinds={canvasKinds} />
        </div>
      )}
    </div>
  )
}
