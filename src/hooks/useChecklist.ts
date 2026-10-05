import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { currentUser } from '../lib/session'
import { patchTicketEverywhere, restoreTicketViews, snapshotTicketViews } from '../lib/optimistic'
import { CHECKLIST_TITLE_MAX, nextChecklistOrder, sortChecklist } from '../lib/checklist'
import type { ChecklistItem } from '../types'

/**
 * Görev içi yapılacaklar (#7c54fb70). Görev penceresi kendi sorgusunu okur
 * (`['checklist', id]`); pano kartı ve liste aynı maddeleri görev satırına
 * gömülü alır (`checklist`). Her değişiklik ikisine birden anında yazılır, hata
 * olursa ikisi de geri alınır; başka ekranları canlı yayın (`useRealtimeSync`)
 * tazeler — bu yüzden her işaretlemede panonun bütün sorgusu yeniden çekilmez.
 */
const key = (ticketId: string) => ['checklist', ticketId] as const
const COLUMNS = 'id, ticket_id, title, done, order_index, done_by, done_at, created_by, created_at'

export function useChecklist(ticketId: string | null | undefined) {
  return useQuery({
    queryKey: key(ticketId ?? ''),
    enabled: !!ticketId,
    queryFn: async () => {
      const { data, error } = await supabase.from('ticket_checklist_items').select(COLUMNS).eq('ticket_id', ticketId!)
      if (error) throw error
      return sortChecklist((data ?? []) as ChecklistItem[])
    },
  })
}

/** Aynı değişiklik pencerenin listesine ve kartların gömülü kopyasına. */
function patchItems(qc: QueryClient, ticketId: string, fn: (items: ChecklistItem[]) => ChecklistItem[]) {
  qc.setQueryData<ChecklistItem[]>(key(ticketId), (cur) => (cur ? fn(cur) : cur))
  patchTicketEverywhere(qc, ticketId, (t) => ({ ...t, checklist: fn(t.checklist ?? []) }))
}

/** Değişiklik öncesi hâl: hata olursa geri koymak için. */
async function snapshot(qc: QueryClient, ticketId: string) {
  await qc.cancelQueries({ queryKey: key(ticketId) })
  return { list: qc.getQueryData<ChecklistItem[]>(key(ticketId)), views: await snapshotTicketViews(qc, ticketId) }
}
function restore(qc: QueryClient, ticketId: string, snap: Awaited<ReturnType<typeof snapshot>> | undefined) {
  if (!snap) return
  qc.setQueryData(key(ticketId), snap.list)
  restoreTicketViews(qc, snap.views)
}

/** Bir ya da birkaç madde ekler (yapıştırılan liste birden çok satır olabilir), sona. */
export function useAddChecklistItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, items }: { ticketId: string; items: { title: string; done?: boolean }[] }) => {
      const user = await currentUser()
      if (!user) throw new Error('Oturum bulunamadı')
      const base = nextChecklistOrder(qc.getQueryData<ChecklistItem[]>(key(ticketId)))
      const rows = items.map((it, i) => ({ ticket_id: ticketId, title: it.title.trim().slice(0, CHECKLIST_TITLE_MAX), done: !!it.done, order_index: base + i, created_by: user.id }))
      const { data, error } = await supabase.from('ticket_checklist_items').insert(rows).select(COLUMNS)
      if (error) throw error
      return (data ?? []) as ChecklistItem[]
    },
    onMutate: async ({ ticketId, items }) => {
      const snap = await snapshot(qc, ticketId)
      const base = nextChecklistOrder(snap.list)
      const temp = items.map((it, i) => ({ id: `tmp-${Date.now()}-${i}`, ticket_id: ticketId, title: it.title.trim(), done: !!it.done, order_index: base + i }))
      patchItems(qc, ticketId, (cur) => [...cur, ...temp])
      return snap
    },
    onError: (_e, { ticketId }, snap) => restore(qc, ticketId, snap),
    onSettled: (_d, _e, { ticketId }) => qc.invalidateQueries({ queryKey: key(ticketId) }),
  })
}

/** Başlık ya da işaret değişir. */
export function useUpdateChecklistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { ticketId: string; id: string; patch: Partial<Pick<ChecklistItem, 'title' | 'done'>> }) => {
      const { error } = await supabase.from('ticket_checklist_items').update(patch).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ ticketId, id, patch }) => {
      const snap = await snapshot(qc, ticketId)
      patchItems(qc, ticketId, (cur) => cur.map((i) => (i.id === id ? { ...i, ...patch } : i)))
      return snap
    },
    onError: (_e, { ticketId }, snap) => restore(qc, ticketId, snap),
    onSettled: (_d, _e, { ticketId }) => qc.invalidateQueries({ queryKey: key(ticketId) }),
  })
}

export function useDeleteChecklistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { ticketId: string; id: string }) => {
      const { error } = await supabase.from('ticket_checklist_items').delete().eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ ticketId, id }) => {
      const snap = await snapshot(qc, ticketId)
      patchItems(qc, ticketId, (cur) => cur.filter((i) => i.id !== id))
      return snap
    },
    onError: (_e, { ticketId }, snap) => restore(qc, ticketId, snap),
    onSettled: (_d, _e, { ticketId }) => qc.invalidateQueries({ queryKey: key(ticketId) }),
  })
}

/** Sürükle-bırak: yeni sıra baştan numaralanır, yalnız yeri değişenler yazılır. */
export function useReorderChecklist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ordered }: { ticketId: string; ordered: ChecklistItem[] }) => {
      const changed = ordered.map((it, i) => ({ it, i })).filter(({ it, i }) => it.order_index !== i && !it.id.startsWith('tmp-'))
      const results = await Promise.all(changed.map(({ it, i }) => supabase.from('ticket_checklist_items').update({ order_index: i }).eq('id', it.id)))
      const failed = results.find((r) => r.error)
      if (failed?.error) throw failed.error
    },
    onMutate: async ({ ticketId, ordered }) => {
      const snap = await snapshot(qc, ticketId)
      const next = ordered.map((it, i) => ({ ...it, order_index: i }))
      patchItems(qc, ticketId, () => next)
      return snap
    },
    onError: (_e, { ticketId }, snap) => restore(qc, ticketId, snap),
    onSettled: (_d, _e, { ticketId }) => qc.invalidateQueries({ queryKey: key(ticketId) }),
  })
}

/** Maddeler pano kartında görünsün mü (görevin kendi ayarı). */
export function useSetChecklistOnBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, on }: { ticketId: string; on: boolean }) => {
      const user = await currentUser()
      const { error } = await supabase.from('tickets').update({ checklist_on_board: on, ...(user ? { updated_by: user.id } : {}) }).eq('id', ticketId)
      if (error) throw error
    },
    onMutate: async ({ ticketId, on }) => {
      const views = await snapshotTicketViews(qc, ticketId)
      patchTicketEverywhere(qc, ticketId, (t) => ({ ...t, checklist_on_board: on }))
      return views
    },
    onError: (_e, _v, views) => restoreTicketViews(qc, views),
  })
}
