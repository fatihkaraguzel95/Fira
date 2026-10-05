import { useMemo } from 'react'
import { Icon } from '../ui/Icon'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useT, useLang } from '../../i18n'
import { useProjectRecurrences } from '../../hooks/useRecurrence'
import { ghostDates, ruleOf, type TicketRecurrence } from '../../lib/recurrence'

/**
 * Hayalet tekrarlar (#59e0b75e, TK-5): gelecek tekrarlar görev olarak önceden
 * üretilmez — kullanıcı kararı — ama listede görünürler. Satırlar kuraldan
 * hesaplanır (src/lib/recurrence.ts, sunucudaki motorun aynısı), soluk çizilir,
 * seçime/sürüklemeye/sayaçlara karışmaz. "Şimdi oluştur" onları gerçek göreve
 * çevirir (`materialize_occurrence`, 088).
 */
export interface Ghost {
  key: string
  recurrence: TicketRecurrence & { template?: { title: string } | null }
  date: Date
  title: string
}

/** Listenin aktif serilerinden yaklaşan tekrarlar (tarihe göre sıralı). */
export function useGhosts(projectId: string | null, enabled = true) {
  const { data: series = [] } = useProjectRecurrences(enabled ? projectId : null)
  return useMemo<Ghost[]>(() => {
    if (!enabled) return []
    const out: Ghost[] = []
    for (const r of series) {
      if (!r.active) continue
      // Hayaletler serinin kendi imlecinden (next_at) başlar: elle öne çekilen
      // tekrar imleci ilerlettiği için listeden düşer, "şimdi"den başlasaydı kalırdı.
      const cursor = new Date(new Date(r.next_at).getTime() - 1000)
      for (const d of ghostDates(ruleOf(r), cursor)) {
        out.push({ key: `${r.id}:${d.toISOString()}`, recurrence: r, date: d, title: r.template?.title ?? '' })
      }
    }
    return out.sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [series, enabled])
}

export function useMaterialize() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ recurrenceId, due }: { recurrenceId: string; due: Date }) => {
      const { data, error } = await supabase.rpc('materialize_occurrence', { p_recurrence: recurrenceId, p_due: due.toISOString() })
      if (error) throw error
      return data as string
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['recurrences'] })
    },
  })
}

/** Tablo satırı: soluk, tıklanmaz; sağında "Şimdi oluştur". */
export function GhostRow({ ghost, colSpan, pad, canWrite, onCreate, pending }: {
  ghost: Ghost; colSpan: number; pad: string; canWrite: boolean
  onCreate: () => void; pending: boolean
}) {
  const t = useT()
  const lang = useLang()
  const fmt = new Intl.DateTimeFormat(lang, {
    timeZone: ghost.recurrence.tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return (
    <tr className="group/ghost" data-ghost-row={ghost.key} title={t('ticket.recur.ghostHint')}>
      <td colSpan={colSpan} className={pad}>
        <div className="flex items-center gap-2 text-fg-faint">
          <Icon name="refresh" className="opacity-70" />
          <span className="text-sm truncate italic">{ghost.title}</span>
          <span className="text-xs tabular-nums flex-shrink-0">{fmt.format(ghost.date)}</span>
          <span className="text-2xs px-1.5 py-0.5 rounded-md border border-line-soft flex-shrink-0">{t('ticket.recur.ghost')}</span>
          {canWrite && (
            <button
              type="button"
              onClick={onCreate}
              disabled={pending}
              className="ml-auto text-xs px-2 h-6 rounded-md text-fg-2 hover:bg-raised opacity-0 group-hover/ghost:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity disabled:opacity-50 flex-shrink-0"
              data-ghost-create
            >
              {t('ticket.recur.materialize')}
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
