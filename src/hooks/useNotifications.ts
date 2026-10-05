import { useMemo } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useReleaseNote } from './useReleaseNote'
import { RELEASE_ID, type ReleaseState } from '../lib/releaseNote'
import type { NotificationEvent } from '../lib/notify'
import type { TicketMute } from '../types'

/**
 * The notification inbox (058). Rows are written by a database trigger for
 * every recipient of an activity — the same recipients the Telegram bot uses —
 * so the inbox fills whether or not a tab was open. Toasts stay realtime and
 * separate; this is the place to look afterwards.
 */
/** The linked activity row (038) — carries the before/after for the diff view. */
export interface InboxActivity {
  kind: string
  from_value: string | null
  to_value: string | null
  meta: Record<string, unknown> | null
}

/** What a list row needs from that activity: the status chip's historical colour. */
export interface InboxActivityBrief { kind: string; to_color: string | null }

/** Inbox rows also carry things that are not a ticket event (073: team invites,
 *  090: someone accepted an invitation and joined; `release`: Fira was updated —
 *  that one is not a database row, see `releaseItem`). */
export type InboxEvent = NotificationEvent | 'team_invite' | 'team_joined' | 'release'

export interface InboxItem {
  id: string
  event: InboxEvent
  /** Null on rows that are not about a ticket (team invite). */
  ticket_id: string | null
  project_id: string | null
  ticket_title: string
  value: string | null
  created_at: string
  read_at: string | null
  /** Number of same-task updates folded into this notification (060); 1 = none. */
  group_count: number
  /** When the first folded update landed — the window the detail view lists. */
  group_started_at: string | null
  actor: { id?: string; full_name: string | null; email: string | null; avatar_url: string | null } | null
  /** Team invite rows (073): which team, and the invitation to accept or decline. */
  team_id: string | null
  invitation_id: string | null
  team: { name: string } | null
  /** The list the ticket lives in, with what it takes to draw its chip. */
  project: { name: string; icon: string | null; icon_url: string | null; color: { hex: string } | null } | null
  /** The activity row id; its full content is fetched by the open panel (useInboxActivity). */
  activity_id: string | null
  activity: InboxActivityBrief | null
}

const SELECT = [
  'id, event, ticket_id, project_id, ticket_title, value, created_at, read_at, group_count, group_started_at, team_id, invitation_id, activity_id',
  'team:teams!user_notifications_team_id_fkey(name)',
  'actor:profiles!user_notifications_actor_id_fkey(id, full_name, email, avatar_url)',
  'project:projects!user_notifications_project_id_fkey(name, icon, icon_url, color:team_colors!projects_color_id_fkey(hex))',
  // Only what the row draws: the rest of the activity is fetched when its panel opens.
  'activity:ticket_activity!user_notifications_activity_id_fkey(kind, to_color:meta->>to_color)',
].join(', ')

/**
 * "Fira was updated" in the shape of an inbox row (#2aa4f068). It lives in the
 * account's preferences (`lib/releaseNote.ts`), not in `user_notifications`:
 * there is one per account however many versions it covers, and its id never
 * goes to the server — the read/unread hooks below peel it off.
 */
function releaseItem(s: ReleaseState): InboxItem {
  return {
    id: RELEASE_ID, event: 'release', ticket_id: null, project_id: null,
    ticket_title: `Fira v${s.version}`, value: s.version,
    created_at: s.at, read_at: s.read ? s.at : null,
    group_count: 1, group_started_at: null, actor: null,
    team_id: null, invitation_id: null, team: null, project: null,
    activity_id: null, activity: null,
  }
}

/** One page of the inbox (#44b1a977): the list grows as it is scrolled. */
export const INBOX_PAGE = 50
/** Filtering/searching keeps loading pages, but not forever. */
export const INBOX_MAX_PAGES = 10

/** Exact predicates go to the server so page 1 is already the right list. */
export interface InboxFilters { unreadOnly?: boolean; projectId?: string | null; ticketId?: string | null }

/**
 * The inbox list, 50 rows at a time (#44b1a977). It used to fetch 150 rows with
 * every embed in one go — 160 KB before the drawer could draw a single line.
 * The "what changed" panel needs the activity row, but only for the one
 * notification that is open, so that embed moved to `useInboxActivity`.
 */
export function useInbox(filters: InboxFilters = {}, enabled = true) {
  const { user } = useAuth()
  const { unreadOnly = false, projectId = null, ticketId = null } = filters
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'inbox', { unreadOnly, projectId, ticketId }],
    enabled: !!user && enabled,
    staleTime: 30_000,
    initialPageParam: 0,
    getNextPageParam: (last: InboxItem[], pages) => (last.length < INBOX_PAGE ? undefined : pages.length * INBOX_PAGE),
    queryFn: async ({ pageParam }) => {
      let req = supabase.from('user_notifications').select(SELECT)
      if (unreadOnly) req = req.is('read_at', null)
      if (projectId) req = req.eq('project_id', projectId)
      if (ticketId) req = req.eq('ticket_id', ticketId)
      const { data, error } = await req
        .order('created_at', { ascending: false })
        .range(pageParam as number, (pageParam as number) + INBOX_PAGE - 1)
      if (error) throw error
      return (data ?? []) as unknown as InboxItem[]
    },
  })
  const release = useReleaseNote().state
  const items = useMemo(() => {
    const rows = (q.data?.pages ?? []).flat()
    if (!release || projectId || ticketId || (unreadOnly && release.read) || !q.data) return rows
    // In date order like any other row; while older pages are still to come it
    // waits for the page it belongs to rather than sitting at the end of this one.
    const since = Date.parse(release.at)
    const at = rows.findIndex((n) => Date.parse(n.created_at) < since)
    if (at < 0 && q.hasNextPage) return rows
    const out = rows.slice()
    out.splice(at < 0 ? rows.length : at, 0, releaseItem(release))
    return out
  }, [q.data, q.hasNextPage, release, unreadOnly, projectId, ticketId])
  return { ...q, items }
}

/**
 * Warms the first page before the drawer is asked for (hover on the rail's
 * inbox button): opening then costs a render, not a round trip.
 */
export function usePrefetchInbox() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return () => {
    if (!user) return
    void qc.prefetchInfiniteQuery({
      queryKey: ['notifications', 'inbox', { unreadOnly: false, projectId: null, ticketId: null }],
      initialPageParam: 0,
      staleTime: 30_000,
      queryFn: async ({ pageParam }) => {
        const { data, error } = await supabase.from('user_notifications').select(SELECT)
          .order('created_at', { ascending: false })
          .range(pageParam as number, (pageParam as number) + INBOX_PAGE - 1)
        if (error) throw error
        return (data ?? []) as unknown as InboxItem[]
      },
    })
  }
}

/** The activity behind one notification — fetched when its panel opens. */
export function useInboxActivity(activityId: string | null) {
  return useQuery({
    queryKey: ['notifications', 'activity', activityId],
    enabled: !!activityId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<InboxActivity | null> => {
      const { data, error } = await supabase
        .from('ticket_activity').select('kind, from_value, to_value, meta').eq('id', activityId!).maybeSingle()
      if (error) throw error
      return (data as InboxActivity) ?? null
    },
  })
}

export function useUnreadCount() {
  const { user } = useAuth()
  // The release row counts like any other unread one; the cache keeps the server's number.
  const extra = useReleaseNote().unread ? 1 : 0
  return useQuery({
    queryKey: ['notifications', 'unread'],
    enabled: !!user,
    select: (n: number) => n + extra,
    // Realtime invalidates this on every insert/update; the interval is the safety net.
    refetchInterval: 90_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('user_notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null)
      if (error) throw error
      return count ?? 0
    },
  })
}

/**
 * The tickets this user has muted (062). Kept as one small query rather than a
 * per-row lookup: the inbox renders 150 rows and the toast path checks every
 * incoming activity, so both want the whole set in memory.
 */
export function useTicketMutes() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['ticket-mutes'],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<TicketMute[]> => {
      const { data, error } = await supabase
        .from('ticket_mutes')
        .select('ticket_id, created_at, ticket:tickets!ticket_mutes_ticket_id_fkey(title, project_id)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as TicketMute[]
    },
  })
}

/** Muted ticket ids as a Set — what callers actually ask ("is this one muted?"). */
export function useMutedIds(): Set<string> {
  const { data = [] } = useTicketMutes()
  return useMemo(() => new Set(data.map((m) => m.ticket_id)), [data])
}

export function useToggleMute() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async ({ ticketId, muted }: { ticketId: string; muted: boolean }) => {
      if (muted) {
        const { error } = await supabase.from('ticket_mutes').insert({ user_id: user!.id, ticket_id: ticketId })
        if (error && error.code !== '23505') throw error // already muted is not a failure
      } else {
        const { error } = await supabase.from('ticket_mutes').delete().eq('ticket_id', ticketId)
        if (error) throw error
      }
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['ticket-mutes'] }) },
  })
}

/** The same request without the release row's id; null when nothing is left for the server. */
function serverArg(arg: { ids?: string[]; ticketId?: string }): { ids?: string[]; ticketId?: string } | null {
  if (!arg.ids) return arg
  const ids = arg.ids.filter((id) => id !== RELEASE_ID)
  return ids.length ? { ...arg, ids } : null
}

/** Undo of {@link useMarkRead}: puts a row back in the unread pile. */
export function useMarkUnread() {
  const qc = useQueryClient()
  const release = useReleaseNote()
  return useMutation({
    mutationFn: async (raw: { ids?: string[]; ticketId?: string }) => {
      if (raw.ids?.includes(RELEASE_ID)) release.setRead(false)
      const arg = serverArg(raw)
      if (!arg) return
      const { error } = await supabase.rpc('mark_notifications_unread', { p_ids: arg.ids ?? null, p_ticket: arg.ticketId ?? null })
      if (error) throw error
    },
    onMutate: async (raw) => {
      const arg = serverArg(raw) ?? { ids: [] }
      await qc.cancelQueries({ queryKey: ['notifications'] })
      const prevInbox = qc.getQueryData<InboxItem[]>(['notifications', 'inbox'])
      const prevUnread = qc.getQueryData<number>(['notifications', 'unread'])
      const hit = (n: InboxItem) => !!n.read_at && (arg.ids ? arg.ids.includes(n.id) : arg.ticketId ? n.ticket_id === arg.ticketId : false)
      let marked = 0
      if (prevInbox) {
        qc.setQueryData<InboxItem[]>(['notifications', 'inbox'], prevInbox.map((n) => (hit(n) ? (marked++, { ...n, read_at: null }) : n)))
      }
      if (prevUnread !== undefined) qc.setQueryData<number>(['notifications', 'unread'], prevUnread + (prevInbox ? marked : arg.ids?.length ?? 0))
      return { prevInbox, prevUnread }
    },
    onError: (_e, _a, ctx) => {
      if (ctx?.prevInbox) qc.setQueryData(['notifications', 'inbox'], ctx.prevInbox)
      if (ctx?.prevUnread !== undefined) qc.setQueryData(['notifications', 'unread'], ctx.prevUnread)
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['notifications'] }) },
  })
}

/** ids → those; ticketId → that ticket's; neither → everything. Optimistic on both caches. */
export function useMarkRead() {
  const qc = useQueryClient()
  const release = useReleaseNote()
  return useMutation({
    mutationFn: async (raw: { ids?: string[]; ticketId?: string }) => {
      // "Everything" and the release row's own id both read the release row.
      if (release.unread && !raw.ticketId && (!raw.ids || raw.ids.includes(RELEASE_ID))) release.setRead(true)
      const arg = serverArg(raw)
      if (!arg) return
      const { error } = await supabase.rpc('mark_notifications_read', { p_ids: arg.ids ?? null, p_ticket: arg.ticketId ?? null })
      if (error) throw error
    },
    onMutate: async (raw) => {
      const arg = serverArg(raw) ?? { ids: [] }
      await qc.cancelQueries({ queryKey: ['notifications'] })
      const prevInbox = qc.getQueryData<InboxItem[]>(['notifications', 'inbox'])
      const prevUnread = qc.getQueryData<number>(['notifications', 'unread'])
      const now = new Date().toISOString()
      const hit = (n: InboxItem) => !n.read_at && (arg.ids ? arg.ids.includes(n.id) : arg.ticketId ? n.ticket_id === arg.ticketId : true)
      let marked = 0
      if (prevInbox) {
        qc.setQueryData<InboxItem[]>(['notifications', 'inbox'], prevInbox.map((n) => (hit(n) ? (marked++, { ...n, read_at: now }) : n)))
      }
      if (prevUnread !== undefined) {
        // Without a loaded inbox we cannot count what "all" or "this ticket" covers precisely; go to zero for "all".
        qc.setQueryData<number>(['notifications', 'unread'], !arg.ids && !arg.ticketId ? 0 : Math.max(0, prevUnread - (prevInbox ? marked : arg.ids?.length ?? 0)))
      }
      return { prevInbox, prevUnread }
    },
    onError: (_e, _a, ctx) => {
      if (ctx?.prevInbox) qc.setQueryData(['notifications', 'inbox'], ctx.prevInbox)
      if (ctx?.prevUnread !== undefined) qc.setQueryData(['notifications', 'unread'], ctx.prevUnread)
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['notifications'] }) },
  })
}
