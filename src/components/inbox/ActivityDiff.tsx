import { useMemo } from 'react'
import { Icon } from '../ui/Icon'
import { useAvatarColor } from '../../lib/avatarTone'
import { displayUrl } from '../../lib/storage'
import { useInboxActivity, type InboxItem } from '../../hooks/useNotifications'
import { plainText } from '../../lib/notify'
import { useTicketActivity } from '../../hooks/useActivity'
import { useComments } from '../../hooks/useComments'
import { Sentence, KindIcon } from '../ticket/ActivityList'
import { MarkdownView } from '../ticket/DescriptionEditor'
import { displayTime, exactTime, useDateFormat } from '../../lib/time'
import { useT } from '../../i18n'
import { useImageOk } from '../../hooks/useImageOk'

const clockTime = displayTime

/**
 * The "what changed" panel for one notification: shows the activity behind it as
 * a before → after where that makes sense (status), or the added content
 * (comment, subtask, file) otherwise. Answers "neler neydi, ne oldu" for the
 * event the user is looking at, without having to open the ticket.
 */
const fullDate = displayTime

type Translate = ReturnType<typeof useT>

const actorName = (a: InboxItem['actor'], t: Translate) => a?.full_name || a?.email || t('common.someoneElse')
const initials = (a: InboxItem['actor']) => (a?.full_name || a?.email || '?').split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2)

function ActorBadge({ actor }: { actor: InboxItem['actor'] }) {
  const photo = useImageOk(actor?.avatar_url)
  const tone = useAvatarColor(actor?.id ?? actor?.full_name ?? actor?.email)
  if (photo.ok) return <img src={displayUrl(actor?.avatar_url) ?? ''} alt="" onError={photo.onError} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
  return <span style={{ backgroundColor: tone }} className="w-8 h-8 rounded-full text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">{initials(actor)}</span>
}

function Chip({ text, color, muted }: { text: string; color?: string | null; muted?: boolean }) {
  if (color) {
    return (
      <span className="chip-dyn inline-flex items-center gap-1.5 border text-sm font-medium px-2.5 py-1 rounded-lg" style={{ '--c': color } as React.CSSProperties}>
        <span className="chip-dot w-1.5 h-1.5 rounded-full" />
        {text}
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center text-sm font-medium px-2.5 py-1 rounded-lg border border-line ${muted ? 'bg-raised text-fg-muted line-through decoration-fg-faint/60' : 'bg-raised text-fg-2'}`}>
      {text || '—'}
    </span>
  )
}

const Arrow = () => (
  <Icon name="arrowRight" size={20} className="text-fg-faint" />
)

function DiffBody({ item }: { item: InboxItem }) {
  const t = useT()
  // The list carries only the chip colour (#44b1a977); the full activity row —
  // before/after values and meta — is fetched when this panel opens.
  const { data: act } = useInboxActivity(item.activity_id)
  const value = plainText(item.value ?? '')
  const label = 'text-xs font-semibold text-fg-faint uppercase tracking-wider mb-2'

  switch (item.event) {
    case 'status': {
      const from = act?.from_value ?? null
      const to = act?.to_value ?? value
      const toColor = (act?.meta?.to_color as string | undefined) ?? null
      return (
        <div>
          <p className={label}>{t('inbox.diff.status')}</p>
          <div className="flex items-center gap-3 flex-wrap">
            <Chip text={from ?? t('inbox.diff.noPrevStatus')} muted={!!from} />
            <Arrow />
            <Chip text={to || '—'} color={toColor} />
          </div>
        </div>
      )
    }
    case 'comment':
      return (
        <div>
          <p className={label}>{t('inbox.diff.comment')}</p>
          <blockquote className="border-l-2 border-primary-400 pl-3 py-1 text-sm text-fg-2 whitespace-pre-wrap break-words">{value || '—'}</blockquote>
        </div>
      )
    case 'subtask':
      return (
        <div>
          <p className={label}>{t('inbox.diff.subtask')}</p>
          <div className="flex items-center gap-2 text-sm text-fg">
            <Icon name="ticket" className="text-fg-muted" />
            {value || '—'}
          </div>
        </div>
      )
    case 'file':
      return (
        <div>
          <p className={label}>{t('inbox.diff.file')}</p>
          <div className="flex items-center gap-2 text-sm text-fg">
            <Icon name="attach" className="text-fg-muted" />
            {value || '—'}
          </div>
        </div>
      )
    case 'assigned':
    default:
      return (
        <div>
          <p className={label}>{t('inbox.diff.assigned')}</p>
          <p className="text-sm text-fg-2">{t('inbox.diff.assignedBody')}</p>
        </div>
      )
  }
}

/** When several updates were folded into one notification, the diff becomes a
 *  list of every change in the window. Comments are shown in FULL (their whole
 *  body, not a preview); other activity as a one-line sentence. */
type GroupRow =
  | { t: 'activity'; id: string; at: string; a: import('../../types').TicketActivity }
  | { t: 'comment'; id: string; at: string; c: import('../../types').TicketComment }

function GroupedBody({ item }: { item: InboxItem }) {
  const t = useT()
  const { data: acts = [] } = useTicketActivity(item.ticket_id ?? '')
  const { data: comments = [] } = useComments(item.ticket_id ?? '')
  const rows = useMemo<GroupRow[]>(() => {
    const start = item.group_started_at ?? item.created_at
    const end = item.created_at
    const inWin = (iso: string) => iso >= start && iso <= end
    const A: GroupRow[] = acts
      .filter((a) => a.kind !== 'comment_added' && a.kind !== 'comment_removed' && a.kind !== 'mentioned' && inWin(a.created_at))
      .map((a) => ({ t: 'activity', id: `a-${a.id}`, at: a.created_at, a }))
    const C: GroupRow[] = comments
      .filter((c) => inWin(c.created_at))
      .map((c) => ({ t: 'comment', id: `c-${c.id}`, at: c.created_at, c }))
    return [...A, ...C].sort((x, y) => y.at.localeCompare(x.at))
  }, [acts, comments, item.group_started_at, item.created_at])

  return (
    <div>
      <p className="text-xs font-semibold text-fg-faint uppercase tracking-wider mb-2">{t('inbox.updates', { n: item.group_count })}</p>
      <ul className="space-y-3">
        {rows.map((r) => r.t === 'comment' ? (
          <li key={r.id} className="text-sm">
            <div className="flex items-center gap-2 text-xs text-fg-faint mb-1">
              <span className="font-medium text-fg-2">{r.c.author?.full_name || r.c.author?.email || t('common.someoneElse')}</span>
              <span>{t('inbox.commentWord')}</span>
              <time title={exactTime(r.at)}>{clockTime(r.at)}</time>
            </div>
            <div className="bg-raised/70 border border-line-soft rounded-lg px-3 py-2 comment-md">
              <MarkdownView value={r.c.content} onFileClick={() => {}} />
            </div>
          </li>
        ) : (
          <li key={r.id} className="flex items-start gap-2 text-sm leading-relaxed">
            <span className="mt-0.5 w-5 h-5 rounded-full bg-raised text-fg-faint flex items-center justify-center flex-shrink-0"><KindIcon kind={r.a.kind} /></span>
            <span className="flex-1 min-w-0 text-fg-2">
              <span className="font-medium text-fg">{r.a.actor?.full_name || r.a.actor?.email || (r.a.meta?.by_name as string) || t('common.someoneElse')}</span>{' '}
              <Sentence a={r.a} />
            </span>
            <time className="text-xs text-fg-faint flex-shrink-0" title={exactTime(r.at)}>{clockTime(r.at)}</time>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-fg-faint">{t('inbox.noChanges')}</li>}
      </ul>
    </div>
  )
}

export function ActivityDiff({ item, onOpenTicket }: { item: InboxItem; onOpenTicket: (ticketId: string) => void }) {
  const t = useT()
  useDateFormat()   // repaint when the chosen date format changes
  return (
    <div className="flex flex-col h-full">
      {/* Who / when */}
      <div className="flex items-start gap-3 pb-4 border-b border-line-soft">
        <ActorBadge actor={item.actor} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fg-2"><span className="font-semibold text-fg">{actorName(item.actor, t)}</span></p>
          <p className="text-xs text-fg-faint mt-0.5" title={exactTime(item.created_at)}>{fullDate(item.created_at)}{item.project?.name ? ` · ${item.project.name}` : ''}</p>
        </div>
      </div>

      {/* Ticket */}
      <button
        onClick={() => item.ticket_id && onOpenTicket(item.ticket_id)}
        className="group text-left mt-4 mb-5"
      >
        <p className="text-xs font-semibold text-fg-faint uppercase tracking-wider mb-1">{t('inbox.ticket')}</p>
        <span className="text-base font-semibold text-fg group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors break-words">
          {item.ticket_title}
        </span>
      </button>

      {/* What changed — a list when several updates were folded in, else one diff */}
      {item.group_count > 1 ? <GroupedBody item={item} /> : <DiffBody item={item} />}

      <div className="mt-auto pt-6">
        <button
          onClick={() => item.ticket_id && onOpenTicket(item.ticket_id)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          {t('inbox.openTicket')}
          <Icon name="arrowRight" />
        </button>
      </div>
    </div>
  )
}
