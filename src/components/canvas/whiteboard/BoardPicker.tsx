import { useMemo, useRef, useState } from 'react'
import { useVisibleWhiteboards } from '../../../hooks/useCanvas'
import { useMyTeams } from '../../../hooks/useTeams'
import { useDialogFocus } from '../../../hooks/useDialogFocus'
import { displayTime, useDateFormat } from '../../../lib/time'
import { fold } from '../../../lib/fuzzy'
import { useT } from '../../../i18n'
import { WhiteboardIcon } from '../../page/PageTree'

/** "Take from another whiteboard": every whiteboard this user can see, newest first. */
export function BoardPicker({ currentId, onPick, onClose }: { currentId: string; onPick: (id: string) => void; onClose: () => void }) {
  const t = useT()
  useDateFormat()
  const { data: boards = [], isLoading } = useVisibleWhiteboards(true)
  const { data: teams = [] } = useMyTeams()
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref)
  const teamName = (id: string) => teams.find((x) => x.id === id)?.name ?? ''
  const list = useMemo(() => {
    const needle = fold(q.trim())
    return boards.filter((b) => b.id !== currentId && (!needle || fold(`${b.title} ${teamName(b.team_id)}`).includes(needle)))
  }, [boards, q, currentId, teams]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} data-wb-chrome>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('wb.import.pickTitle')} tabIndex={-1}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose() }}
        className="w-full max-w-lg max-h-[80vh] bg-surface rounded-xl shadow-2xl flex flex-col overflow-hidden focus:outline-none">
        <div className="px-4 pt-3 pb-2 border-b border-line-soft">
          <h2 className="text-sm font-semibold text-fg">{t('wb.import.pickTitle')}</h2>
          <p className="text-xs text-fg-muted mt-0.5">{t('wb.import.pickHint')}</p>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('wb.import.search')} aria-label={t('wb.import.search')}
            className="mt-2 w-full text-sm border border-line bg-field text-fg rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <ul className="flex-1 overflow-y-auto p-1.5">
          {isLoading && <li className="px-3 py-2 text-xs text-fg-faint">…</li>}
          {!isLoading && list.length === 0 && <li className="px-3 py-2 text-xs text-fg-faint">{t('wb.import.pickEmpty')}</li>}
          {list.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => onPick(b.id)} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-raised">
                <WhiteboardIcon className="text-fg-faint" />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${b.title.trim() ? 'text-fg' : 'italic text-fg-faint'}`}>{b.title.trim() || t('canvas.untitled.whiteboard')}</span>
                  <span className="block truncate text-xs text-fg-muted">{teamName(b.team_id)} · {displayTime(b.updated_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="px-4 py-2.5 border-t border-line-soft flex justify-end">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-fg-2 hover:bg-raised">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}
