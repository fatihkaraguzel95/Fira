import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { notifyFromActivity } from '../lib/notify'
import { setRealtime, setOnline } from '../lib/connection'
import { useAuth } from './useAuth'

type Row = Record<string, unknown> & { id?: string; ticket_id?: string }

const RESYNC_MS = 15 * 60 * 1000
/** A channel that dies sooner than this never really worked; keep backing off. */
const STABLE_MS = 15_000

/**
 * Realtime does not deliver "a drag happened", it delivers one row change per
 * row. Dropping a card into the middle of a column renumbers every card below
 * it, so a single drag arrives as dozens of `tickets` UPDATEs — and invalidating
 * on each one refetched the whole board dozens of times. Measured on QA
 * (#602156D8): 69 board fetches in one minute, average 19 s each once they
 * queued behind the connection pool; the board looked frozen for ~30 s and the
 * card appeared not to move.
 *
 * So invalidations are collected and flushed together. `QUIET_MS` is the pause
 * that ends a burst; `MAX_WAIT_MS` caps how long a continuous stream of changes
 * can hold the refresh back, so a busy board still updates about once a second.
 */
const QUIET_MS = 250
const MAX_WAIT_MS = 1200

/**
 * Keeps the cache in sync with the database: every change on the ticket
 * tables (from another tab, another user, or an external tool) invalidates
 * the affected queries.
 *
 * The channel is self-healing: on CLOSED / CHANNEL_ERROR / TIMED_OUT it
 * re-subscribes with backoff, and whenever it (re)joins after a drop, the tab
 * becomes visible again, or the browser comes back online, everything is
 * refetched so events missed while disconnected are never lost.
 */
/**
 * Aynı anda yalnız bir abonelik olsun. İki bileşen birden bu kancayı
 * kullanınca (24 Eyl: yönetim ekranı kabuğun içine alınınca `AdminView` ile
 * `BoardPage` birlikte) ikisi de aynı adlı kanalları kuruyor, biri diğerinin
 * bağlantısını kapatıyor ve "canlı bağlantı koptu" uyarısı saniyede bir
 * yanıp sönüyordu. İkinci kopya sessizce hiçbir şey yapmaz.
 *
 * Uygulamada tek çağıran var (`BoardPage`); bu bayrak yanlışlıkla eklenen
 * ikinci bir çağrıyı **zararsız** kılmak için, aboneliği paylaştırmak için
 * değil. Gerçekten iki sahip gerekirse burası sayaçlı bir motora çevrilmeli.
 */
let owner: symbol | null = null

export function useRealtimeSync() {
  const qc = useQueryClient()
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return
    const me = Symbol('realtime')
    if (owner) return   // başka bir kopya zaten bağlı
    owner = me

    let channel: RealtimeChannel | null = null
    let retry = 0
    let retryTimer: number | undefined
    let everJoined = false
    let joinedAt = 0
    let disposed = false

    // ── Coalescing ───────────────────────────────────────────────────────────
    const pending = new Map<string, unknown[]>()
    let everything = false
    let quietTimer: number | undefined
    let firstQueuedAt = 0

    const flush = () => {
      window.clearTimeout(quietTimer)
      quietTimer = undefined
      firstQueuedAt = 0
      if (everything) {
        everything = false
        pending.clear()
        qc.invalidateQueries()
        return
      }
      const keys = [...pending.values()]
      pending.clear()
      for (const key of keys) qc.invalidateQueries({ queryKey: key })
    }

    const schedule = () => {
      const now = Date.now()
      if (!firstQueuedAt) firstQueuedAt = now
      // A long stream of changes must not postpone the refresh for ever.
      if (now - firstQueuedAt >= MAX_WAIT_MS) { flush(); return }
      window.clearTimeout(quietTimer)
      quietTimer = window.setTimeout(flush, Math.min(QUIET_MS, MAX_WAIT_MS - (now - firstQueuedAt)))
    }

    const queue = (key: unknown[]) => { pending.set(JSON.stringify(key), key); schedule() }
    const refetchAll = () => { everything = true; schedule() }

    /** Same set of views as `invalidateTicketViews`, but queued rather than immediate. */
    const queueTicketViews = (id?: string) => {
      queue(['tickets'])
      queue(['children'])
      queue(id ? ['ticket', id] : ['ticket'])
      queue(id ? ['activity', id] : ['activity'])
      queue(['status-counts'])
    }

    const ticketOf = (p: { new: Row; old: Row }) => (p.new?.ticket_id ?? p.old?.ticket_id) as string | undefined
    const perTicket = (key: string) => (p: { new: Row; old: Row }) => {
      const id = ticketOf(p)
      queue(id ? [key, id] : [key])
      queueTicketViews(id)
    }

    const subscribe = async () => {
      if (disposed) return
      // Forget the old channel *before* removing it: removal fires its CLOSED
      // callback, and that callback must not read as a drop (see below).
      if (channel) { const old = channel; channel = null; void supabase.removeChannel(old) }
      // Realtime keeps its own copy of the token; hand it the current one so a
      // refreshed session does not join with a stale (or expired) JWT.
      const { data } = await supabase.auth.getSession()
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token)
      if (disposed) return
      const ch = supabase
        .channel(`fira-db-changes-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (p) => {
          const id = ((p.new as Row)?.id ?? (p.old as Row)?.id) as string | undefined
          queue(['tickets'])
          if (id) queue(['ticket', id])
          queue(['children'])
          queue(['activity'])
          queue(['links'])
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_links' }, perTicket('links'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_comments' }, perTicket('comments'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_attachments' }, perTicket('attachments'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_assignees' }, perTicket('assignees'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_deadlines' }, perTicket('deadlines'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_checklist_items' }, perTicket('checklist'))
        // A request opening or closing is also when a card's "the agent is on this" badge comes or goes (['agent_work', team]).
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_work_requests' }, (p) => { perTicket('ai_work')(p as { new: Row; old: Row }); queue(['agent_work']) })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_activity' }, (p) => {
          perTicket('activity')(p as { new: Row; old: Row })
          // Someone else's change on a ticket this user is part of may deserve a
          // notification; the bridge decides based on their preferences.
          if ((p as { eventType?: string }).eventType === 'INSERT') void notifyFromActivity(p.new as never)
        })
        // Inbox rows are written by a trigger for this user only; RLS also filters the stream.
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` }, () => {
          queue(['notifications'])
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'system_settings' }, () => { queue(['system-settings']); queue(['admin']) })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_favorites', filter: `user_id=eq.${user.id}` }, () => { queue(['favorites']) })
        // Pages (064) carry a ticket_id too, but they are not ticket views: one prefix covers tree, task list and page.
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pages' }, () => { queue(['pages']) })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'list_views' }, () => { queue(['list_views']) })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'page_versions' }, () => { queue(['pages', 'versions']) })
      channel = ch
      ch.subscribe((status, err) => {
          // A replaced channel still reports: removing it says CLOSED. Taking
          // that for a drop scheduled another subscribe, which removed the live
          // channel, whose CLOSED scheduled the next… — a reconnect (and a full
          // refetch) every 30 s for the life of the tab (#8a26d207).
          if (ch !== channel) return
          if (status === 'SUBSCRIBED') {
            // A retry scheduled while offline would only replace this healthy channel.
            window.clearTimeout(retryTimer)
            joinedAt = Date.now()
            setRealtime('live')
            if (everJoined) refetchAll() // rejoined after a drop → catch up
            everJoined = true
            console.info('[fira] realtime bağlı')
            return
          }
          if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[fira] realtime koptu:', status, err?.message ?? '')
            setRealtime('dropped')
            if (disposed) return
            // Only a connection that held for a while earns a fresh backoff. A
            // frozen tab (or a rate limit) otherwise reconnects every second and
            // hammers a server other teams share.
            if (joinedAt && Date.now() - joinedAt > STABLE_MS) retry = 0
            joinedAt = 0
            const delay = Math.min(30_000, 1000 * 2 ** retry++)
            window.clearTimeout(retryTimer)
            retryTimer = window.setTimeout(() => { void subscribe() }, delay)
          }
        })
    }

    const ensureLive = () => {
      if (document.visibilityState !== 'visible') return
      // Refetch everything only when the channel actually dropped: while it is
      // joined, realtime already delivered every change, and a full refetch on
      // each alt-tab multiplies into a request storm behind the office NAT
      // (the whole office shares one IP and one nginx bucket — see #0CC7B9F6).
      if (!channel || channel.state !== 'joined') { retry = 0; window.clearTimeout(retryTimer); refetchAll(); void subscribe() }
    }
    const onVisibility = () => ensureLive()
    const onOnline = () => ensureLive()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    // Safety net: periodic resync while the tab is visible
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') refetchAll() }, RESYNC_MS)

    setOnline(navigator.onLine)
    void subscribe()

    // Admin "reload everyone" broadcast
    const appChannel = supabase.channel('fira-app').on('broadcast', { event: 'reload' }, () => window.location.reload()).subscribe()

    return () => {
      if (owner === me) owner = null
      supabase.removeChannel(appChannel)
      disposed = true
      window.clearTimeout(retryTimer)
      window.clearTimeout(quietTimer)   // a queued flush must not fire after unmount
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      if (channel) supabase.removeChannel(channel)
    }
  }, [qc, user?.id])
}
