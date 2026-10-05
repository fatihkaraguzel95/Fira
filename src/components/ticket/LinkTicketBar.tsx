import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../ui/Icon'
import { usePopupLayer } from '../../lib/popups'
import { createPortal } from 'react-dom'
import { LINK_KIND_LABELS, type LinkKind } from '../../types'
import { useT } from '../../i18n'
import { markHandled } from '../../lib/keys'
import { useAddLink } from '../../hooks/useLinks'
import { useLinkCandidates, LIST_LIMIT, type LinkCandidate } from '../../hooks/useLinkCandidates'

/** Seçicide sunulan sıra: varsayılan "İlişkili" başta. */
const KINDS: LinkKind[] = ['relates', 'blocks', 'waits_for', 'duplicates']
const DROP_MAX = 320

interface Props {
  ticketId: string
  projectId: string
  teamId: string
  /** Sunulmayacak görevler: kendisi, bağlı olanlar, alt görevleri. */
  exclude: string[]
  /** Aksiyon listesinden açıldı: çubuğa odaklan. */
  autoFocus?: boolean
  /** Bölüm boşken vazgeçildi (Vazgeç ya da boş çubukta Esc): bölümü gizle. */
  onGiveUp?: () => void
}

/**
 * Bağlı Görevler'in ekleme çubuğu (#31b09040). Alt görev ve yapılacaklar
 * kutusu gibi satır boyunca uzanır; eskiden başlığın sağında sıkışık bir
 * "Görev bağla" bağlantısı ve üstte tür düğmeleri olan açılır pencereydi.
 *
 *  - Odaklanınca altında adaylar açılır: bu listenin görevleri, panodaki
 *    sırayla. Yazınca paletin araması (bulanık, atanan:ben, oluşturan:ad, …).
 *  - Çubuk etkinken sağında zorunlu "ilişki türü" (varsayılan İlişkili),
 *    Ekle ve Vazgeç. Aday seçmek onu çubuğa koyar; Ekle (ya da Enter) bağlar.
 */
export function LinkTicketBar({ ticketId, projectId, teamId, exclude, autoFocus = false, onGiveUp }: Props) {
  const t = useT()
  const addLink = useAddLink()
  const listId = useId()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [selected, setSelected] = useState<LinkCandidate | null>(null)
  const [kind, setKind] = useState<LinkKind>('relates')
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const { list: all, parsed, loading, fetching, capped } = useLinkCandidates({ projectId, teamId, query: q, enabled: open || focused })
  const list = useMemo(() => { const skip = new Set(exclude); return all.filter((c) => !skip.has(c.id)) }, [all, exclude])
  const activeIdx = Math.min(active, Math.max(list.length - 1, 0))
  const engaged = focused || !!selected || !!q

  // Aksiyondan açılan bölüm pencerenin altında kalabiliyor: çubuk ortaya gelsin
  // ki liste aşağı açılıp üstteki özellikleri örtmesin.
  useEffect(() => {
    if (!autoFocus) return
    barRef.current?.scrollIntoView({ block: 'center' })
    inputRef.current?.focus({ preventScroll: true })
    setOpen(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive(0) }, [q])

  // Açılır liste gövdede (pencere kaydırılabilir; içeride kırpılırdı), çubuğun
  // altında; altta yer yoksa üstünde.
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = barRef.current?.getBoundingClientRect()
      if (!r) return
      const up = window.innerHeight - r.bottom < DROP_MAX + 12 && r.top > window.innerHeight - r.bottom
      setPos({ top: up ? r.top - 6 : r.bottom + 6, left: r.left, width: r.width, up })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])
  usePopupLayer(open, dropRef, () => setOpen(false), barRef.current)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const n = e.target as Node
      if (!barRef.current?.contains(n) && !dropRef.current?.contains(n)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  useEffect(() => { dropRef.current?.querySelector(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' }) }, [activeIdx])

  const choose = (c: LinkCandidate) => { setSelected(c); setQ(''); setOpen(false); setError(null); inputRef.current?.focus() }
  const reset = () => { setQ(''); setSelected(null); setKind('relates'); setError(null); setOpen(false) }
  const submit = async () => {
    if (!selected || addLink.isPending) return
    setError(null)
    try {
      await addLink.mutateAsync({ ticketId, linkedTicketId: selected.id, kind })
      reset()
      inputRef.current?.focus()
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? t('ticketExtra.link.failed')
      setError(msg.replace(/^.*?:\s*/, ''))
    }
  }
  const giveUp = () => {
    reset()
    inputRef.current?.blur()
    onGiveUp?.()
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      if (!list.length) return
      setActive((i) => (Math.min(i, list.length - 1) + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && list[activeIdx]) choose(list[activeIdx])
      else if (selected) void submit()
    } else if (e.key === 'Escape') {
      markHandled(e.nativeEvent); e.preventDefault()
      if (open) setOpen(false)
      else if (q || selected) reset()
      else giveUp()
    } else if (e.key === 'Backspace' && !q && selected) {
      setSelected(null)
    }
  }

  const kindLabel = (k: LinkKind) => t(LINK_KIND_LABELS[k].out)
  const otherList = (c: LinkCandidate) => c.project_id !== projectId

  return (
    <div data-link-bar>
      <div
        ref={barRef}
        onFocus={() => setFocused(true)}
        onBlur={(e) => { if (!barRef.current?.contains(e.relatedTarget as Node | null)) setFocused(false) }}
        className="flex flex-wrap items-center gap-2"
      >
        <span className="w-6 h-6 flex items-center justify-center text-fg-faint flex-shrink-0" aria-hidden>
          <Icon name="plus" />
        </span>
        <div className={`flex-1 min-w-[12rem] flex items-center gap-1.5 rounded-md border transition-all ${engaged ? 'bg-field border-line px-1.5' : 'bg-transparent border-transparent px-1'}`}>
          {selected && (
            <span data-link-selected className="inline-flex items-center gap-1.5 max-w-[70%] my-1 pl-2 pr-1 py-0.5 rounded-md bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 text-sm">
              <span className="font-mono text-2xs tabular-nums opacity-80">#{selected.id.slice(0, 6).toUpperCase()}</span>
              <span className="truncate">{selected.title}</span>
              <button type="button" onClick={() => { setSelected(null); inputRef.current?.focus() }} title={t('ticket.link.clearChoice')} aria-label={t('ticket.link.clearChoice')}
                className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-primary-100 dark:hover:bg-primary-900/50">
                <Icon name="close" />
              </button>
            </span>
          )}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSelected(null); setOpen(true); setError(null) }}
            onClick={() => { if (!selected) setOpen(true) }}
            onFocus={() => { if (!selected) setOpen(true) }}
            onBlur={() => setOpen(false)}
            onKeyDown={onKey}
            placeholder={selected ? '' : t('ticket.link.barPlaceholder')}
            aria-label={t('ticket.link.barAria')}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && list.length ? `${listId}-${activeIdx}` : undefined}
            data-link-input
            className="flex-1 min-w-0 text-sm py-1.5 bg-transparent text-fg-2 placeholder-fg-faint focus:outline-none"
          />
        </div>
        {engaged && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <label className="sr-only" htmlFor={`${listId}-kind`}>{t('ticket.link.kindField')}</label>
            <select id={`${listId}-kind`} value={kind} required aria-required onChange={(e) => setKind(e.target.value as LinkKind)}
              title={`${t('ticket.link.kindField')}: ${t(LINK_KIND_LABELS[kind].hint)}`} data-link-kind
              className="h-8 text-xs bg-field border border-line rounded-md px-2 text-fg-2 focus:outline-none focus:ring-2 focus:ring-primary-500">
              {KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
            </select>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void submit()} disabled={!selected || addLink.isPending} data-link-add
              className="h-8 text-xs bg-primary-600 text-white px-3 rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed">{t('common.add')}</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={giveUp} data-link-cancel
              className="h-8 text-xs px-2.5 rounded-lg text-fg-2 hover:bg-raised">{t('common.giveUp')}</button>
          </div>
        )}
      </div>
      {error && <p className="mt-1 ml-8 text-xs text-danger" role="alert">{error}</p>}

      {open && pos && createPortal(
        <div
          ref={dropRef}
          id={listId}
          role="listbox"
          aria-label={t('ticket.link.resultsAria')}
          aria-busy={fetching}
          onMouseDown={(e) => e.preventDefault()}   // odak çubukta kalsın
          style={{ left: pos.left, width: Math.max(pos.width, 320), maxHeight: DROP_MAX, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
          className="fixed z-[150] flex flex-col bg-surface border border-line rounded-xl shadow-lg animate-fade-in overflow-hidden"
          data-link-results
        >
          {parsed.chips.length > 0 && (
            <div className="px-3 pt-2 pb-1 flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-fg-faint">{t('board.palette.filterChips')}</span>
              {parsed.chips.map((c, i) => (
                <span key={i} title={c.ok ? undefined : t('board.palette.filterBad')}
                  className={`text-2xs px-1.5 py-0.5 rounded-md border ${c.ok ? 'border-primary-200 dark:border-primary-900 bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300' : 'border-danger/40 bg-danger/10 text-danger line-through'}`}>
                  {c.name}:{c.value}
                </span>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto scrollbar-thin p-1">
            {loading ? (
              <p className="px-3 py-2 text-xs text-fg-faint">{t('common.loading')}</p>
            ) : list.length === 0 ? (
              <p className="px-3 py-2 text-xs text-fg-faint">{t('ticketExtra.link.noMatch')}</p>
            ) : list.map((c, i) => (
              <div
                key={c.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === activeIdx}
                data-idx={i}
                data-link-option={c.id}
                onMouseMove={() => { if (i !== activeIdx) setActive(i) }}
                onClick={() => choose(c)}
                className={`px-2 py-1.5 rounded-lg flex items-center gap-2.5 cursor-pointer ${i === activeIdx ? 'bg-primary-50 dark:bg-primary-950/40' : ''}`}
              >
                {c.status_info ? (
                  <span className="chip-dyn border text-2xs px-1.5 py-0.5 rounded-md font-medium flex-shrink-0 w-24 truncate text-center" style={{ '--c': c.status_info.color } as React.CSSProperties}>{c.status_info.name}</span>
                ) : <span className="w-24 flex-shrink-0" />}
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm truncate ${i === activeIdx ? 'text-primary-700 dark:text-primary-300' : 'text-fg'}`} title={c.title}>{c.title}</span>
                  {otherList(c) && <span className="block text-xs text-fg-faint truncate">{c.project?.name}</span>}
                </span>
                <span className="text-2xs font-mono tabular-nums text-fg-faint flex-shrink-0">#{c.id.slice(0, 6).toUpperCase()}</span>
              </div>
            ))}
            {!loading && capped && <p className="px-3 py-2 text-xs text-fg-faint">{t('ticketExtra.link.capped', { n: LIST_LIMIT })}</p>}
          </div>
          <div className="px-3 py-1.5 border-t border-line-soft text-xs text-fg-faint" aria-hidden>{t('ticket.link.barHint')}</div>
        </div>,
        document.body,
      )}
    </div>
  )
}
