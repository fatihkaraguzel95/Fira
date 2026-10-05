import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, type IconName } from '../ui/Icon'
import { useAvatarColor } from '../../lib/avatarTone'
import { displayUrl } from '../../lib/storage'
import { useQueryClient } from '@tanstack/react-query'
import { useRespondToInvitation } from '../../hooks/useTeams'
import { ROLE_LABELS, type TeamRole } from '../../types'
import { useInbox, useMarkRead, useMarkUnread, useMutedIds, useToggleMute, INBOX_PAGE, INBOX_MAX_PAGES, type InboxItem, type InboxEvent } from '../../hooks/useNotifications'

/** Göreve değil takıma ait satır (davet, katılma): ayrıntı paneli yok, alt satırı roldür. */
const isTeamRow = (e: InboxEvent) => e === 'team_invite' || e === 'team_joined'
import { VERB, plainText } from '../../lib/notify'
import { ListAvatar } from '../ui/ListIcon'
import { ContextMenu } from '../board/ContextMenu'
import { displayTime, exactTime, useDateFormat } from '../../lib/time'
import { useT } from '../../i18n'
import { useImageOk } from '../../hooks/useImageOk'
import { FiraMark } from '../ui/Logo'

/**
 * Accept or decline a team invitation straight from the inbox row (#4B5442B6).
 * Both calls go through the same RPCs the invitation banner uses, so the row
 * disappears (the database drops it) as soon as the invitation is answered.
 */
function InviteActions({ id, role }: { id: string; role: string | null }) {
  const t = useT()
  const respond = useRespondToInvitation()
  const qc = useQueryClient()
  const answer = (accept: boolean) => {
    respond.mutate({ id, accept }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['notifications'] })
      },
    })
  }
  void role
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); answer(true) }}
        disabled={respond.isPending}
        className="px-2 py-0.5 rounded-md bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-50"
      >
        {t('inbox.invite.accept')}
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); answer(false) }}
        disabled={respond.isPending}
        className="px-2 py-0.5 rounded-md text-fg-muted hover:bg-raised disabled:opacity-50"
      >
        {t('inbox.invite.decline')}
      </button>
    </span>
  )
}

/**
 * The inbox list — search, read filter, day groups, per-row menu. Shared by the
 * inbox page (phones) and the inbox drawer beside the board (#F6EBA5AD): both
 * show the same rows and act the same way; only the frame around them differs.
 */
type Translate = ReturnType<typeof useT>

export const actorName = (a: InboxItem['actor'], t: Translate) => a?.full_name || a?.email || t('common.someoneElse')
const initials = (a: InboxItem['actor']) =>
  (a?.full_name || a?.email || '?').split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2)

/** Where the actor's face goes on the release row: Fira itself did it. */
const FiraFace = () => (
  <span className="w-6 h-6 rounded-full bg-raised flex items-center justify-center flex-shrink-0"><FiraMark size={13} className="text-fg" /></span>
)

/**
 * The release row's second line: the newest version's one-line summary. The
 * release notes are a lazy chunk of their own, so the line starts as a plain
 * hint and fills in once they arrive (they are needed for the detail anyway).
 */
function ReleaseSummary({ version }: { version: string }) {
  const t = useT()
  const [summary, setSummary] = useState<string | null>(null)
  useEffect(() => {
    let on = true
    void import('../../changelog').then((m) => { if (on) setSummary(m.CHANGELOG.find((r) => r.version === version)?.summary ?? null) }).catch(() => {})
    return () => { on = false }
  }, [version])
  return <>{summary ?? t('inbox.release.hint')}</>
}

/** The actor's face next to their name. `InboxItem.actor` is a thin projection,
 *  not a full `Profile`, so `UserAvatar` (which wants one) does not fit here. */
function ActorFace({ actor }: { actor: InboxItem['actor'] }) {
  const photo = useImageOk(actor?.avatar_url)
  // Each person in their own colour (#4029f71c): everyone was the same blue, the list could not be scanned by who.
  const tone = useAvatarColor(actor?.id ?? actor?.full_name ?? actor?.email)
  if (photo.ok) return <img src={displayUrl(actor?.avatar_url) ?? ''} alt="" onError={photo.onError} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
  return (
    <span style={{ backgroundColor: tone }} className="w-6 h-6 rounded-full text-white flex items-center justify-center text-2xs font-semibold flex-shrink-0">
      {initials(actor)}
    </span>
  )
}

/**
 * The status a row is about, in that status' own colour. The colour travels in
 * the activity's `meta.to_color` (038), so a renamed or deleted status still
 * renders the way it looked when it happened.
 */
function StatusChip({ item }: { item: InboxItem }) {
  const color = item.activity?.to_color ?? null
  const text = plainText(item.value ?? '')
  if (!text) return null
  return (
    <span
      className={`chip-dyn inline-flex items-center gap-1 border text-2xs font-semibold px-1.5 py-0.5 rounded-md align-middle ${color ? '' : 'opacity-80'}`}
      style={{ '--c': color ?? '#6b7280' } as React.CSSProperties}
    >
      <span className="chip-dot w-1.5 h-1.5 rounded-full" />
      {text}
    </span>
  )
}

function dayLabel(iso: string, now: Date, t: Translate) {
  const d = new Date(iso)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diff = Math.floor((start - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000)
  if (diff <= 0) return t('inbox.day.today')
  if (diff === 1) return t('inbox.day.yesterday')
  if (diff < 7) return t('inbox.day.thisWeek')
  if (diff < 30) return t('inbox.day.thisMonth')
  return t('inbox.day.older')
}

/** Rows in the shape of the real ones, so the drawer has something to show
 *  while the first page is on its way (#44b1a977). */
function InboxSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line-soft" aria-hidden data-inbox-skeleton>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex items-start gap-2.5">
          <span className="w-7 h-7 rounded-full bg-raised animate-pulse flex-shrink-0" />
          <span className="flex-1 min-w-0 space-y-1.5">
            <span className="block h-3 rounded-md bg-raised animate-pulse" style={{ width: `${70 - (i % 3) * 12}%` }} />
            <span className="block h-2.5 rounded-md bg-raised animate-pulse" style={{ width: `${45 - (i % 2) * 10}%` }} />
          </span>
        </div>
      ))}
    </div>
  )
}

export function InboxList({ selectedId, onSelect, onOpenTicket, onShowChangelog, autoFocusSearch }: {
  selectedId: string | null
  onSelect: (n: InboxItem) => void
  onOpenTicket: (ticketId: string) => void
  onShowChangelog: () => void
  autoFocusSearch?: boolean
}) {
  const t = useT()
  useDateFormat()   // repaint when the chosen date format changes
  const [query, setQuery] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  // Scoping the inbox itself — set by clicking a row's list chip or its id.
  const [projectId, setProjectId] = useState<string | null>(null)
  const [ticketId, setTicketId] = useState<string | null>(null)
  // Exact filters go to the server so the first 50 rows are already the right ones;
  // the free-text search stays here and keeps pulling pages while it is on.
  const { items, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useInbox({ unreadOnly, projectId, ticketId })
  const markRead = useMarkRead()
  const markUnread = useMarkUnread()
  const toggleMute = useToggleMute()
  const muted = useMutedIds()

  // Which row's action menu is open, and where it was summoned from.
  const [rowMenu, setRowMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  const now = new Date()
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    return items.filter((n) => {
      // unread / list / ticket are filtered by the server; kept here for the rows
      // already in the cache when a filter is switched on.
      if (unreadOnly && n.read_at) return false
      if (projectId && n.project_id !== projectId) return false
      if (ticketId && n.ticket_id !== ticketId) return false
      if (!q) return true
      return [n.ticket_title, n.value ?? '', n.actor?.full_name ?? '', n.actor?.email ?? '', n.project?.name ?? '']
        .join(' ').toLocaleLowerCase('tr').includes(q)
    })
  }, [items, query, unreadOnly, projectId, ticketId])

  const scopeName = projectId ? items.find((n) => n.project_id === projectId)?.project?.name ?? t('inbox.scope.someList') : null
  const scopeTicket = ticketId ? items.find((n) => n.ticket_id === ticketId)?.ticket_title ?? t('inbox.scope.someTicket') : null

  // Group the filtered list by day, keeping the newest-first order.
  const groups = useMemo(() => {
    const out: { label: string; items: InboxItem[] }[] = []
    for (const n of filtered) {
      const label = dayLabel(n.created_at, now, t)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(n)
      else out.push({ label, items: [n] })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, t])

  const filtering = !!query.trim() || unreadOnly || !!projectId || !!ticketId

  // The end of the list pulls the next page; a running text search keeps pulling
  // (the search itself is local, so it can only find what is loaded) up to the cap.
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage()
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, filtered.length])
  useEffect(() => {
    if (!query.trim() || !hasNextPage || isFetchingNextPage) return
    if (items.length >= INBOX_PAGE * INBOX_MAX_PAGES) return
    const h = window.setTimeout(() => void fetchNextPage(), 150)
    return () => window.clearTimeout(h)
  }, [query, items.length, hasNextPage, isFetchingNextPage, fetchNextPage])
  const visibleUnreadIds = filtered.filter((n) => !n.read_at).map((n) => n.id)
  const markVisible = () => {
    if (filtering) { if (visibleUnreadIds.length) markRead.mutate({ ids: visibleUnreadIds }) }
    else markRead.mutate({})
  }
  const clearFilters = () => { setQuery(''); setUnreadOnly(false); setProjectId(null); setTicketId(null) }

  /** The open row's menu entries — read state decides between read/unread. */
  const menuFor = (n: InboxItem) => {
    const isMuted = !!n.ticket_id && muted.has(n.ticket_id)
    const icon = (name: IconName) => <Icon name={name} />
    const readToggle = n.read_at
      ? {
          label: t('inbox.markUnread'),
          icon: icon('mailUnread'),
          onClick: () => markUnread.mutate({ ids: [n.id] }),
        }
      : {
          label: t('inbox.markReadOne'),
          icon: icon('check'),
          onClick: () => markRead.mutate({ ids: [n.id] }),
        }
    // The release row is about no ticket: nothing to open or to mute.
    if (n.event === 'release') {
      return [
        { label: t('inbox.release.all'), icon: icon('page'), onClick: onShowChangelog },
        readToggle,
      ]
    }
    return [
      {
        label: t('inbox.openTicket'),
        icon: icon('open'),
        onClick: () => n.ticket_id && onOpenTicket(n.ticket_id),
      },
      readToggle,
      {
        label: isMuted ? t('inbox.follow') : t('inbox.unfollow'),
        icon: isMuted
          ? icon('bell')
          : icon('bellOff'),
        onClick: () => n.ticket_id && toggleMute.mutate({ ticketId: n.ticket_id, muted: !isMuted }),
      },
    ]
  }
  const menuItem = rowMenu ? items.find((n) => n.id === rowMenu.id) ?? null : null

  return (
    <>
      {/* Toolbar */}
      <div className="p-3 border-b border-line-soft space-y-2 flex-shrink-0">
        <div className="relative">
          <Icon name="search" className="text-fg-faint absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('inbox.searchPlaceholder')}
            aria-label={t('inbox.searchPlaceholder')}
            autoFocus={autoFocusSearch}
            className="w-full bg-field border border-line rounded-lg pl-9 pr-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setUnreadOnly(false)} aria-pressed={!unreadOnly} className={`text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${!unreadOnly ? 'bg-primary-600 text-white' : 'text-fg-2 hover:bg-raised'}`}>{t('common.all')}</button>
          <button onClick={() => setUnreadOnly(true)} aria-pressed={unreadOnly} className={`text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${unreadOnly ? 'bg-primary-600 text-white' : 'text-fg-2 hover:bg-raised'}`}>{t('inbox.unreadOnly')}</button>
          <button
            onClick={markVisible}
            disabled={visibleUnreadIds.length === 0}
            className="ml-auto text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline disabled:text-fg-faint disabled:no-underline disabled:cursor-default"
          >
            {filtering ? t('inbox.markVisibleRead', { n: visibleUnreadIds.length }) : t('inbox.markAllRead')}
          </button>
        </div>
        {(scopeName || scopeTicket) && (
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Icon name="filter" className="text-fg-faint" />
            <span className="truncate">{scopeTicket ? t('inbox.scope.ticket', { name: scopeTicket }) : t('inbox.scope.list', { name: scopeName ?? '' })}</span>
          </p>
        )}
      </div>

      {/* Rows */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin">
        {isLoading ? (
          <InboxSkeleton />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-fg-faint">
            {items.length === 0 ? t('inbox.empty') : t('inbox.emptyFiltered')}
            {filtering && items.length > 0 && (
              <button onClick={clearFilters} className="block mx-auto mt-3 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
                {t('inbox.filter.clear')}
              </button>
            )}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <p className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm px-4 py-1.5 text-xs font-semibold text-fg-faint uppercase tracking-wider">{g.label}</p>
              {/* A hairline between rows: each row is three stacked lines,
                  and without a separator two rows read as one paragraph. */}
              <ul className="divide-y divide-line-soft">
                {g.items.map((n) => {
                  const on = n.id === selectedId
                  const isMuted = !!n.ticket_id && muted.has(n.ticket_id)
                  return (
                    <li
                      key={n.id}
                      data-inbox-row={n.event}
                      onContextMenu={(e) => { e.preventDefault(); setRowMenu({ id: n.id, x: e.clientX, y: e.clientY }) }}
                      className={`relative border-l-2 transition-colors ${on ? 'bg-raised border-primary-500' : 'border-transparent hover:bg-raised/60'}`}
                    >
                      {/* Body — one click target for "show me this one" */}
                      <button
                        onClick={() => { if (!isTeamRow(n.event)) onSelect(n); else if (!n.read_at) markRead.mutate({ ids: [n.id] }) }}
                        aria-current={on ? 'true' : undefined}
                        className="w-full text-left px-4 pt-2.5 pb-1 flex items-start gap-2.5"
                      >
                        <span className={`mt-2.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${n.read_at ? 'bg-transparent' : 'bg-primary-500'}`} aria-hidden />
                        {n.event === 'release' ? <FiraFace /> : <ActorFace actor={n.actor} />}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-fg-2 leading-snug pr-14">
                            {/* Hatırlatmanın aktörü yoktur: "Biri" demek yerine cümleyi tek başına kurar (085). */}
                            {n.event !== 'reminder' && (
                              <><span className={n.read_at ? '' : 'font-semibold text-fg'}>{n.event === 'release' ? 'Fira' : actorName(n.actor, t)}</span>{' '}</>
                            )}
                            {n.event === 'release'
                              ? t('inbox.release.text', { version: n.value ?? '' })
                              : n.event === 'team_invite'
                              ? t('inbox.invite.text', { team: n.team?.name ?? n.ticket_title })
                              : n.event === 'team_joined'
                              ? t('inbox.joined.text', { team: n.team?.name ?? n.ticket_title })
                              : n.event === 'status'
                                ? <>{t('inbox.statusBefore')}<StatusChip item={n} />{t('inbox.statusAfter')}</>
                                : VERB[n.event](plainText(n.value ?? ''))}
                            {n.group_count > 1 && <span className="inline-block ml-1.5 align-middle text-2xs font-semibold px-1.5 py-0.5 rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-400">+{n.group_count - 1}</span>}
                          </span>
                          <span className={`block text-xs truncate mt-0.5 ${isMuted ? 'text-fg-faint line-through decoration-fg-faint/50' : 'text-fg-faint'}`}>
                            {n.event === 'release'
                              ? <ReleaseSummary version={n.value ?? ''} />
                              : isTeamRow(n.event) ? t('inbox.invite.role', { role: t(ROLE_LABELS[(n.value as TeamRole) ?? 'member'] ?? ROLE_LABELS.member) }) : n.ticket_title}
                          </span>
                        </span>
                      </button>

                      {/* Timestamp, top right */}
                      <time
                        className="absolute top-2.5 right-3 text-xs text-fg-faint pointer-events-none"
                        dateTime={n.created_at}
                        title={exactTime(n.created_at)}
                      >
                        {displayTime(n.created_at, now)}
                      </time>

                      {/* Footer: where it lives (click to scope) + per-row actions */}
                      <div className="pl-[3.4rem] pr-3 pb-2 flex items-center gap-1.5 text-xs">
                        {n.project && n.project_id && (
                          <button
                            onClick={() => { setProjectId(n.project_id); setTicketId(null) }}
                            title={t('inbox.onlyThisList', { name: n.project.name })}
                            className="inline-flex items-center gap-1.5 max-w-[9rem] px-1 py-0.5 -mx-1 rounded-md text-fg-muted hover:text-fg hover:bg-raised transition-colors"
                          >
                            <ListAvatar icon={n.project.icon} iconUrl={n.project.icon_url} color={n.project.color?.hex ?? null} size="sm" />
                            <span className="truncate">{n.project.name}</span>
                          </button>
                        )}
                        {n.ticket_id && (
                          <button
                            onClick={() => { setTicketId(n.ticket_id); setProjectId(null) }}
                            title={t('inbox.onlyThisTicket')}
                            className="font-mono text-fg-faint hover:text-fg px-1 py-0.5 rounded-md hover:bg-raised transition-colors"
                          >
                            #{n.ticket_id.slice(0, 6).toUpperCase()}
                          </button>
                        )}
                        {n.event === 'team_invite' && n.invitation_id && (
                          <InviteActions id={n.invitation_id} role={n.value} />
                        )}

                        {/* The row's own actions live in a menu; right-click on
                            the row opens the same one. */}
                        <button
                          onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setRowMenu({ id: n.id, x: r.right - 176, y: r.bottom + 4 }) }}
                          title={t('inbox.rowMenu')}
                          aria-label={t('inbox.rowMenu')}
                          aria-haspopup="menu"
                          className={`ml-auto px-1 rounded-md leading-none transition-colors ${isMuted ? 'text-warning' : 'text-fg-faint hover:text-fg hover:bg-raised'}`}
                        >
                          {isMuted ? (
                            <Icon name="bellOff" />
                          ) : (
                            <Icon name="more" />
                          )}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))
        )}

        {/* Growing list (#44b1a977): the next 50 load as the end comes into view. */}
        {hasNextPage && (
          <div ref={sentinel} className="p-3">
            {isFetchingNextPage ? <InboxSkeleton rows={3} /> : (
              <button onClick={() => void fetchNextPage()} className="mx-auto block text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
                {t('inbox.loadMore')}
              </button>
            )}
          </div>
        )}

        {/* The way back out of a filter, at the end of what it left you. */}
        {filtering && filtered.length > 0 && (
          <div className="p-4 text-center border-t border-line-soft">
            <button onClick={clearFilters} className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
              {t('inbox.filter.clear')}
            </button>
          </div>
        )}
      </div>

      {rowMenu && menuItem && (
        <ContextMenu items={menuFor(menuItem)} x={rowMenu.x} y={rowMenu.y} onClose={() => setRowMenu(null)} />
      )}
    </>
  )
}
