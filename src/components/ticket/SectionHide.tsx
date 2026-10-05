import { useT } from '../../i18n'
import { Icon } from '../ui/Icon'

/**
 * Boş bölümü yeniden gizleyen ✕ (#7c54fb70). Aksiyon listesinden açılıp içine
 * bir şey eklenmemiş bölümün başlığında, başlığın üzerine gelince görünür
 * (başlık `group/sec`); klavyede odakta, dokunmatikte her zaman görünür.
 * Bölümler yalnız boşken verir: içi dolu bölüm gizlenmez.
 */
export function SectionHide({ name, onHide }: { name: string; onHide: () => void }) {
  const t = useT()
  return (
    <button type="button" onClick={onHide} title={t('ticket.section.hide')} aria-label={t('ticket.section.hideAria', { name })} data-section-hide
      className="-my-1 w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-raised opacity-0 group-hover/sec:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
      <Icon name="close" />
    </button>
  )
}
