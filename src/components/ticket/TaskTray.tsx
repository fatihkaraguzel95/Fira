import { useNavigate } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { openTicket } from '../../lib/nav'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useT } from '../../i18n'
import { useTray, useDraftIds } from '../../hooks/useTray'
import { StatusIndicator } from './StatusIndicator'
import type { StatusCategory } from '../../types'

/**
 * Küçültülmüş görevler çubuğu (#e6b8797c) — sağ altta, içeriğin üstünde duran
 * yarı saydam şerit. Görev penceresindeki "küçült" düğmesi pencereyi kapatır ve
 * görevi buraya bırakır; satıra tıklayınca pencere aynı yerden açılır.
 *
 * ClickUp'ın Task Tray'i ile aynı fikir: yarım kalan iş gözden kaybolmasın.
 * Sıra ve içerik `user_preferences`ta (global kapsam), yani sekme değiştirince
 * ya da başka bilgisayardan girince de duruyor. Yorum taslağı olan satırda
 * sarı nokta var (taslak metnin kendisi de sunucuda, `useCommentDraft`).
 */
interface Row { id: string; title: string; status: { name: string; color: string; category: StatusCategory; is_cancelled: boolean } | null }

export function TaskTray({ hidden = false }: { hidden?: boolean }) {
  const t = useT()
  const navigate = useNavigate()
  const { ids, remove, clear } = useTray()
  const drafts = useDraftIds()

  const { data: rows = [] } = useQuery({
    queryKey: ['tray-tickets', ids],
    enabled: ids.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('tickets')
        .select('id, title, status:ticket_statuses!tickets_status_id_fkey(name, color, category, is_cancelled)')
        .in('id', ids.slice(0, 12))
      if (error) throw error
      return (data ?? []) as unknown as Row[]
    },
  })

  if (hidden || ids.length === 0) return null
  const byId = new Map(rows.map((r) => [r.id, r]))

  return (
    <div
      className="fixed bottom-3 right-3 z-30 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-line-soft bg-surface/85 backdrop-blur-md shadow-2xl overflow-hidden"
      data-task-tray
      role="region"
      aria-label={t('ticket.tray.aria')}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line-soft">
        <Icon name="text" className="text-fg-faint" />
        <span className="text-xs font-semibold text-fg-muted uppercase tracking-wider">{t('ticket.tray.title')}</span>
        <span className="text-2xs text-fg-faint tabular-nums">{ids.length}</span>
        <button type="button" onClick={clear} className="ml-auto text-xs text-fg-faint hover:text-fg-2 px-1 rounded-md">{t('ticket.tray.clear')}</button>
      </div>
      <ul className="max-h-64 overflow-y-auto scrollbar-thin divide-y divide-line-soft">
        {ids.map((id) => {
          const row = byId.get(id)
          return (
            <li key={id} className="group flex items-center gap-2 px-2 py-1.5 hover:bg-raised" data-tray-row={id}>
              {row?.status ? <StatusIndicator status={row.status} size={12} /> : <span className="w-3 h-3 rounded-full bg-line flex-shrink-0" aria-hidden />}
              <button
                type="button"
                onClick={() => { remove(id); openTicket(navigate, id) }}
                className="flex-1 min-w-0 text-left text-sm text-fg truncate cursor-pointer"
                title={row?.title ?? ''}
              >
                {row?.title || t('ticket.untitled')}
              </button>
              {drafts.has(id) && (
                <span className="w-1.5 h-1.5 rounded-full bg-warning flex-shrink-0" title={t('ticket.tray.draft')} aria-label={t('ticket.tray.draft')} />
              )}
              <button
                type="button"
                onClick={() => remove(id)}
                aria-label={t('ticket.tray.remove')}
                title={t('ticket.tray.remove')}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 text-fg-faint hover:text-fg-2 px-1 flex-shrink-0"
              >
                <Icon name="close" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
