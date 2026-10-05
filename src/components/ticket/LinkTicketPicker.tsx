import { useEffect, useMemo, useRef, useState } from 'react'
import { usePopupLayer } from '../../lib/popups'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { markHandled } from '../../lib/keys'
import { useT } from '../../i18n'

interface Candidate {
  id: string
  title: string
  project_id: string
  project: { name: string } | null
  status_info: { name: string; color: string } | null
}

interface Props {
  teamId: string | null
  /** The parent ticket — never offered. */
  excludeId: string
  /** Tickets already linked as subtasks — hidden from the list. */
  alreadyLinked: string[]
  anchor: HTMLElement
  onPick: (ticketId: string) => Promise<void> | void
  onClose: () => void
}

const WIDTH = 560
const LIMIT = 50
const CANDIDATE_SELECT = 'id, title, project_id, project:projects!tickets_project_id_fkey!inner(name, team_id), status_info:ticket_statuses!tickets_status_id_fkey(name, color)'

/**
 * Popover: search the team's tickets and pick the parent of this one. (Bağlı
 * görevler artık görev penceresindeki `LinkTicketBar` çubuğundan eklenir,
 * #31b09040; tür seçici oradaydı.)
 */
export function LinkTicketPicker({ teamId, excludeId, alreadyLinked, anchor, onPick, onClose }: Props) {
  const t = useT()
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  // The search runs on the server (a team can hold well over a thousand tickets;
  // the earlier "newest 300, filtered here" silently hid older ones). Empty query
  // = the newest LIMIT; a query = title match + the short id, in one round trip each.
  const [term, setTerm] = useState('')
  useEffect(() => { const h = setTimeout(() => setTerm(q.trim()), 200); return () => clearTimeout(h) }, [q])
  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['link-candidates', teamId, term],
    enabled: !!teamId,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<Candidate[]> => {
      const base = () => supabase
        .from('tickets')
        .select(CANDIDATE_SELECT)
        .eq('project.team_id', teamId)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(LIMIT)
      if (!term) {
        const { data, error } = await base()
        if (error) throw error
        return (data ?? []) as unknown as Candidate[]
      }
      const escaped = term.replace(/^#/, '').replace(/[%_,()\\]/g, (c) => `\\${c}`)
      const { data, error } = await base().ilike('title', `%${escaped}%`)
      if (error) throw error
      const hits = (data ?? []) as unknown as Candidate[]
      // "#118F5C" — the id the board prints; the RPC applies RLS like any query.
      if (/^#?[0-9a-f]{4,}$/i.test(term)) {
        const { data: byId } = await supabase.rpc('ticket_by_short', { p_code: term.replace(/^#/, '') })
        const ids = ((byId ?? []) as { id: string }[]).map((x) => x.id).filter((id) => !hits.some((h) => h.id === id))
        if (ids.length) {
          const { data: rows } = await supabase.from('tickets').select(CANDIDATE_SELECT).eq('project.team_id', teamId).in('id', ids)
          hits.unshift(...((rows ?? []) as unknown as Candidate[]))
        }
      }
      return hits
    },
  })

  useEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8))
      const below = window.innerHeight - r.bottom
      setPos({ top: below > 420 ? r.bottom + 6 : Math.max(8, r.top - 6 - 420), left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [anchor])

  usePopupLayer(true, ref, onClose, anchor)
  useEffect(() => {
    inputRef.current?.focus()
    const onDoc = (e: MouseEvent) => {
      const node = e.target as Node
      if (ref.current && !ref.current.contains(node) && !anchor.contains(node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { markHandled(e); e.stopPropagation(); e.preventDefault(); onClose() }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true) }
  }, [anchor, onClose])

  const list = useMemo(() => {
    const skip = new Set([excludeId, ...alreadyLinked])
    return tickets.filter((ticket) => !skip.has(ticket.id))
  }, [tickets, excludeId, alreadyLinked])
  const capped = tickets.length >= LIMIT

  const pick = async (id: string) => {
    setError(null); setBusyId(id)
    try {
      await onPick(id)
      onClose()
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? t('ticketExtra.link.failed')
      setError(msg.replace(/^.*?:\s*/, ''))
    } finally {
      setBusyId(null)
    }
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={t('ticketExtra.link.dialogLabel')}
      style={{ top: pos.top, left: pos.left, width: Math.min(WIDTH, window.innerWidth - 16), maxHeight: 420 }}
      className="fixed z-[150] flex flex-col bg-surface border border-line rounded-xl shadow-lg animate-fade-in overflow-hidden"
      onClick={stop} onMouseDown={stop} onPointerDown={stop}
    >
      <div className="p-2 border-b border-line-soft">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && list.length === 1) pick(list[0].id) }}
          placeholder={t('ticketExtra.link.searchPlaceholder')}
          className="w-full text-sm bg-field border border-line rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary-500 text-fg"
        />
        {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
      </div>
      <div className="flex-1 overflow-auto p-1.5">
        {isLoading ? (
          <p className="px-3 py-2 text-xs text-fg-faint">{t('common.loading')}</p>
        ) : list.length === 0 ? (
          <p className="px-3 py-2 text-xs text-fg-faint">{t('ticketExtra.link.noMatch')}</p>
        ) : list.map((ticket) => (
          <button
            key={ticket.id}
            disabled={busyId !== null}
            onClick={() => pick(ticket.id)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-lg hover:bg-raised disabled:opacity-60"
          >
            <span className="font-mono text-2xs text-fg-faint tabular-nums flex-shrink-0">#{ticket.id.slice(0, 6).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-fg leading-snug line-clamp-2" title={ticket.title}>{ticket.title}</span>
              <span className="block text-xs text-fg-faint truncate">{ticket.project?.name}</span>
            </span>
            {ticket.status_info && (
              <span className="chip-dyn border text-2xs px-1.5 py-0.5 rounded-md font-medium flex-shrink-0" style={{ '--c': ticket.status_info.color } as React.CSSProperties}>
                {ticket.status_info.name}
              </span>
            )}
          </button>
        ))}
        {!isLoading && capped && <p className="px-3 py-2 text-xs text-fg-faint" data-link-capped>{t('ticketExtra.link.capped', { n: LIMIT })}</p>}
      </div>
    </div>,
    document.body,
  )
}
