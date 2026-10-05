import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { ParsedQuery } from '../lib/paletteQuery'

/**
 * Server search behind the top bar's command palette (#43a865fb). The query is
 * parsed on the client (src/lib/paletteQuery.ts: words, "phrases", -exclusions,
 * #ids, filters) and sent as one structure to `palette_search` (migration 082),
 * which matches typo-tolerantly and Turkish-aware under RLS — every team the
 * viewer belongs to. Debounced; only while the palette is open and there is
 * something to search. "#118F5C" ids go through `ticket_by_short` and lead.
 */
export interface PaletteHit {
  kind: 'ticket' | 'project' | 'page'
  id: string
  title: string
  /** The list a task lives in / the team a list or page belongs to. */
  projectId?: string | null
  projectName?: string | null
  teamId?: string | null
  icon?: string | null
  /** For a page hit: which of the three it is (114). The server says it in `icon`; a text page says nothing. */
  pageKind?: 'page' | 'drawing' | 'whiteboard'
  iconUrl?: string | null
  statusName?: string | null
  statusColor?: string | null
  score?: number
}

interface Row {
  kind: PaletteHit['kind']; id: string; title: string; project_id: string | null; project_name: string | null; team_id: string | null
  icon: string | null; icon_url: string | null; status_name: string | null; status_color: string | null; score: number
}

export function usePaletteSearch(parsed: ParsedQuery, enabled: boolean) {
  const payload = { ...parsed.payload, limit: 20 }
  const key = JSON.stringify([payload, parsed.shortIds])
  const [debounced, setDebounced] = useState(key)
  useEffect(() => { const h = setTimeout(() => setDebounced(key), 180); return () => clearTimeout(h) }, [key])
  const active = enabled && (parsed.searchable || parsed.shortIds.length > 0)

  return useQuery({
    queryKey: ['palette-search', debounced],
    enabled: active,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<PaletteHit[]> => {
      const [p, ids] = JSON.parse(debounced) as [typeof payload, string[]]
      const searchable = p.terms.join('').length + p.phrases.join('').length >= 2 || Object.keys(p).some((k) => !['terms', 'not', 'phrases', 'limit'].includes(k))
      const [found, byId] = await Promise.all([
        searchable ? supabase.rpc('palette_search', { p }) : Promise.resolve({ data: [] as Row[], error: null }),
        ids.length ? Promise.all(ids.map((code) => supabase.rpc('ticket_by_short', { p_code: code }))) : Promise.resolve([]),
      ])
      if (found.error) throw found.error
      const rows = ((found.data ?? []) as Row[]).filter((r) => r.score > 0)
      const idHits = (byId as { data: { id: string }[] | null }[]).flatMap((r) => r.data ?? []).map((x) => x.id).filter((id) => !rows.some((r) => r.id === id))
      const lead: PaletteHit[] = []
      if (idHits.length) {
        const { data } = await supabase.from('tickets')
          .select('id, title, project_id, project:projects!tickets_project_id_fkey(name, team_id), status_info:ticket_statuses!tickets_status_id_fkey(name, color)')
          .in('id', idHits.slice(0, 5)).is('archived_at', null)
        type T = { id: string; title: string; project_id: string | null; project: { name: string; team_id: string } | null; status_info: { name: string; color: string } | null }
        for (const t of (data ?? []) as unknown as T[]) {
          lead.push({ kind: 'ticket', id: t.id, title: t.title, projectId: t.project_id, projectName: t.project?.name ?? null, teamId: t.project?.team_id ?? null, statusName: t.status_info?.name ?? null, statusColor: t.status_info?.color ?? null, score: 1 })
        }
      }
      return [
        ...lead,
        ...rows.map((r): PaletteHit => ({
          kind: r.kind, id: r.id, title: r.title, projectId: r.project_id, projectName: r.project_name, teamId: r.team_id,
          icon: r.icon, iconUrl: r.icon_url, statusName: r.status_name, statusColor: r.status_color, score: r.score,
          ...(r.kind === 'page' ? { pageKind: r.icon === 'drawing' || r.icon === 'whiteboard' ? r.icon : 'page' as const } : {}),
        })),
      ]
    },
  })
}
