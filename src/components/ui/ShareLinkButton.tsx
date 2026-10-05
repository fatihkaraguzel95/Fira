import { useState } from 'react'
import { Icon } from './Icon'
import { useT } from '../../i18n'
import { copyTicketLink } from '../../lib/shareLink'

/**
 * Copies the task's link as a clickable "#ABC123" (Teams, Outlook) and as
 * `[#ABC123](…)` in plain text. On a card it appears on hover/focus — and
 * always on touch, where there is no hover; the same action is in the card's
 * context menu and in the task window, so the icon is never the only way in.
 */
export function ShareLinkButton({ id, title, className = '', shortcut }: { id: string; title?: string | null; className?: string; /** `data-shortcut` (görev penceresi: "copy-link"). */ shortcut?: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await copyTicketLink(id, title)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <button
      type="button"
      onClick={copy}
      data-shortcut={shortcut}
      onPointerDown={(e) => e.stopPropagation()}   // a card is draggable: do not start a drag
      title={copied ? t('common.copied') : t('common.copyLinkTitle')}
      aria-label={t('common.copyLink')}
      className={`tap inline-flex items-center justify-center gap-1 min-w-6 h-6 px-1 text-fg-faint hover:text-primary-600 dark:hover:text-primary-400 rounded-md transition-colors flex-shrink-0 ${className}`}
    >
      {copied ? (
        <Icon name="check" className="text-success" />
      ) : (
        <Icon name="link" />
      )}
    </button>
  )
}
