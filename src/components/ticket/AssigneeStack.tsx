import { useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import type { Profile } from '../../types'
import { UserAvatar } from './UserAvatar'
import { AssigneePopover } from './AssigneePopover'
import { useT } from '../../i18n'

/** Kimse atanmamışken duran işaret: kesik çizgili daire + silik kişi simgesi. */
function Empty({ label, onClick }: { label: string; onClick?: (e: React.MouseEvent) => void }) {
  const inner = (
    <Icon name="person" />
  )
  const cls = 'w-6 h-6 rounded-full border border-dashed border-fg-faint/50 bg-raised/60 text-fg-faint flex items-center justify-center flex-shrink-0'
  if (!onClick) return <span className={cls} title={label} aria-label={label} role="img">{inner}</span>
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`${cls} hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors`}
    >
      {inner}
    </button>
  )
}

interface Props {
  ticketId: string
  assignees: Profile[]
  teamId: string | null
  canEdit?: boolean
  /** How many avatars to show before "+n". */
  max?: number
  /** Show the add button always (not only on parent hover). */
  alwaysShowAdd?: boolean
}

/**
 * Stacked assignee avatars with an "add person" button that appears on parent
 * `group` hover (left of the avatars). Clicking either opens AssigneePopover.
 *
 * Kimse atanmamışsa yer boş kalmaz: kesik çizgili boş bir avatar durur
 * (#41cb2a2a). Önce yalnız başlık tonunu düşürmüştük, kullanıcı "bildiğim
 * hâlde algılayamadım" dedi — ton farkı tek başına göze çarpmıyor, boşluk
 * zaten görünmüyordu. Şimdi sahipsiz iş kendi işaretini taşıyor; tıklanınca
 * atama kutusu açılıyor, yani işaret aynı zamanda kısayol.
 */
export function AssigneeStack({ ticketId, assignees, teamId, canEdit = true, max = 3, alwaysShowAdd = false }: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setOpen((o) => !o)
  }

  return (
    <div
      ref={anchorRef}
      className="flex items-center gap-1"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Boş yer: kesik çizgili avatar. Atama yetkisi yoksa da görünür ama tıklanmaz. */}
      {assignees.length === 0 ? (
        <Empty label={t('ticketExtra.assignee.unassigned')} onClick={canEdit ? toggle : undefined} />
      ) : canEdit && (
        <button
          type="button"
          onClick={toggle}
          title={t('ticketExtra.assignee.assignPerson')}
          aria-label={t('ticketExtra.assignee.assignPerson')}
          className={`w-6 h-6 rounded-full flex items-center justify-center text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950/40 transition-opacity ${
            alwaysShowAdd || open
              ? 'opacity-100'
              // Pano kartı ve eski liste `group`, yeni liste satırı `group/row` kullanıyor;
              // yalnız `group-hover` yazılıyken düğme yeni listede hover'da hiç çıkmıyor,
              // ancak tıklayınca görünüyordu (#c8bb1e3b). Dokunmatikte hep açık.
              : 'opacity-0 group-hover:opacity-100 group-hover/row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'
          }`}
        >
          <Icon name="userAdd" />
        </button>
      )}

      {assignees.length > 0 && (
        <button
          type="button"
          onClick={toggle}
          title={assignees.map((u) => u.full_name || u.email).join(', ')}
          aria-label={t('ticketExtra.assignee.assignees')}
          className="flex -space-x-1.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          {assignees.slice(0, max).map((u) => (
            <span key={u.id} className="ring-1 ring-surface rounded-full">
              <UserAvatar user={u} size="sm" />
            </span>
          ))}
          {assignees.length > max && (
            <span className="w-6 h-6 rounded-full bg-line ring-1 ring-surface flex items-center justify-center text-2xs text-fg-muted font-medium">
              +{assignees.length - max}
            </span>
          )}
        </button>
      )}

      {open && anchorRef.current && (
        <AssigneePopover
          ticketId={ticketId}
          assignees={assignees}
          teamId={teamId}
          anchor={anchorRef.current}
          onClose={() => setOpen(false)}
          canEdit={canEdit}
        />
      )}
    </div>
  )
}
