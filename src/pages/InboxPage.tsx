import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Icon } from '../components/ui/Icon'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { openTicket, go } from '../lib/nav'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import { useInbox, useMarkRead, useUnreadCount, type InboxItem } from '../hooks/useNotifications'
import { FiraLogo } from '../components/ui/Logo'
import { InboxDetail } from '../components/inbox/InboxDetail'
import { InboxList } from '../components/inbox/InboxList'
import { InboxEmptyDetail } from '../components/inbox/InboxDrawer'
import { useT } from '../i18n'

const ChangelogModal = lazy(() => import('../components/ChangelogModal').then((m) => ({ default: m.ChangelogModal })))

/**
 * The activity inbox as a full page. On a desktop the sidebar opens it as a
 * drawer beside the board instead (`InboxDrawer`, #F6EBA5AD); this page serves
 * phones and direct links. The list itself is shared (`InboxList`).
 */
export function InboxPage() {
  const t = useT()
  useRealtimeSync()
  const navigate = useNavigate()
  const { items } = useInbox()
  const { data: unread = 0 } = useUnreadCount()
  const markRead = useMarkRead()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showChangelog, setShowChangelog] = useState(false)
  // ?ticket=… (a notification tapped on a phone): pick that ticket's newest one.
  const [params] = useSearchParams()
  const wanted = params.get('ticket')
  const picked = useRef(false)
  useEffect(() => {
    if (!wanted || picked.current) return
    const hit = items.find((n) => n.ticket_id === wanted)
    if (!hit) return
    picked.current = true
    setSelectedId(hit.id)
    if (!hit.read_at) markRead.mutate({ ids: [hit.id] })
  }, [wanted, items]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = items.find((n) => n.id === selectedId) ?? null
  const select = (n: InboxItem) => {
    setSelectedId(n.id)
    if (!n.read_at) markRead.mutate({ ids: [n.id] })
  }
  const openTicketRow = (ticketId: string) => openTicket(navigate, ticketId)
  const backBtn = 'text-xs text-fg-muted hover:text-fg'

  return (
    <div className="h-[100dvh] flex flex-col bg-app">
      {/* Header */}
      <header data-wco-pad className="bg-surface border-b border-line-soft px-4 md:px-6 py-2 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => go(navigate, '/')} className="flex items-center" title={t('inbox.backToBoard')} aria-label={t('inbox.backToBoard')}><FiraLogo size={26} className="text-fg" /></button>
        <span className="text-sm font-semibold text-fg-2">{t('inbox.title')}</span>
        {unread > 0 && <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-danger/10 text-danger">{t('inbox.unreadCount', { n: unread })}</span>}
        <button onClick={() => go(navigate, '/')} className={`${backBtn} ml-auto`}>← {t('inbox.board')}</button>
      </header>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* ── List ── */}
        <aside className={`w-full md:w-[400px] flex-shrink-0 md:border-r border-line-soft bg-surface flex flex-col min-h-0 ${selected ? 'hidden md:flex' : 'flex'}`}>
          <InboxList selectedId={selectedId} onSelect={select} onOpenTicket={openTicketRow} onShowChangelog={() => setShowChangelog(true)} />
        </aside>

        {/* ── Detail ── */}
        <main className={`flex-1 min-w-0 min-h-0 overflow-y-auto p-5 md:p-8 ${selected ? 'block' : 'hidden md:block'}`}>
          {selected ? (
            <>
              <button onClick={() => setSelectedId(null)} className="md:hidden mb-4 text-xs text-fg-muted hover:text-fg flex items-center gap-1">
                <Icon name="chevronLeft" />
                {t('inbox.list')}
              </button>
              <div className="max-w-lg h-full"><InboxDetail item={selected} onOpenTicket={openTicketRow} onShowChangelog={() => setShowChangelog(true)} /></div>
            </>
          ) : (
            <div className="hidden md:flex h-full items-center justify-center text-center"><InboxEmptyDetail /></div>
          )}
        </main>
      </div>
      {showChangelog && <Suspense fallback={null}><ChangelogModal onClose={() => setShowChangelog(false)} /></Suspense>}
    </div>
  )
}
