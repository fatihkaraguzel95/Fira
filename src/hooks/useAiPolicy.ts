import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { invalidateTicketViews } from '../lib/invalidate'
import type { DeployPolicy } from '../lib/agents'

/**
 * Go-live approval (109). May an agent put its work live by itself, must it ask
 * first, or does nothing go live — said per list (by the team's admins, here)
 * and per person (the agent's owner, in `agents.settings.deploy`); the stricter
 * of the two applies (`lib/agents.ts` `effectiveDeploy`, the server's
 * `ai_deploy_policy`). The question and its answer live on the request row.
 */
const key = (teamId: string | null) => ['ai_list_policies', teamId]

/** The lists of a team that have a go-live setting: list id → setting. A list without a row is "auto". */
export function useListPolicies(teamId: string | null) {
  return useQuery({
    queryKey: key(teamId),
    enabled: !!teamId,
    queryFn: async (): Promise<Record<string, DeployPolicy>> => {
      const { data, error } = await supabase.from('ai_list_policies').select('project_id, deploy').eq('team_id', teamId!)
      if (error) throw error
      return Object.fromEntries((data ?? []).map((r) => [r.project_id as string, r.deploy as DeployPolicy]))
    },
  })
}

export function useSetListPolicy(teamId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ projectId, deploy }: { projectId: string; deploy: DeployPolicy }) => {
      // The team is derived from the list by the server.
      const { data, error } = await supabase.from('ai_list_policies').upsert({ project_id: projectId, deploy }, { onConflict: 'project_id' }).select('project_id')
      if (error) throw error
      if (!data?.length) throw new Error('permission denied')
    },
    onMutate: async ({ projectId, deploy }) => {
      await qc.cancelQueries({ queryKey: key(teamId) })
      const prev = qc.getQueryData<Record<string, DeployPolicy>>(key(teamId))
      qc.setQueryData<Record<string, DeployPolicy>>(key(teamId), (m) => ({ ...(m ?? {}), [projectId]: deploy }))
      return prev
    },
    onError: (_e, _v, prev) => { if (prev) qc.setQueryData(key(teamId), prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: key(teamId) }),
  })
}

/** A person's yes or no to "may this go live". The server decides who may answer, and writes the comment. */
export function useDecideApproval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ requestId, approve, note }: { requestId: string; ticketId: string; approve: boolean; note?: string }) => {
      const { error } = await supabase.rpc('ai_decide_approval', { p_request: requestId, p_approve: approve, p_note: note?.trim() || null })
      if (error) throw error
    },
    onSettled: (_d, _e, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ['ai_work', ticketId] })
      invalidateTicketViews(qc, ticketId)   // the answer is a comment, too
    },
  })
}
