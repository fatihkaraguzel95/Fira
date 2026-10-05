import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Agent rules (107): the pages a team has marked as rules for its agents — for
 * the whole team (`project_id` null) or for one list. The page itself is an
 * ordinary page; this row only says it is a rule and whether it is required.
 * Everybody in the team reads them, the team's admins change them (RLS).
 */
export interface AgentRulePage {
  id: string
  team_id: string
  project_id: string | null
  page_id: string
  required: boolean
  order_index: number
  created_at: string
  page: { id: string; title: string; updated_at: string; archived_at: string | null } | null
}

const SELECT = 'id, team_id, project_id, page_id, required, order_index, created_at, page:pages!ai_rule_pages_page_id_fkey(id, title, updated_at, archived_at)'
const key = (teamId: string | null) => ['agent_rules', teamId]

export function useAgentRules(teamId: string | null) {
  return useQuery({
    queryKey: key(teamId),
    enabled: !!teamId,
    queryFn: async (): Promise<AgentRulePage[]> => {
      const { data, error } = await supabase.from('ai_rule_pages').select(SELECT).eq('team_id', teamId!).order('order_index').order('created_at')
      if (error) throw error
      return (data ?? []) as unknown as AgentRulePage[]
    },
  })
}

/** Mark a page as a rule of the team (no list) or of one list; it goes last in its group. */
export function useAddAgentRule(teamId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ pageId, projectId, orderIndex }: { pageId: string; projectId: string | null; orderIndex: number }) => {
      // The team is derived from the page by the server; nothing here decides it.
      const { error } = await supabase.from('ai_rule_pages').insert({ page_id: pageId, project_id: projectId, order_index: orderIndex })
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key(teamId) }),
  })
}

export function useSetAgentRuleRequired(teamId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, required }: { id: string; required: boolean }) => {
      const { data, error } = await supabase.from('ai_rule_pages').update({ required }).eq('id', id).select('id')
      if (error) throw error
      // RLS hides the row from a non-admin's update instead of refusing it.
      if (!data?.length) throw new Error('permission denied')
    },
    onMutate: async ({ id, required }) => {
      await qc.cancelQueries({ queryKey: key(teamId) })
      const prev = qc.getQueryData<AgentRulePage[]>(key(teamId))
      qc.setQueryData<AgentRulePage[]>(key(teamId), (list) => list?.map((r) => (r.id === id ? { ...r, required } : r)))
      return prev
    },
    onError: (_e, _v, prev) => { if (prev) qc.setQueryData(key(teamId), prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: key(teamId) }),
  })
}

/** The page stays; it just stops being a rule. */
export function useRemoveAgentRule(teamId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('ai_rule_pages').delete().eq('id', id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('permission denied')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key(teamId) }),
  })
}
