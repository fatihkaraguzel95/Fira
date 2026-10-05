import { useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { rulePayload, type RecurrenceRule, type TicketRecurrence, type RecurrenceOccurrence } from '../lib/recurrence'

/**
 * Tekrarlayan görev serileri (#59e0b75e). Kural sunucuda yaşar (084/085); burası
 * yalnız okur ve iki RPC çağırır. Görev üretimi sunucunun işi: 5 dakikalık cron
 * üretir, liste açılışında `catchUp` aynı işi o liste için tetikler (emniyet
 * kemeri — cron durursa görev kaybolmaz, yalnız geç görünür).
 */
const KEY = 'recurrences'

/** Bir görevin serisi: görev ya şablondur ya da seriden doğmuştur. */
export function useTicketRecurrence(ticketId: string | null, recurrenceId?: string | null) {
  return useQuery({
    queryKey: [KEY, 'ticket', ticketId, recurrenceId ?? null],
    enabled: !!ticketId,
    queryFn: async (): Promise<TicketRecurrence | null> => {
      const q = supabase.from('ticket_recurrences').select('*')
      const { data, error } = recurrenceId
        ? await q.eq('id', recurrenceId).maybeSingle()
        : await q.eq('template_ticket_id', ticketId!).maybeSingle()
      if (error) throw error
      return (data as TicketRecurrence) ?? null
    },
  })
}

/** Serinin tekrar kaydı: oluşturulan, kaçırılan ve atlananlar (en yeni önce). */
export function useRecurrenceOccurrences(recurrenceId: string | null) {
  return useQuery({
    queryKey: [KEY, 'occurrences', recurrenceId],
    enabled: !!recurrenceId,
    queryFn: async (): Promise<RecurrenceOccurrence[]> => {
      const { data, error } = await supabase.from('recurrence_occurrences')
        .select('*').eq('recurrence_id', recurrenceId!).order('occurrence_no', { ascending: false }).limit(50)
      if (error) throw error
      return (data ?? []) as RecurrenceOccurrence[]
    },
  })
}

/** Listenin bütün serileri — liste ayarlarındaki bölüm ve hayalet satırlar için. */
export function useProjectRecurrences(projectId: string | null) {
  return useQuery({
    queryKey: [KEY, 'project', projectId],
    enabled: !!projectId,
    staleTime: 60_000,
    queryFn: async (): Promise<(TicketRecurrence & { template: { title: string } | null })[]> => {
      const { data, error } = await supabase.from('ticket_recurrences')
        .select('*, template:tickets!ticket_recurrences_template_ticket_id_fkey(title)')
        .eq('project_id', projectId!).order('next_at')
      if (error) throw error
      return (data ?? []) as (TicketRecurrence & { template: { title: string } | null })[]
    },
  })
}

export function useSetRecurrence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, rule }: { ticketId: string; rule: RecurrenceRule }) => {
      const { data, error } = await supabase.rpc('set_ticket_recurrence', { p_ticket: ticketId, p_rule: rulePayload(rule) })
      if (error) throw error
      return data as string
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: [KEY] })
      void qc.invalidateQueries({ queryKey: ['ticket', vars.ticketId] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}

export function useClearRecurrence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ticketId: string) => {
      const { error } = await supabase.rpc('clear_ticket_recurrence', { p_ticket: ticketId })
      if (error) throw error
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: [KEY] }) },
  })
}

/**
 * Liste açılınca gecikmiş tekrarları üretmesi için sunucuyu dürter. Sessizdir:
 * yetkisi olmayan ya da hiç serisi olmayan listede hiçbir şey olmaz. Aynı liste
 * için oturumda bir kez çağrılır (cron zaten 5 dakikada bir çalışıyor).
 */
export function useRecurrenceCatchUp(projectId: string | null) {
  const qc = useQueryClient()
  const done = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!projectId || done.current.has(projectId)) return
    done.current.add(projectId)
    void (async () => {
      const { data, error } = await supabase.rpc('generate_due_recurrences', { p_project: projectId })
      if (!error && typeof data === 'number' && data > 0) {
        void qc.invalidateQueries({ queryKey: ['tickets'] })
        void qc.invalidateQueries({ queryKey: [KEY] })
      }
    })()
  }, [projectId, qc])
}
