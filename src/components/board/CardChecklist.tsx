import type { Ticket } from '../../types'
import { Icon } from '../ui/Icon'
import { useT } from '../../i18n'
import { useUpdateChecklistItem } from '../../hooks/useChecklist'
import { CARD_CHECKLIST_MAX, sortChecklist } from '../../lib/checklist'

/**
 * Pano kartında görevin yapılacakları (#7c54fb70) — görevin içinden "Panoda
 * göster" açıldıysa. İlk beş madde, fazlası "+N"; yazabilen kutucuğu karttan
 * işaretler. Kart sürüklenebilir ve tıklanınca açılır: kutucuk ikisini de
 * yutar, satırın yazısına tıklamak kartı açmaya devam eder.
 */
export function CardChecklist({ ticket, canEdit }: { ticket: Ticket; canEdit: boolean }) {
  const t = useT()
  const update = useUpdateChecklistItem()
  const items = sortChecklist(ticket.checklist)
  if (!ticket.checklist_on_board || items.length === 0) return null
  const shown = items.slice(0, CARD_CHECKLIST_MAX)
  const more = items.length - shown.length
  return (
    <ul className="mb-2" data-card-checklist aria-label={t('ticket.checklist.title')}>
      {shown.map((item) => {
        const pending = item.id.startsWith('tmp-')
        return (
          <li key={item.id} className="flex items-start gap-1 min-w-0">
            <button type="button" role="checkbox" aria-checked={item.done} disabled={!canEdit || pending}
              aria-label={item.done ? t('ticket.checklist.uncheck', { name: item.title }) : t('ticket.checklist.check', { name: item.title })}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); update.mutate({ ticketId: ticket.id, id: item.id, patch: { done: !item.done } }) }}
              className="tap w-6 h-6 -ml-1 flex items-center justify-center flex-shrink-0 rounded-md disabled:cursor-default group/box">
              <span className={`w-3.5 h-3.5 rounded-md border-[1.5px] flex items-center justify-center transition-colors ${item.done ? 'bg-success border-success text-white' : 'border-fg-faint group-hover/box:border-primary-500'}`}>
                {item.done && <Icon name="check" size={12} />}
              </span>
            </button>
            <span className={`text-xs leading-4 py-1 line-clamp-2 min-w-0 ${item.done ? 'line-through text-fg-faint' : 'text-fg-2'}`}>{item.title}</span>
          </li>
        )
      })}
      {more > 0 && <li className="text-2xs text-fg-faint pl-6">{t('board.card.checklistMore', { n: more })}</li>}
    </ul>
  )
}
