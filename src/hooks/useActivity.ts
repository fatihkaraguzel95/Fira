import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { TicketActivity } from '../types'

const SELECT = `
  id, ticket_id, actor_id, kind, from_value, to_value, meta, created_at,
  actor:profiles!ticket_activity_actor_id_fkey(id, email, full_name, avatar_url, source, imported_from)
`

/** Full change history of a ticket, oldest first (migration 038 writes it with triggers). */
export function useTicketActivity(ticketId: string | null) {
  return useQuery({
    queryKey: ['activity', ticketId],
    enabled: !!ticketId,
    queryFn: async (): Promise<TicketActivity[]> => {
      const { data, error } = await supabase
        .from('ticket_activity')
        .select(SELECT)
        .eq('ticket_id', ticketId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as TicketActivity[]
    },
  })
}

/**
 * When the ticket last moved into a finished column — shown next to the creation
 * date. Undefined for tickets whose history predates the activity log.
 */
export function completionEvent(activity: TicketActivity[] | undefined): TicketActivity | undefined {
  if (!activity) return undefined
  for (let i = activity.length - 1; i >= 0; i--) {
    const a = activity[i]
    if (a.kind !== 'status') continue
    const category = a.meta?.to_category as string | undefined
    return category === 'done' || category === 'closed' ? a : undefined
  }
  return undefined
}
