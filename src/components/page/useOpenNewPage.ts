import { useCallback } from 'react'
import { go } from '../../lib/nav'
import { useNavigate } from 'react-router-dom'
import type { PageKind, PageParent } from '../../types'
import { useCreatePage } from '../../hooks/usePages'

/**
 * "New page" is one step, like "new task": the row is created at once and the
 * page opens with the cursor in its title. Left blank, PageView removes it again.
 * A drawing or whiteboard (096, beta) opens the same way, as an empty canvas.
 *
 * Yeni sayfa (ya da tuval) açıp ona git. TicketPages'ten ayrı bir modülde: BoardPage bunu
 * statik içe aktarıyor ve TicketPages → PageView editörü ana pakete çekiyordu (#74d303e2).
 */
export function useOpenNewPage() {
  const create = useCreatePage()
  const navigate = useNavigate()
  return useCallback(async (teamId: string, parent: PageParent, kind: PageKind = 'page') => {
    try {
      const page = await create.mutateAsync({ teamId, parent, kind })
      go(navigate, `/page/${page.id}`, { state: { draft: true } })
    } catch { /* MutationCache surfaces the error as a toast */ }
  }, [create, navigate])
}
