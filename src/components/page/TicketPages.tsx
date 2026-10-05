import { useTicketPages } from '../../hooks/usePages'
import { useOpenNewPage } from './useOpenNewPage'
import { useBeta } from '../../hooks/useBeta'
import { PageLinks } from './PageView'
import { AddPageIcon, DrawingIcon, WhiteboardIcon } from './PageTree'
import { useT } from '../../i18n'
import { SectionHide } from '../ticket/SectionHide'

const addClass = 'flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-fg-faint hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950/20 transition-colors'

/**
 * The task's own pages — notes and how-tos that belong to this task (064).
 * Görev penceresinde "Ekler" bölümü (#7c54fb70): sayfa, çizim ve whiteboard'lar
 * ekleme düğmeleriyle birlikte burada. Boşken gizli; ilk eki aksiyon listesi
 * yaratır.
 */
export function TicketPages({ ticketId, teamId, canEdit, onHide }: { ticketId: string; teamId: string | null; canEdit: boolean; onHide?: () => void }) {
  const t = useT()
  const { data: pages = [] } = useTicketPages(ticketId)
  const openNew = useOpenNewPage()
  const { kinds } = useBeta()
  if (!pages.length && !canEdit) return null
  return (
    <div>
      <div className="group/sec flex items-center justify-between gap-2 mb-2 min-h-[1.25rem]">
        <h4 className="text-xs font-semibold text-fg-faint uppercase tracking-wider">
          {t('ticket.extras.title')} {pages.length > 0 && <span className="font-normal normal-case">{pages.length}</span>}
        </h4>
        {pages.length === 0 && onHide && <SectionHide name={t('ticket.extras.title')} onHide={onHide} />}
      </div>
      <PageLinks pages={pages} />
      {canEdit && teamId && (
        <div className="flex flex-wrap items-center gap-x-1">
          <button onClick={() => void openNew(teamId, { kind: 'ticket', id: ticketId })} title={t('page.ticketPagesHint')} className={addClass}>
            <AddPageIcon /> {t('page.addPage')}
          </button>
          {kinds.map((k) => (
            <button key={k} onClick={() => void openNew(teamId, { kind: 'ticket', id: ticketId }, k)} className={addClass}>
              {k === 'drawing' ? <DrawingIcon /> : <WhiteboardIcon />} {t(`canvas.add.${k}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
