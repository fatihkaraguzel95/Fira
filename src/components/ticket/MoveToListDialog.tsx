import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useMoveTargets } from '../../hooks/useProjects'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { useT } from '../../i18n'
import { ListIcon } from '../ui/ListIcon'
import type { Project } from '../../types'

/**
 * "Move to list" (#7120F27C): the other lists of the task's team, and — for
 * someone who is an admin in both — the lists of their other teams too
 * (#4e8dc8f1). The move runs on the server (078/093 `move_ticket`): subtasks
 * follow, tags are matched by name, the status becomes the target list's
 * same-named column or its first one, and across teams the assignees who are
 * not members of the target team are dropped.
 */
export function MoveToListDialog({ teamId, currentProjectId, busy, onPick, onClose }: {
  teamId: string | null
  currentProjectId: string | null
  busy?: boolean
  onPick: (project: Project) => void
  onClose: () => void
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, true)
  const { data: groups = [] } = useMoveTargets(teamId)
  const usable = groups
    .map((g) => ({ ...g, lists: g.lists.filter((p) => p.id !== currentProjectId) }))
    .filter((g) => g.lists.length > 0)
  const count = usable.reduce((n, g) => n + g.lists.length, 0)
  // Portaled: a card's context menu opens it, and inside the card a click would
  // open the task and a small drag would pick the card up.
  return createPortal(
    <div className="fixed inset-0 z-[9600] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { e.stopPropagation(); onClose() }} onPointerDown={(e) => e.stopPropagation()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t('board.card.moveTitle')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
        className="w-full max-w-sm rounded-xl bg-surface border border-line shadow-2xl p-4 animate-fade-in"
      >
        <h2 className="text-sm font-semibold text-fg">{t('board.card.moveTitle')}</h2>
        <p className="mt-1 text-xs text-fg-muted">{t('board.card.moveHint')}</p>
        <div className="mt-3 max-h-72 overflow-y-auto scrollbar-thin -mx-1">
          {count === 0 && <p className="px-1 py-6 text-center text-sm text-fg-faint">{t('board.card.moveNoLists')}</p>}
          {usable.map((g) => (
            <div key={g.team.id} role="group" aria-label={g.team.name}>
              {/* Başka takımın listeleri başlık altında: görevin takim değiştirdiği
                  yanlışlıkla seçilmesin (#4e8dc8f1). */}
              {!g.own && <div className="px-2 pt-2 pb-1 text-xs font-semibold text-fg-faint uppercase tracking-wide">{g.team.name}</div>}
              {g.lists.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(p)}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl text-left text-sm text-fg hover:bg-raised disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <ListIcon name={p.icon} className="text-fg-muted" />
                  <span className="flex-1 min-w-0 truncate">{p.name}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-fg-2 hover:bg-raised transition-colors">{t('common.giveUp')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
