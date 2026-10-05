import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import type { InboxTarget } from '../../lib/inboxBus'
import { useInbox, useMarkRead, useUnreadCount, type InboxItem } from '../../hooks/useNotifications'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { isEditableTarget, markHandled } from '../../lib/keys'
import { InboxDetail } from './InboxDetail'
import { InboxList } from './InboxList'
import { useT } from '../../i18n'

/** "Pick a notification" placeholder (the page's empty detail pane). */
export function InboxEmptyDetail() {
  const t = useT()
  return (
    <div className="max-w-xs">
      <div className="w-12 h-12 rounded-xl bg-raised text-fg-faint flex items-center justify-center mx-auto mb-3">
        <Icon name="bell" size={24} />
      </div>
      <p className="text-sm text-fg-muted">{t('inbox.selectHint')}</p>
    </div>
  )
}

const CloseIcon = () => <Icon name="close" />

/**
 * The inbox as drawers over the current view (#F6EBA5AD): the list slides out
 * beside the sidebar, and a picked notification opens its "what changed"
 * panel as a second drawer beside the list — the board (or list, or page)
 * stays in place underneath, so reading the inbox never loses your spot.
 *
 * Esc: leaves the search field first, then closes the detail, then the list.
 * A click on the dimmed area closes both. Whatever is opened from here on the
 * main screen (a ticket, the release notes) closes the drawer, and so does
 * another rail entry — BoardPage and the Sidebar do that (#f6eba5ad).
 * Rendered by BoardPage inside the main column (absolute), desktop only —
 * on a phone the sidebar still goes to the /inbox page.
 */
export function InboxDrawer({ focus, onClose, onOpenTicket, onShowChangelog }: { focus?: InboxTarget | null; onClose: () => void; onOpenTicket: (ticketId: string) => void; onShowChangelog: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref)
  const { items } = useInbox()
  const { data: unread = 0 } = useUnreadCount()
  const markRead = useMarkRead()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = items.find((n) => n.id === selectedId) ?? null

  // Opened from a toast / system notification: pick that ticket's newest
  // notification (the list is newest first) once the list has it.
  const focused = useRef<number | null>(null)
  useEffect(() => {
    if (!focus?.ticketId || focused.current === focus.nonce) return
    const hit = items.find((n) => n.ticket_id === focus.ticketId)
    if (!hit) return
    focused.current = focus.nonce
    setSelectedId(hit.id)
    if (!hit.read_at) markRead.mutate({ ids: [hit.id] })
    requestAnimationFrame(() => ref.current?.querySelector('li button[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }))
  }, [focus?.nonce, focus?.ticketId, items]) // eslint-disable-line react-hooks/exhaustive-deps

  const select = (n: InboxItem) => {
    setSelectedId((cur) => (cur === n.id ? null : n.id)) // a second click on the open row folds its detail
    if (!n.read_at) markRead.mutate({ ids: [n.id] })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    markHandled(e.nativeEvent)
    if (isEditableTarget(e.target)) { (e.target as HTMLElement).blur(); ref.current?.focus(); return }
    if (selected) setSelectedId(null)
    else onClose()
  }

  const iconBtn = 'w-8 h-8 flex items-center justify-center rounded-lg text-fg-faint hover:text-fg hover:bg-raised transition-colors'
  return (
    <>
      {/* Fixed, not absolute (#A16136B5): the inbox lies over the panel and the
          content alike, right of the rail, so a notification can be checked
          without anything underneath moving; closing it leaves all as it was. */}
      <div data-inbox-drawer className="fixed inset-0 md:top-12 md:left-16 z-40 bg-black/25 animate-fade-in" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('inbox.title')} onKeyDown={onKeyDown}
        data-inbox-drawer
        className="fixed inset-y-0 md:top-12 left-0 md:left-16 z-40 flex max-w-full outline-none">
        {/* ── The list ── */}
        <section className="w-[400px] max-w-full flex-shrink-0 bg-surface border-r border-line shadow-2xl flex flex-col min-h-0 animate-slide-in-left">
          <header className="flex items-center gap-2 pl-4 pr-2 py-2.5 border-b border-line-soft flex-shrink-0">
            <h2 className="text-sm font-semibold text-fg">{t('inbox.title')}</h2>
            {unread > 0 && <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-danger/10 text-danger">{t('inbox.unreadCount', { n: unread })}</span>}
            <button onClick={onClose} className={`${iconBtn} ml-auto`} title={t('inbox.drawer.close')} aria-label={t('inbox.drawer.close')}><CloseIcon /></button>
          </header>
          <InboxList selectedId={selectedId} onSelect={select} onOpenTicket={onOpenTicket} onShowChangelog={onShowChangelog} />
        </section>

        {/* ── What changed (second drawer) ── */}
        {selected && (
          <section key={selected.id} data-inbox-detail aria-label={t(selected.event === 'release' ? 'inbox.release.heading' : 'inbox.drawer.detail')}
            className="w-[480px] min-w-0 flex-shrink bg-app border-r border-line shadow-2xl flex flex-col min-h-0 animate-slide-in-left">
            <header className="flex items-center gap-2 pl-5 pr-2 py-2.5 border-b border-line-soft flex-shrink-0">
              <h3 className="text-sm font-semibold text-fg-2">{t(selected.event === 'release' ? 'inbox.release.heading' : 'inbox.drawer.detail')}</h3>
              <button onClick={() => setSelectedId(null)} className={`${iconBtn} ml-auto`} title={t('inbox.drawer.closeDetail')} aria-label={t('inbox.drawer.closeDetail')}><CloseIcon /></button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-5">
              <InboxDetail item={selected} onOpenTicket={onOpenTicket} onShowChangelog={onShowChangelog} />
            </div>
          </section>
        )}
      </div>
    </>
  )
}
