import { useSortable } from '@dnd-kit/sortable'
import { Icon } from '../ui/Icon'
import { CSS } from '@dnd-kit/utilities'
import { useT } from '../../i18n'

/**
 * Ana sayfa panelinin bir bölümü (#C2C27B51): başlığından katlanır, yine
 * başlığından sürüklenip sıralanır.
 *
 * Başlık iki ayrı şey taşıyor, bu yüzden tek bir düğme değil: solda katlama
 * düğmesi (chevron + etiket), sağda tutamak. Sürükleme dinleyicileri yalnız
 * tutamakta — yoksa katlamak için yapılan her tıklama sürükleme başlatıyordu.
 */
export function HomeSection({ id, label, open, onToggle, count, children, sortable = true }: {
  id: string
  label: string
  open: boolean
  onToggle: () => void
  count?: number
  children: React.ReactNode
  sortable?: boolean
}) {
  const t = useT()
  const s = useSortable({ id, disabled: !sortable })
  return (
    <div
      ref={s.setNodeRef}
      style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition, opacity: s.isDragging ? 0.6 : 1 }}
      className="group/sec"
    >
      <div className="w-full px-3 pt-4 pb-1 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
        >
          <span className="flex-1 text-xs font-semibold text-fg-muted truncate">{label}</span>
          {typeof count === 'number' && count > 0 && <span className="text-2xs text-fg-faint tabular-nums">{count}</span>}
          <Icon name="chevronDown" className={`text-fg-faint transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        {sortable && (
          <button
            type="button"
            {...s.attributes}
            {...s.listeners}
            aria-label={t('board.home.dragSection', { name: label })}
            title={t('board.home.dragSection', { name: label })}
            className="w-5 h-5 flex items-center justify-center rounded-md text-fg-faint opacity-0 group-hover/sec:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 hover:text-fg-2 cursor-move touch-none transition-opacity"
          >
            <Icon name="grip" />
          </button>
        )}
      </div>
      {open && children}
    </div>
  )
}
