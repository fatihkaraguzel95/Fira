import { lazy, Suspense, useEffect } from 'react'
import type { PageKind, PageParent, Project } from '../../types'
import { isCanvasKind } from '../../types'
import { usePage } from '../../hooks/usePages'
import { PageView } from './PageView'
import { noteParent, pagePath, ticketPath } from '../../lib/nav'

// Beta (096): the canvas frame is its own chunk, like the editors inside it.
const CanvasView = lazy(() => import('../canvas/CanvasView').then((m) => ({ default: m.CanvasView })))

/**
 * `/page/<id>` shows a page or a canvas (096) depending on the row's kind.
 * Split here, not inside PageView: the page's autosave and "a blank draft is
 * deleted on leave" logic would treat a canvas (whose `content` is always
 * empty) as a blank page and remove it.
 */
export function PageScreen(props: {
  pageId: string
  onOpenList: (list: Project) => void
  onCreatePage: (teamId: string, parent: PageParent, kind?: PageKind) => void
}) {
  const { data: page } = usePage(props.pageId)
  // What is more general than this page (#a7d43aaf): its parent page, its task, or its list (the board).
  useEffect(() => {
    if (page) noteParent(pagePath(page.id), page.parent_page_id ? pagePath(page.parent_page_id) : page.ticket_id ? ticketPath(page.ticket_id) : null)
  }, [page?.id, page?.parent_page_id, page?.ticket_id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (page && isCanvasKind(page.kind)) {
    return (
      <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-600 border-t-transparent" /></div>}>
        <CanvasView key={page.id} page={page} onOpenList={props.onOpenList} />
      </Suspense>
    )
  }
  return <PageView {...props} />
}
