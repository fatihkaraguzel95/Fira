import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { parseQuery, type ParsedQuery } from '../lib/paletteQuery'
import { matchesWords, sortLikeBoard } from '../lib/linkCandidates'

export interface LinkCandidate {
  id: string
  title: string
  project_id: string
  order_index: number | null
  project: { name: string; team_id: string } | null
  status_info: { name: string; color: string; order_index: number | null } | null
}

const SELECT = 'id, title, project_id, order_index, project:projects!tickets_project_id_fkey!inner(name, team_id), status_info:ticket_statuses!tickets_status_id_fkey(name, color, order_index)'
/** Boş sorguda listenin tamamı gelir; bir liste bundan büyükse arama daraltır. */
export const LIST_LIMIT = 500
const SEARCH_LIMIT = 50

/**
 * "Görev bağla" çubuğunun adayları (#31b09040).
 *
 *  - Boş yazı: bulunulan listenin görevleri, panodaki sırayla.
 *  - Tek harf: aynı liste, başlıkta geçenler (sunucuya gitmeye değmez).
 *  - Daha fazlası: paletin sorgu dili ve sunucu araması (`palette_search`:
 *    bulanık eşleşme, atanan:ben, oluşturan:ad, durum:, öncelik:, …), bu
 *    listeyle sınırlı (098 `project_id`). `liste:ad` yazılınca takımdaki o
 *    listede arar (`team_id`). "#118F5C" kimlikleri takım içinde bulunur.
 *
 * Sonuç her zaman panodaki sırayla (`sortLikeBoard`), puana göre değil.
 */
export function useLinkCandidates({ projectId, teamId, query, enabled }: { projectId: string; teamId: string | null; query: string; enabled: boolean }) {
  const parsed = useMemo(() => parseQuery(query), [query])
  const server = parsed.searchable || parsed.shortIds.length > 0
  const key = server ? JSON.stringify([parsed.payload, parsed.shortIds]) : ''
  const [debounced, setDebounced] = useState(key)
  useEffect(() => { const h = setTimeout(() => setDebounced(key), 180); return () => clearTimeout(h) }, [key])

  const q = useQuery({
    queryKey: ['link-candidates', projectId, teamId, debounced],
    enabled: enabled && !!teamId,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<LinkCandidate[]> => {
      if (!debounced) {
        const { data, error } = await supabase.from('tickets').select(SELECT)
          .eq('project_id', projectId).is('archived_at', null).limit(LIST_LIMIT)
        if (error) throw error
        return (data ?? []) as unknown as LinkCandidate[]
      }
      const [payload, shortIds] = JSON.parse(debounced) as [ParsedQuery['payload'], string[]]
      const scope = payload.list ? { team_id: teamId! } : { project_id: projectId, team_id: teamId! }
      const searchable = payload.terms.join('').length + payload.phrases.join('').length >= 2
        || Object.keys(payload).some((k) => !['terms', 'not', 'phrases'].includes(k))
      const [found, byId] = await Promise.all([
        searchable ? supabase.rpc('palette_search', { p: { ...payload, ...scope, kinds: ['ticket'], limit: SEARCH_LIMIT } }) : Promise.resolve({ data: [], error: null }),
        Promise.all(shortIds.map((code) => supabase.rpc('ticket_by_short', { p_code: code }))),
      ])
      if (found.error) throw found.error
      const ids = [
        ...(byId as { data: { id: string }[] | null }[]).flatMap((r) => r.data ?? []).map((x) => x.id),
        ...((found.data ?? []) as { id: string; score: number }[]).filter((r) => r.score > 0).map((r) => r.id),
      ]
      if (!ids.length) return []
      const { data, error } = await supabase.from('tickets').select(SELECT)
        .in('id', [...new Set(ids)]).eq('project.team_id', teamId!).is('archived_at', null)
      if (error) throw error
      return (data ?? []) as unknown as LinkCandidate[]
    },
  })

  // Sunucuya gitmeyen tek harf burada süzülür; sonuç her durumda panodaki sırayla.
  const words = server ? [] : parsed.payload.terms
  const list = useMemo(
    () => sortLikeBoard((q.data ?? []).filter((c) => matchesWords(c.title, words)), projectId),
    [q.data, words.join(' '), projectId], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const stale = debounced !== key
  return {
    list,
    parsed,
    loading: q.isLoading || (stale && list.length === 0),
    fetching: q.isFetching || stale,
    capped: !debounced && (q.data?.length ?? 0) >= LIST_LIMIT,
  }
}
