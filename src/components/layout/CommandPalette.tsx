import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../ui/Icon'
import { useT, useLang, type TranslationKey } from '../../i18n'
import { usePrefs } from '../../hooks/usePrefs'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useShortcutBindings } from '../../hooks/useShortcuts'
import { usePaletteSearch, type PaletteHit } from '../../hooks/usePaletteSearch'
import { parseQuery, suggestOperators, insertOperator, OPERATORS, type OperatorDef } from '../../lib/paletteQuery'
import { matchScore, MATCH } from '../../lib/fuzzy'
import { useNames } from './FavoritesSection'
import { formatCombo, onShortcut, type ShortcutAction } from '../../lib/shortcuts'
import { markHandled } from '../../lib/keys'
import { onOpenPalette } from '../../lib/palette'
import { displayTime, useDateFormat } from '../../lib/time'
import type { Recents, FavKind } from '../../lib/favorites'
import type { Team } from '../../types'
import { ListAvatar } from '../ui/ListIcon'

/**
 * The top bar's command palette (#43a865fb) — VS Code's Ctrl+Shift+P for Fira:
 * one box that finds things and runs commands.
 *
 *  - empty:       what you opened last (the home page's "recents", same source)
 *  - text:        tasks (title or #id), lists, pages — every team you are in,
 *                 searched on the server, typo-tolerant and Turkish-aware — plus
 *                 your teams and matching commands. Filters narrow it
 *                 (atanan:ben son:3sa "tam ifade" -hariç …, src/lib/paletteQuery.ts)
 *  - "?":         the filters, with examples; picking one writes it into the box
 *  - ">" + text:  commands only
 *
 * A WAI-ARIA combobox: the input keeps focus, ↑/↓ move the active option
 * (aria-activedescendant), Enter runs it, Esc closes and hands focus back.
 * Ctrl+K opens it (Ctrl+Shift+P with ">"), from anywhere, fields included.
 * On a phone the bar shows an icon and the palette opens as a full-screen sheet.
 */
export interface PaletteCommand {
  id: string
  label: string
  /** Extra words the command answers to (not shown). */
  keywords?: string
  icon?: ReactNode
  /** Shown as the command's key, from the user's own bindings. */
  shortcut?: ShortcutAction
  run: () => void
}

interface Props {
  commands: PaletteCommand[]
  teams: Team[]
  onOpenTicket: (id: string) => void
  onOpenPage: (id: string) => void
  onOpenProject: (id: string) => void
  onOpenTeam: (id: string) => void
}

interface Item { key: string; group: TranslationKey; icon: ReactNode; title: string; sub?: string; hint?: string; badge?: { name: string; color: string }; run: () => void }

const Glyph = ({ name }: { name: IconName }) => <Icon name={name} className="text-fg-muted" />
const TeamChip = ({ name }: { name: string }) => <span className="w-4 h-4 rounded-md bg-primary-600 text-white text-2xs font-bold inline-flex items-center justify-center flex-shrink-0" aria-hidden>{(name.trim()[0] ?? '?').toLocaleUpperCase('tr-TR')}</span>

export function CommandPalette(props: Props) {
  const t = useT()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const { bindings } = useShortcutBindings()

  // A ref, not the state: mousedown and focus both open it within one tick.
  const openRef = useRef(false)
  const show = (initial = '') => {
    if (!openRef.current) returnTo.current = document.activeElement as HTMLElement | null
    openRef.current = true
    setQuery(initial)
    setOpen(true)
    // The sheet (phone) mounts its own input; focus once it exists.
    requestAnimationFrame(() => inputRef.current?.focus())
  }
  /** Esc hands focus back to where it came from; running an item just leaves the box. */
  const hide = (restore = true) => {
    openRef.current = false
    setOpen(false)
    setQuery('')
    const el = returnTo.current
    if (restore && el && el !== inputRef.current && el !== document.body && document.contains(el)) el.focus()
    // Opened from nowhere in particular (the page body): just leave the box.
    if (document.activeElement === inputRef.current) inputRef.current?.blur()
    returnTo.current = null
  }
  const showRef = useRef(show); showRef.current = show
  useEffect(() => onShortcut('palette', () => showRef.current('')), [])
  useEffect(() => onShortcut('palette-commands', () => showRef.current('>')), [])
  // Opened from elsewhere with text in it (list header's "search this list", the / key).
  useEffect(() => onOpenPalette((text) => showRef.current(text)), [])

  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || isMobile) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) hide(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }) // re-bound every render: `hide` closes over the latest state

  const shortcutLabel = formatCombo(bindings.palette)
  const input = (
    <PaletteInput
      inputRef={inputRef}
      query={query}
      onType={(v) => { if (openRef.current) setQuery(v); else show(v) }}
      open={open}
      onOpen={() => { if (!openRef.current) show(query) }}
      placeholder={t('board.palette.placeholder')}
      shortcut={isMobile ? null : shortcutLabel}
      listId="fira-palette-list"
    />
  )

  if (isMobile) {
    return (
      <>
        <button type="button" onClick={() => show('')} aria-label={t('board.palette.open')} title={t('board.palette.open')} data-palette-open
          className="w-10 h-10 rounded-xl inline-flex items-center justify-center text-fg-2 hover:bg-raised">
          <Icon name="search" size={20} />
        </button>
        {open && (
          <div className="fixed inset-0 z-[200] bg-surface flex flex-col" role="dialog" aria-modal="true" aria-label={t('board.palette.aria')}>
            <div className="flex items-center gap-2 p-2 border-b border-line-soft">
              <div className="flex-1">{input}</div>
              <button type="button" onClick={() => hide()} className="text-sm text-fg-2 px-2 h-10">{t('common.cancel')}</button>
            </div>
            <PaletteList {...props} query={query} onQuery={setQuery} listId="fira-palette-list" inputRef={inputRef} onDone={() => hide(false)} onEscape={() => hide()} sheet />
          </div>
        )}
      </>
    )
  }

  return (
    // Open, the whole palette rises above modals (a task window can be open when Ctrl+K is pressed).
    <div ref={box} className={`relative w-full max-w-2xl ${open ? 'z-[200]' : ''}`} data-palette>
      {input}
      {open && <PaletteList {...props} query={query} onQuery={setQuery} listId="fira-palette-list" inputRef={inputRef} onDone={() => hide(false)} onEscape={() => hide()} />}
    </div>
  )
}

function PaletteInput({ inputRef, query, onType, open, onOpen, placeholder, shortcut, listId }: {
  inputRef: React.RefObject<HTMLInputElement>; query: string; onType: (q: string) => void; open: boolean; onOpen: () => void
  placeholder: string; shortcut: string | null; listId: string
}) {
  const t = useT()
  return (
    <div data-shortcut="palette search" className={`flex items-center gap-2 h-9 px-2.5 rounded-lg border transition-colors ${open ? 'bg-surface border-primary-400 ring-2 ring-primary-500/30' : 'bg-field/70 border-line hover:border-fg-faint'}`}>
      <Icon name="search" className="text-fg-faint" />
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={t('board.palette.aria')}
        value={query}
        onChange={(e) => onType(e.target.value)}
        onFocus={onOpen}
        onMouseDown={onOpen}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        data-palette-input
        className="flex-1 min-w-0 h-8 bg-transparent text-sm text-fg placeholder:text-fg-faint outline-none"
      />
      {shortcut && !open && <kbd className="text-2xs font-medium text-fg-faint border border-line rounded-md px-1.5 py-0.5 whitespace-nowrap">{shortcut}</kbd>}
    </div>
  )
}

const OpGlyph = () => <Glyph name="filter" />

/** "Searching…" — shown while an answer is on its way, above the previous one. */
function Searching({ label, top = false }: { label: string; top?: boolean }) {
  return (
    <p className={`px-3 flex items-center gap-2 text-sm text-fg-faint ${top ? 'py-1.5 border-b border-line-soft' : 'py-3'}`} data-palette-busy>
      <Icon name="spinner" className="animate-spin" />
      {label}
    </p>
  )
}

function PaletteList({ commands, teams, onOpenTicket, onOpenPage, onOpenProject, onOpenTeam, query, onQuery, listId, inputRef, onDone, onEscape, sheet = false }: Props & {
  query: string; onQuery: (q: string) => void; listId: string; inputRef: React.RefObject<HTMLInputElement>; onDone: () => void; onEscape: () => void; sheet?: boolean
}) {
  const t = useT()
  useDateFormat()
  const { bindings } = useShortcutBindings()
  const optPrefix = useId()
  const lang = useLang()
  const commandMode = query.startsWith('>')
  const helpMode = query.trim() === '?'
  const text = (commandMode ? query.slice(1) : query).trim()
  const parsed = useMemo(() => parseQuery(commandMode || helpMode ? '' : query), [query, commandMode, helpMode])
  const searching = !commandMode && !helpMode && (parsed.searchable || parsed.shortIds.length > 0)
  const search = usePaletteSearch(parsed, searching)
  const suggestions = commandMode ? [] : suggestOperators(parsed, query)
  // Commands and teams are matched here with the same typo-tolerant rule the server uses.
  const plainWords = parsed.payload.terms.join(' ')
  const byScore = <T,>(list: T[], textOf: (x: T) => string, q: string) =>
    list.map((x) => ({ x, s: matchScore(q, textOf(x)) })).filter((r) => r.s >= MATCH).sort((a, b) => b.s - a.s).map((r) => r.x)

  // Recents: the same user_preferences list the home page shows, names resolved the same way.
  const prefs = usePrefs('global')
  const recents = ((prefs.prefs as { recents?: Recents }).recents ?? {})
  const names = {
    ticket: useNames('ticket', (recents.tickets ?? []).map((e) => e.id)).data ?? [],
    page: useNames('page', (recents.pages ?? []).map((e) => e.id)).data ?? [],
    project: useNames('project', (recents.projects ?? []).map((e) => e.id)).data ?? [],
  }
  const teamName = (id: string | null | undefined) => teams.find((x) => x.id === id)?.name ?? ''

  const run = (fn: () => void) => () => { onDone(); fn() }
  const kindLabel: Record<FavKind, TranslationKey> = { ticket: 'me.recents.kindTicket', page: 'me.recents.kindPage', project: 'me.recents.kindList' }
  const hitItem = (h: PaletteHit): Item => h.kind === 'ticket'
    ? { key: `t:${h.id}`, group: 'board.palette.tickets', icon: <Glyph name="ticket" />, title: h.title || t('common.unnamedTask'), sub: [h.projectName, teamName(h.teamId)].filter(Boolean).join(' · '), hint: `#${h.id.slice(0, 6).toUpperCase()}`, badge: h.statusName && h.statusColor ? { name: h.statusName, color: h.statusColor } : undefined, run: run(() => onOpenTicket(h.id)) }
    : h.kind === 'page'
      ? { key: `p:${h.id}`, group: 'board.palette.pages', icon: <Glyph name={h.pageKind === 'drawing' ? 'drawing' : h.pageKind === 'whiteboard' ? 'whiteboard' : 'page'} />, title: h.title || t('common.unnamedTask'), sub: teamName(h.teamId), run: run(() => onOpenPage(h.id)) }
      : { key: `l:${h.id}`, group: 'board.palette.lists', icon: <ListAvatar icon={h.icon ?? null} iconUrl={h.iconUrl ?? null} color={null} size="sm" />, title: h.title, sub: teamName(h.teamId), run: run(() => onOpenProject(h.id)) }
  const opLabel = (op: OperatorDef) => op.label[lang === 'tr' ? 0 : 1]
  // Picking a filter writes its name into the box and keeps the palette open.
  const opItem = (op: OperatorDef): Item => ({
    key: `op:${op.key}`, group: 'board.palette.filters', icon: <OpGlyph />,
    title: `${opLabel(op)}:${op.example[lang === 'tr' ? 0 : 1]}`, sub: t(op.descKey),
    run: () => { onQuery(insertOperator(query, opLabel(op))); inputRef.current?.focus() },
  })
  const cmdItem = (c: PaletteCommand): Item => ({ key: `c:${c.id}`, group: 'board.palette.commands', icon: c.icon ?? <Glyph name="bolt" />, title: c.label, hint: c.shortcut && bindings[c.shortcut] ? formatCombo(bindings[c.shortcut]) : undefined, run: run(c.run) })

  const items = useMemo<Item[]>(() => {
    if (commandMode) return (text ? byScore(commands, (c) => `${c.label} ${c.keywords ?? ''}`, text) : commands).map(cmdItem)
    if (helpMode) return OPERATORS.map(opItem)
    if (!text) {
      const kinds: { kind: FavKind; key: keyof Recents }[] = [{ kind: 'ticket', key: 'tickets' }, { kind: 'page', key: 'pages' }, { kind: 'project', key: 'projects' }]
      return kinds
        .flatMap(({ kind, key }) => (recents[key] ?? []).map((e) => ({ kind, at: e.at, n: names[kind].find((x) => x.id === e.id) })))
        .filter((r) => !!r.n)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 10)
        .map((r): Item => {
          const n = r.n!
          const icon = r.kind === 'project' ? <ListAvatar icon={n.icon ?? null} iconUrl={n.icon_url ?? null} color={n.color ?? null} size="sm" /> : <Glyph name={r.kind === 'page' ? 'page' : 'ticket'} />
          const open = r.kind === 'ticket' ? () => onOpenTicket(n.id) : r.kind === 'page' ? () => onOpenPage(n.id) : () => onOpenProject(n.id)
          return { key: `r:${r.kind}:${n.id}`, group: 'board.palette.recent', icon, title: n.name || t('common.unnamedTask'), sub: `${t(kindLabel[r.kind])} · ${displayTime(r.at)}`, hint: r.kind === 'ticket' ? `#${n.id.slice(0, 6).toUpperCase()}` : undefined, run: run(open) }
        })
    }
    const hits = searching ? (search.data ?? []).map(hitItem) : []
    // Filters narrow tasks only; teams and commands answer the plain words.
    const onlyWords = parsed.chips.length === 0 && parsed.payload.phrases.length === 0
    const teamHits = onlyWords && plainWords ? byScore(teams, (x) => x.name, plainWords).slice(0, 4)
      .map((x): Item => ({ key: `team:${x.id}`, group: 'board.palette.teams', icon: <TeamChip name={x.name} />, title: x.name, sub: t('board.palette.team'), run: run(() => onOpenTeam(x.id)) })) : []
    const cmds = onlyWords && plainWords ? byScore(commands, (c) => `${c.label} ${c.keywords ?? ''}`, plainWords).slice(0, 6).map(cmdItem) : []
    return [...hits, ...teamHits, ...cmds, ...suggestions.map(opItem)]
  }, [commandMode, helpMode, text, query, lang, commands, recents, names.ticket, names.page, names.project, search.data, teams, bindings, parsed]) // eslint-disable-line react-hooks/exhaustive-deps

  const [active, setActive] = useState(0)
  useEffect(() => { setActive(0) }, [query])
  const activeIdx = Math.min(active, Math.max(items.length - 1, 0))
  const optId = (i: number) => `${optPrefix}-opt-${i}`
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' }) }, [activeIdx])

  // Keys live on the input (it keeps focus while the list is open).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.setAttribute('aria-activedescendant', items.length ? optId(activeIdx) : '')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!items.length) return
        setActive((i) => (Math.min(i, items.length - 1) + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        items[activeIdx]?.run()
      } else if (e.key === 'Escape') {
        markHandled(e); e.preventDefault(); e.stopPropagation()
        onEscape()
      } else if (e.key === 'Tab') {
        onDone()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => { el.removeEventListener('keydown', onKey); el.removeAttribute('aria-activedescendant') }
  }) // re-bound every render: the handler reads the current items

  const groups: { group: TranslationKey; rows: { item: Item; idx: number }[] }[] = []
  items.forEach((item, idx) => {
    const g = groups.find((x) => x.group === item.group)
    if (g) g.rows.push({ item, idx }); else groups.push({ group: item.group, rows: [{ item, idx }] })
  })
  // A query in flight is never "no results": react-query keeps the previous
  // answer as placeholder data, so `search.data` alone would let a stale empty
  // result claim the screen while the new one is still on its way (#43a865fb).
  const fetching = searching && search.isFetching
  const loading = fetching && items.length === 0
  const empty = !fetching && items.length === 0

  return (
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      aria-busy={fetching}
      aria-label={t('board.palette.aria')}
      className={sheet
        ? 'flex-1 overflow-y-auto scrollbar-thin py-1'
        : 'absolute left-0 right-0 top-full mt-1.5 z-[200] bg-surface border border-line rounded-xl shadow-2xl max-h-[min(70vh,34rem)] overflow-y-auto scrollbar-thin py-1 animate-fade-in'}
      onMouseDown={(e) => e.preventDefault()}   // keep focus in the input
      data-palette-list
    >
      {fetching && items.length > 0 && <Searching label={t('board.palette.searching')} top />}
      {parsed.chips.length > 0 && (
        <div className="px-3 pt-2 pb-1 flex flex-wrap items-center gap-1.5" data-palette-chips>
          <span className="text-xs font-semibold text-fg-faint">{t('board.palette.filterChips')}</span>
          {parsed.chips.map((c, i) => (
            <span key={i} title={c.ok ? undefined : t('board.palette.filterBad')}
              className={`text-2xs px-1.5 py-0.5 rounded-md border ${c.ok ? 'border-primary-200 dark:border-primary-900 bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300' : 'border-danger/40 bg-danger/10 text-danger line-through'}`}>
              {c.name}:{c.value}
            </span>
          ))}
        </div>
      )}
      {groups.map((g) => (
        <div key={g.group} role="group" aria-label={t(g.group)}>
          <div className="px-3 pt-2 pb-1 text-xs font-semibold text-fg-faint" aria-hidden>{t(g.group)}</div>
          {g.rows.map(({ item, idx }) => (
            <div
              key={item.key}
              id={optId(idx)}
              role="option"
              aria-selected={idx === activeIdx}
              data-idx={idx}
              data-palette-item={item.key}
              onMouseMove={() => { if (idx !== activeIdx) setActive(idx) }}
              onClick={item.run}
              className={`mx-1 px-2 h-10 rounded-lg flex items-center gap-2.5 cursor-pointer ${idx === activeIdx ? 'bg-primary-50 dark:bg-primary-950/40' : ''}`}
            >
              {/* One slot for every icon (list avatars are wider than glyphs): titles line up. */}
              <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">{item.icon}</span>
              <span className="flex-1 min-w-0">
                <span className={`block text-sm truncate ${idx === activeIdx ? 'text-primary-700 dark:text-primary-300' : 'text-fg'}`}>{item.title}</span>
                {item.sub && <span className="block text-xs text-fg-faint truncate">{item.sub}</span>}
              </span>
              {item.badge && (
                <span className="chip-dyn border text-2xs px-1.5 py-0.5 rounded-md font-medium flex-shrink-0 max-w-[8rem] truncate" style={{ '--c': item.badge.color } as React.CSSProperties}>{item.badge.name}</span>
              )}
              {item.hint && <span className="text-2xs font-mono tabular-nums text-fg-faint flex-shrink-0">{item.hint}</span>}
            </div>
          ))}
        </div>
      ))}
      {loading && <Searching label={t('board.palette.searching')} />}
      {empty && <p className="px-3 py-3 text-sm text-fg-faint">{!text && !commandMode ? t('board.palette.noRecent') : t('board.palette.noResults')}</p>}
      {!searching && !commandMode && !helpMode && text.length === 1 && <p className="px-3 pb-2 text-xs text-fg-faint">{t('board.palette.typeMore')}</p>}
      <div className="mt-1 px-3 pt-2 pb-1.5 border-t border-line-soft text-xs text-fg-faint flex flex-wrap gap-x-3 gap-y-1" aria-hidden>
        <span>{t('board.palette.hintNav')}</span>
        <span>{t('board.palette.hintCommands')}</span>
        <span>{t('board.palette.hintFilters')}</span>
      </div>
    </div>
  )
}
