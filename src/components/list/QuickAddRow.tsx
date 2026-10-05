import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Ticket, TicketPriority, TicketStatus, Tag } from '../../types'
import { useT } from '../../i18n'
import { displayDate } from '../../lib/time'
import { dueQuickDates, type GroupPreset } from '../../lib/listView'
import { useCreateTicket } from '../../hooks/useTickets'
import { useCreateChild } from '../../hooks/useChildren'
import { useAddAssignee } from '../../hooks/useTicketAssignees'
import { useAssignTag, useTags } from '../../hooks/useTags'
import { useTeamMemberProfiles } from '../../hooks/useTeams'
import { useStatuses } from '../../hooks/useStatuses'
import { UserAvatar } from '../ticket/UserAvatar'
import { PrioritySelect } from '../ticket/PriorityPicker'
import { PriorityFlag } from './InlineCells'
import { PRIORITY_LABELS } from '../../types'
import { DateInput } from '../ui/DateInput'
import { ListAvatar } from '../ui/ListIcon'
import { StatusIndicator } from '../ticket/StatusIndicator'
import type { ColumnDef } from './columns'

/**
 * One-line task entry (#883CF8 / TL-07): a name plus small buttons for the
 * people, the due date, the priority and the tags — under a group header, at
 * the end of a group, or under a parent row (then it makes a subtask).
 *
 * The row starts from a `preset` (the group's value, the single-valued
 * filters) so a task created inside "Bugün" or "Ali" lands where it was typed.
 * Enter saves and keeps the row open for the next one; Escape closes it; a
 * click outside closes it only when nothing was typed (the Kanban rule).
 * Lists that span projects (my tasks) show a list selector first.
 */
export interface QuickAddProps {
  colSpan: number
  pad: string
  /** The list to create in; absent for cross-list sources (then the row asks). */
  projectId: string | null
  teamId: string | null
  statuses: TicketStatus[]
  preset: GroupPreset
  /** Create a subtask of this ticket instead of a top-level task. */
  parent?: Ticket
  indent?: number
  onClose: () => void
  /**
   * Sakin satır (#ce19252c): "Görev ekle" düğmeleri yerine grubun sonunda
   * hep duran, kenarlıksız ve saydam bir satır. Sağındaki düğmeler yalnız
   * üzerine gelince, odaklanınca ya da bir şey yazılınca görünür; başlık
   * alanı diğer satırların başlığıyla aynı hizada durur.
   */
  quiet?: boolean
  /** Sakin satırda yalnız kullanıcı istediğinde odaklanılır. */
  autoFocus?: boolean
  /** Satır başındaki durum halkası (sakin satırda görünür). */
  compact?: boolean
  /** Listede seçim sütunu varsa sakin satır da onu boş geçer, yoksa ad sütunuyla hizalanmaz. */
  selectCol?: boolean
  /**
   * Boştayken satır hiç görünmesin (#ce19252c, ikinci tur): görev eklemeyle
   * ilgilenmeyen kişi boş bir satır bile görmesin. Üzerine gelince, odaklanınca
   * ya da bir şey yazılınca halka, yer tutucu ve denetimler birlikte belirir.
   */
  fade?: boolean
  /** Boşken dışarı tıklayınca kapanır (grup başlığındaki + ile açılan üst satır). */
  dismiss?: boolean
  /** Yeni görev grubun başına mı sonuna mı eklensin. */
  place?: 'top' | 'bottom'
  /** Sakin satırın sütun hizası: görünen sütunlar ve ad sütununun genişliği. */
  columns?: ColumnDef[]
  nameWidth?: number
  /** Satır sonundaki boş hücre (masaüstünde sütun ekleme yuvası). */
  trailing?: boolean
}

interface ProjectLite { id: string; name: string; team_id: string; icon: string | null; icon_url: string | null }

function useAllProjects(enabled: boolean) {
  return useQuery({
    queryKey: ['projects', 'all-mine'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ProjectLite[]> => {
      const { data, error } = await supabase.from('projects').select('id, name, team_id, icon, icon_url').order('name')
      if (error) throw error
      return (data ?? []) as ProjectLite[]
    },
  })
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation()

/** A small popover anchored to an icon button; closes on outside click and Escape. */
function IconPop({ label, active, icon, children, badge }: { label: string; active: boolean; icon: ReactNode; children: (close: () => void) => ReactNode; badge?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true) }
  }, [open])
  return (
    <span ref={box} className="relative inline-flex">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`h-8 min-w-8 px-1.5 rounded-lg inline-flex items-center gap-1 justify-center transition-colors ${active ? 'bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300' : 'text-fg-faint hover:text-fg hover:bg-raised'}`}
      >
        {icon}
        {badge}
      </button>
      {open && (
        <span role="dialog" aria-label={label} className="absolute left-0 top-full z-30 mt-1 w-60 bg-surface border border-line rounded-xl shadow-2xl py-1 text-left normal-case block">
          {children(() => setOpen(false))}
        </span>
      )}
    </span>
  )
}


export function QuickAddRow({ colSpan, pad, projectId: fixedProject, teamId: fixedTeam, statuses: fixedStatuses, preset, parent, indent = 0, onClose, quiet = false, autoFocus = true, compact = false, selectCol = false, fade = false, dismiss = false, place = 'bottom', columns = [], nameWidth, trailing = false }: QuickAddProps) {
  const t = useT()
  const create = useCreateTicket()
  const createChild = useCreateChild()
  const addAssignee = useAddAssignee()
  const assignTag = useAssignTag()

  // Where the task goes: the list we are in, the parent's list, or the one picked here.
  const projects = useAllProjects(!fixedProject && !parent)
  const [pickedProject, setPickedProject] = useState<string | null>(null)
  const projectId = parent?.project_id ?? fixedProject ?? pickedProject ?? projects.data?.[0]?.id ?? null
  const project = projects.data?.find((p) => p.id === projectId)
  const teamId = fixedTeam ?? project?.team_id ?? null
  const fetchedStatuses = useStatuses(fixedStatuses.length ? null : projectId)
  const statuses = fixedStatuses.length ? fixedStatuses : (fetchedStatuses.data ?? [])
  const members = useTeamMemberProfiles(teamId)
  const { data: tags = [] } = useTags(projectId)

  const [title, setTitle] = useState('')
  const [people, setPeople] = useState<string[]>(preset.assignee_ids ?? [])
  const [due, setDue] = useState<string | null>(preset.due_date ?? null)
  const [priority, setPriority] = useState<TicketPriority | null>(preset.priority === undefined ? 'medium' : preset.priority)
  const [tagIds, setTagIds] = useState<string[]>(preset.tag_ids ?? [])
  const ref = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLTableRowElement>(null)
  useEffect(() => { if (autoFocus) ref.current?.focus() }, [autoFocus])
  // Close on *click* outside when nothing was typed — not on mousedown, which
  // removed the row before the click landed on what was underneath (ColumnQuickAdd).
  // Registered a tick later: the click that opened the row is still bubbling
  // to the document when the effect runs, and would close it at once.
  useEffect(() => {
    // Kalıcı satır kapanmaz; başlıktaki + ile açılan üst satır boşsa kapanır.
    if (quiet && !dismiss) return
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node) && !title.trim()) onClose() }
    const id = window.setTimeout(() => document.addEventListener('click', onDoc), 0)
    return () => { window.clearTimeout(id); document.removeEventListener('click', onDoc) }
  }, [title, onClose, quiet, dismiss])

  const status = statuses.find((s) => s.id === preset.status_id) ?? statuses.find((s) => s.category === 'backlog') ?? statuses.find((s) => s.category === 'active') ?? statuses[0]
  const pending = create.isPending || createChild.isPending
  const submit = async () => {
    const name = title.trim()
    if (!name || pending || !projectId) return
    setTitle('')
    if (parent) {
      const child = await createChild.mutateAsync({ parent, title: name, priority, due_date: due })
      for (const uid of people) await addAssignee.mutateAsync({ ticketId: child.id, userId: uid })
      for (const tid of tagIds) await assignTag.mutateAsync({ ticketId: child.id, tagId: tid })
    } else {
      if (!status) return
      await create.mutateAsync({ title: name, status: status.name, status_id: status.id, project_id: projectId, priority, due_date: due, assignee_ids: people, tag_ids: tagIds, place })
    }
    // Satır da ilk hâline döner (#957fcdfe): "ilk hâl" burada grubun ön
    // değeri — atanana göre gruplanmış bir listede o kişi korunur, kullanıcının
    // elle eklediği seçimler temizlenir.
    setPeople(preset.assignee_ids ?? [])
    setDue(preset.due_date ?? null)
    setPriority(preset.priority === undefined ? 'medium' : preset.priority)
    setTagIds(preset.tag_ids ?? [])
    ref.current?.focus()
  }


  const quick = dueQuickDates()
  const pickedTags = tags.filter((x: Tag) => tagIds.includes(x.id))
  // Boşken görünmeyen satır (#ce19252c): yazı varsa hep açık, yoksa üzerine
  // gelince / odaklanınca belirir. Dokunmatikte hover olmadığı için hep açık.
  const veil = fade
    ? `transition-opacity ${title.trim() ? 'opacity-100' : 'opacity-0 group-hover/quick:opacity-100 group-focus-within/quick:opacity-100 [@media(hover:none)]:opacity-100'}`
    : ''
  const btn = compact ? 'w-6 h-6' : 'w-7 h-7'

  // ── Denetimler ──────────────────────────────────────────────────────────────
  // Her biri ayrı: sakin satırda kendi sütununun hücresine girer (kullanıcı,
  // 25 Eyl: "kendi ilgili oldukları sütunların altında yer alsınlar"), sütun
  // kapalıysa ad hücresinin sonuna düşer.
  const listCtl = !fixedProject && !parent ? (
    <IconPop label={t('board.list.quick.list')} active={!!project} icon={project ? <ListAvatar icon={project.icon} iconUrl={project.icon_url} color={null} size="sm" /> : <Icon name="list" />} badge={project && <span className="text-xs max-w-[8rem] truncate">{project.name}</span>}>
      {(close) => (
        <span className="block max-h-64 overflow-y-auto scrollbar-thin">
          {(projects.data ?? []).map((p) => (
            <button key={p.id} type="button" onClick={() => { setPickedProject(p.id); close() }} className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-raised ${p.id === projectId ? 'text-fg font-medium' : 'text-fg-2'}`}>
              <ListAvatar icon={p.icon} iconUrl={p.icon_url} color={null} size="sm" /><span className="truncate">{p.name}</span>
            </button>
          ))}
        </span>
      )}
    </IconPop>
  ) : null

  const peopleCtl = (
    <IconPop label={t('board.quickAdd.assign')} active={people.length > 0} icon={<Icon name="userAdd" />}
      badge={people.length > 0 && <span className="flex -space-x-1.5">{members.filter((m) => people.includes(m.id)).slice(0, 3).map((m) => <UserAvatar key={m.id} user={m} size="sm" />)}</span>}>
      {() => (
        <span className="block max-h-56 overflow-y-auto scrollbar-thin py-0.5">
          {members.length === 0 && <span className="block px-3 py-1.5 text-xs text-fg-faint">{t('board.quickAdd.noMembers')}</span>}
          {members.map((m) => {
            const on = people.includes(m.id)
            return (
              <button key={m.id} type="button" role="menuitemcheckbox" aria-checked={on} onClick={() => setPeople((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))} className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left ${on ? 'bg-primary-50 dark:bg-primary-950/40 text-fg' : 'text-fg-2 hover:bg-raised'}`}>
                <UserAvatar user={m} size="sm" /><span className="truncate">{m.full_name || m.email}</span>{on && <span className="ml-auto text-primary-600 dark:text-primary-400">✓</span>}
              </button>
            )
          })}
        </span>
      )}
    </IconPop>
  )

  const dueCtl = (
    <IconPop label={t('board.list.edit.due')} active={!!due} icon={<Icon name="calendar" />} badge={due && <span className="text-xs">{displayDate(due)}</span>}>
      {(close) => (
        <>
          {quick.map((q) => (
            <button key={q.key} type="button" onClick={() => { setDue(q.date); close() }} className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-fg-2 hover:bg-raised hover:text-fg">
              <span>{t(q.labelKey)}</span><span className="text-xs text-fg-faint">{displayDate(q.date)}</span>
            </button>
          ))}
          <span className="block border-t border-line-soft my-1" />
          <span className="block px-3 py-1.5"><DateInput value={due} onChange={(v) => { setDue(v); if (v) close() }} className="w-full text-sm bg-field border border-line rounded-lg px-2 py-1 text-fg" aria-label={t('board.list.due')} /></span>
          {due && <button type="button" onClick={() => { setDue(null); close() }} className="w-full text-left px-3 py-1.5 text-xs text-fg-muted hover:bg-raised hover:text-danger">{t('board.list.edit.dueClear')}</button>}
        </>
      )}
    </IconPop>
  )

  // Sütunun altındaki öncelik: satırlardaki gibi yalnız bayrak. Geniş "Orta"
  // pilili seçici 80 pikselik sütuna sığmıyor, yanındaki sütunun üstüne taşıyordu.
  const prioCtl = quiet ? (
    <IconPop label={t('ticketExtra.priority.label')} active={!!priority} icon={<PriorityFlag priority={priority} />}>
      {(close) => (
        <>
          {(['critical', 'high', 'medium', 'low'] as const).map((x) => (
            <button key={x} type="button" role="option" aria-selected={priority === x} onClick={() => { setPriority(x); close() }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-raised ${priority === x ? 'text-fg font-medium' : 'text-fg-2'}`}>
              <PriorityFlag priority={x} />{t(PRIORITY_LABELS[x])}
            </button>
          ))}
          <button type="button" role="option" aria-selected={!priority} onClick={() => { setPriority(null); close() }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-fg-muted hover:bg-raised">
            <PriorityFlag priority={null} />{t('ticketExtra.priority.none')}
          </button>
        </>
      )}
    </IconPop>
  ) : <span className="inline-flex" onMouseDown={(e) => e.preventDefault()}><PrioritySelect value={priority} onChange={setPriority} /></span>

  const tagCtl = tags.length > 0 ? (
    <IconPop label={t('board.col.tags')} active={tagIds.length > 0} icon={<Icon name="tag" />}
      badge={pickedTags.length > 0 && <span className="flex gap-1">{pickedTags.slice(0, 2).map((x: Tag) => <span key={x.id} className="chip-dyn border text-2xs px-1 rounded-full" style={{ '--c': x.color } as React.CSSProperties}>{x.name}</span>)}{pickedTags.length > 2 && <span className="text-2xs">+{pickedTags.length - 2}</span>}</span>}>
      {() => (
        <span className="block max-h-56 overflow-y-auto scrollbar-thin py-0.5">
          {tags.map((x: Tag) => {
            const on = tagIds.includes(x.id)
            return (
              <button key={x.id} type="button" role="menuitemcheckbox" aria-checked={on} onClick={() => setTagIds((p) => (on ? p.filter((id) => id !== x.id) : [...p, x.id]))} className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left ${on ? 'bg-primary-50 dark:bg-primary-950/40 text-fg' : 'text-fg-2 hover:bg-raised'}`}>
                <span className="chip-dyn border text-2xs px-1.5 py-0.5 rounded-full" style={{ '--c': x.color } as React.CSSProperties}>{x.name}</span>{on && <span className="ml-auto text-primary-600 dark:text-primary-400">✓</span>}
              </button>
            )
          })}
        </span>
      )}
    </IconPop>
  ) : null

  const input = (
    <input
      ref={ref}
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); void submit() }
        // Kalıcı satır kapanmaz: Esc yazılanı temizler ve odaktan çıkar.
        if (e.key === 'Escape') { e.preventDefault(); if (quiet && !dismiss) { setTitle(''); ref.current?.blur() } else onClose() }
      }}
      placeholder={t(parent ? 'board.list.addSubtaskPlaceholder' : quiet ? 'board.list.addQuiet' : 'board.list.addPlaceholder')}
      aria-label={t(parent ? 'board.list.addSubtask' : 'board.list.addTask')}
      className={quiet
        ? `flex-1 min-w-0 text-sm ${compact ? 'h-6' : 'h-8'} px-1.5 -ml-1.5 rounded-lg bg-transparent border border-transparent text-fg placeholder-fg-faint/70 focus:outline-none hover:bg-field hover:border-line focus:bg-field focus:border-primary-500 transition-colors`
        : 'flex-1 min-w-[12rem] text-sm h-8 px-2.5 rounded-lg bg-field border border-line text-fg placeholder-fg-faint focus:outline-none focus:border-primary-500'}
    />
  )

  const saveCtl = quiet ? (
    <span className="flex items-center gap-0.5 flex-shrink-0">
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void submit()} disabled={!title.trim() || pending || !projectId}
        title={t('board.list.quick.save')} aria-label={t('board.list.quick.save')}
        className={`${btn} rounded-lg inline-flex items-center justify-center bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40`}>
        <Icon name="check" />
      </button>
      <button type="button" onMouseDown={(e) => e.preventDefault()}
        onClick={() => { if (quiet && !dismiss) { setTitle(''); ref.current?.blur() } else onClose() }}
        title={t('common.giveUp')} aria-label={t('common.giveUp')}
        className={`${btn} rounded-lg inline-flex items-center justify-center text-fg-faint hover:text-fg hover:bg-raised`}>
        <Icon name="close" />
      </button>
    </span>
  ) : (
    <span className="flex items-center gap-1 ml-auto">
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void submit()} disabled={!title.trim() || pending || !projectId} className="text-xs bg-primary-600 text-white px-2.5 h-8 rounded-lg hover:bg-primary-700 disabled:opacity-50">{t('board.list.quick.save')}</button>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClose} className="text-xs text-fg-muted hover:text-fg px-2 h-8 rounded-lg hover:bg-raised">{t('common.giveUp')}</button>
    </span>
  )

  // ── Sakin satır: gerçek sütun hücreleri ─────────────────────────────────────
  if (quiet) {
    const byKey: Partial<Record<string, ReactNode>> = { project: listCtl, assignees: peopleCtl, due: dueCtl, priority: prioCtl, tags: tagCtl }
    const shown = new Set(columns.map((c) => c.key))
    // Sütunu kapalı olan denetim kaybolmasın: adın sonunda durur.
    const orphans = (['project', 'assignees', 'due', 'priority', 'tags'] as const).filter((k) => byKey[k] && !shown.has(k)).map((k) => <span key={k} className="inline-flex">{byKey[k]}</span>)
    return (
      <tr data-quick-add data-quiet ref={box} className="group/quick">
        {selectCol && <td className="w-8 px-2 py-0" aria-hidden />}
        {columns.map((c) => c.key === 'name' ? (
          <td key="name" data-col="name" className={`${pad} sticky left-0 z-[1] list-name-cell`}
            style={{ paddingLeft: `${compact ? 8 : 12}px`, ...(nameWidth ? { width: nameWidth, minWidth: nameWidth } : {}) }}>
            {/* Başlık hizası: satırlardaki iki sabit yuva (katlama oku + durum halkası) burada da var. */}
            <span className={`flex items-center gap-1.5 min-w-0 ${compact ? '[&_button]:h-6 [&_button]:min-w-6' : ''} ${veil}`}>
              <span className="w-5 h-5 flex-shrink-0" aria-hidden />
              <span className="w-5 h-5 inline-flex items-center justify-center flex-shrink-0" aria-hidden title={status?.name ?? undefined}>
                <StatusIndicator status={status ?? null} size={14} />
              </span>
              {input}
              {orphans}
              {saveCtl}
            </span>
          </td>
        ) : (
          <td key={c.key} data-col={c.key} className={`${pad} ${c.align === 'right' ? 'text-right' : ''}`}>
            <span className={`inline-flex items-center ${compact ? '[&_button]:h-6 [&_button]:min-w-6' : ''} ${veil}`}>{byKey[c.key] ?? null}</span>
          </td>
        ))}
        {trailing && <td aria-hidden />}
      </tr>
    )
  }

  // ── Alt görev satırı: tek hücre, girintili ──────────────────────────────────
  return (
    <tr data-quick-add data-parent={parent?.id} ref={box}>
      <td colSpan={colSpan} className={pad} style={indent ? { paddingLeft: `${16 + indent}px` } : undefined}>
        <div className="sticky left-4 flex items-center gap-1.5 flex-wrap max-w-[calc(100vw-8rem)]" onClick={stop}>
          <span className="w-5 h-5 inline-flex items-center justify-center text-fg-faint flex-shrink-0" aria-hidden>
            <Icon name="plus" />
          </span>
          {listCtl}
          {input}
          <span className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
            {peopleCtl}
            {dueCtl}
            {prioCtl}
            {tagCtl}
            {saveCtl}
          </span>
        </div>
      </td>
    </tr>
  )
}
