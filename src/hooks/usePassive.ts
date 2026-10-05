import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { PassiveRow } from '../lib/agentStats'

/**
 * Passive jobs (110, #0fc67dbb): one-call jobs without tools, done by the runner of a person who
 * lends their subscription while it is idle. A team's content goes to a model for these jobs only
 * when the team turned the job on: the switches live in `ai_team_passive`, off until an admin of
 * the team sets them. No row means everything is off.
 */
export interface TeamPassive { image_text: boolean; translate: boolean }
/** What was read from a picture (`file_texts`, status done). */
export interface FileText { text: string | null; description: string | null; lang: string | null; model: string | null }
const OFF: TeamPassive = { image_text: false, translate: false }
const key = (teamId: string | null) => ['ai_team_passive', teamId]

export function useTeamPassive(teamId: string | null) {
  return useQuery({
    queryKey: key(teamId),
    enabled: !!teamId,
    queryFn: async (): Promise<TeamPassive> => {
      const { data, error } = await supabase.from('ai_team_passive').select('image_text, translate').eq('team_id', teamId!).maybeSingle()
      if (error) throw error
      return { image_text: data?.image_text === true, translate: data?.translate === true }
    },
  })
}

export function useSetTeamPassive(teamId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<TeamPassive>) => {
      const now = qc.getQueryData<TeamPassive>(key(teamId)) ?? OFF
      const { data, error } = await supabase.from('ai_team_passive').upsert({ team_id: teamId, ...now, ...patch }, { onConflict: 'team_id' }).select('team_id')
      if (error) throw error
      if (!data?.length) throw new Error('permission denied')
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: key(teamId) })
      const prev = qc.getQueryData<TeamPassive>(key(teamId))
      qc.setQueryData<TeamPassive>(key(teamId), (m) => ({ ...(m ?? OFF), ...patch }))
      return prev
    },
    onError: (_e, _v, prev) => { qc.setQueryData(key(teamId), prev ?? OFF) },
    onSettled: () => qc.invalidateQueries({ queryKey: key(teamId) }),
  })
}

/** The text read from one picture, or null when it has not been read (the team's switch is off, or no runner got to it yet). */
export function useFileText(url: string | null) {
  return useQuery({
    queryKey: ['file_text', url],
    enabled: !!url,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FileText | null> => {
      const { data, error } = await supabase.from('file_texts').select('text, description, lang, model').eq('file_url', url!).eq('status', 'done').maybeSingle()
      if (error) throw error
      return (data as FileText | null) ?? null
    },
  })
}

/**
 * The finished passive jobs of a period, for the agent panel: what they took, apart from the agents' runs.
 * Who sees which rows is the server's word (the team's members read their team's results).
 */
export function usePassiveJobs({ since, until = null, teamId, agentProfileId }: { since: Date | null; until?: Date | null; teamId?: string | null; agentProfileId?: string | null }) {
  const from = since ? since.toISOString() : null
  const to = until ? until.toISOString() : null
  return useQuery({
    queryKey: ['passive_jobs', from, to, teamId ?? null, agentProfileId ?? null],
    queryFn: async (): Promise<PassiveRow[]> => {
      // Two tables, one shape: pictures read (110) and texts looked at for translation (113).
      // A text that settled without a call has no row here that counts (no time, no translation).
      const ask = async (table: 'file_texts' | 'content_translations', kind: PassiveRow['kind']) => {
        let q = supabase.from(table).select(kind === 'translate' ? 'ms, cost_usd, status' : 'ms, cost_usd').limit(5000)
        q = kind === 'translate' ? q.in('status', ['done', 'none']).not('ms', 'is', null) : q.eq('status', 'done')
        if (from) q = q.gte('finished_at', from)
        if (to) q = q.lt('finished_at', to)
        if (teamId) q = q.eq('team_id', teamId)
        if (agentProfileId) q = q.eq('claimed_by', agentProfileId)
        const { data, error } = await q
        if (error) throw error
        return ((data ?? []) as unknown as { ms: number | null; cost_usd: number | string | null; status?: string }[]).map((r): PassiveRow => ({ ms: r.ms, cost_usd: r.cost_usd, kind, translated: kind === 'translate' ? r.status === 'done' : undefined }))
      }
      const [pictures, texts] = await Promise.all([ask('file_texts', 'image_text'), ask('content_translations', 'translate')])
      return [...pictures, ...texts]
    },
    staleTime: 30_000,
  })
}
