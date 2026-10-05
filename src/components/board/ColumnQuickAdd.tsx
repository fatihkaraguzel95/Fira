import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { useCreateTicket } from '../../hooks/useTickets'
import { useTeamMemberProfiles } from '../../hooks/useTeams'
import type { TicketStatus } from '../../types'
import { DateInput } from '../ui/DateInput'
import { UserAvatar } from '../ticket/UserAvatar'
import { isEditableTarget, markHandled } from '../../lib/keys'
import { useT } from '../../i18n'

/**
 * "+ Görev ekle" at the head of a Kanban column: title, optional due date and a
 * first assignment, without opening the full ticket window. The ticket takes the
 * column's own status, and lands at the top so it appears where you are looking.
 * The form stays open after saving — adding several tasks in a row is the point.
 */
export function ColumnQuickAdd({ status, projectId, teamId }: { status: TicketStatus; projectId: string; teamId: string | null }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [people, setPeople] = useState<string[]>([])
  const [showPeople, setShowPeople] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const members = useTeamMemberProfiles(teamId)
  const create = useCreateTicket()

  const empty = !title.trim() && !due && people.length === 0
  const close = () => { setOpen(false); setTitle(''); setDue(''); setPeople([]); setShowPeople(false); setError(null) }

  useEffect(() => {
    if (!open) return
    // Close on *click*, not mousedown: closing on mousedown removed the form
    // before the mouseup, the column shifted up, and the click the user meant
    // for a card underneath landed on nothing.
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node) && empty) close() }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isEditableTarget(e.target) && title) { setTitle(''); markHandled(e); return }
      markHandled(e)
      close()
    }
    // Attach on the next tick: the click that opened the form is still on its
    // way up to document and would close it again before it was ever seen.
    const armed = window.setTimeout(() => document.addEventListener('click', onDown), 0)
    document.addEventListener('keydown', onKey, true)
    return () => { window.clearTimeout(armed); document.removeEventListener('click', onDown); document.removeEventListener('keydown', onKey, true) }
  }, [open, empty, title])

  const submit = async () => {
    const name = title.trim()
    if (!name || create.isPending) return
    try {
      setError(null)
      await create.mutateAsync({
        title: name,
        status: status.name,
        status_id: status.id,
        project_id: projectId,
        priority: 'medium',
        due_date: due || null,
        assignee_ids: people,
        place: 'top',
      })
      // Kayıttan sonra kutu **ilk hâline** döner (#957fcdfe): açık kalması
      // bilerek (arka arkaya görev eklemek için) ama atama listesi açık ve
      // seçili kişiler duruyor kalınca bir sonraki görev sessizce onları
      // devralıyordu. Ad, tarih, kişiler ve açık liste birlikte sıfırlanır.
      setTitle(''); setDue(''); setPeople([]); setShowPeople(false)
      inputRef.current?.focus()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0) }}
        data-shortcut="new-ticket"
        /* Same shape as the cards underneath, so the column reads as one stack. */
        className="w-full flex items-center gap-2 bg-surface rounded-xl border border-line shadow-sm p-3.5 mb-2 text-sm font-medium text-fg-muted transition-all duration-150 hover:border-primary-300 dark:hover:border-primary-600 hover:text-fg-2 hover:shadow-lg"
      >
        <Icon name="plus" />
        {t('board.quickAdd.add')}
      </button>
    )
  }

  const row = 'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-fg-muted hover:bg-raised transition-colors'
  return (
    <div ref={boxRef} className="mb-2 rounded-xl border border-primary-300 dark:border-primary-700 bg-surface shadow-lg p-2.5 space-y-1">
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        placeholder={t('board.quickAdd.placeholder')}
        className="w-full text-sm bg-transparent border-b border-primary-400 px-1 py-1.5 text-fg placeholder:text-fg-faint outline-none"
      />

      <div>
        <button className={row} onClick={() => setDue(due ? '' : new Date().toISOString().slice(0, 10))}>
          <Icon name="calendar" />
          {due ? t('board.quickAdd.clearDue') : t('board.quickAdd.setDue')}
        </button>
        {due && <div className="px-2 pb-1"><DateInput value={due} onChange={(v) => setDue(v ?? '')} /></div>}
      </div>

      <div>
        <button className={row} onClick={() => setShowPeople((v) => !v)}>
          <Icon name="userAdd" />
          {people.length === 0 ? t('board.quickAdd.assign') : t('board.quickAdd.assigned', { n: people.length })}
          {people.length > 0 && (
            <span className="ml-auto flex -space-x-1.5">
              {members.filter((m) => people.includes(m.id)).slice(0, 3).map((m) => <UserAvatar key={m.id} user={m} size="sm" />)}
            </span>
          )}
        </button>
        {showPeople && (
          <div className="max-h-40 overflow-y-auto scrollbar-thin px-1 py-1 space-y-0.5">
            {members.length === 0 && <p className="text-xs text-fg-faint px-1">{t('board.quickAdd.noMembers')}</p>}
            {members.map((m) => {
              const on = people.includes(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => setPeople((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))}
                  className={`w-full flex items-center gap-2 px-1.5 py-1 rounded-lg text-xs transition-colors ${on ? 'bg-primary-50 dark:bg-primary-950/40 text-fg' : 'text-fg-2 hover:bg-raised'}`}
                >
                  <UserAvatar user={m} size="sm" />
                  <span className="truncate">{m.full_name || m.email}</span>
                  {on && <span className="ml-auto text-primary-600 dark:text-primary-400">✓</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-danger px-1">{error}</p>}

      <div className="flex items-center justify-end gap-1.5 pt-0.5">
        <button onClick={close} className="text-xs px-2 py-1.5 rounded-lg text-fg-muted hover:bg-raised">{t('common.giveUp')}</button>
        <button
          onClick={submit}
          disabled={!title.trim() || create.isPending}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {create.isPending ? t('board.quickAdd.adding') : t('board.quickAdd.add')}
        </button>
      </div>
    </div>
  )
}
