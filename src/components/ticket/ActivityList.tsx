import { Fragment, useState } from 'react'
import { Icon, type IconName } from '../ui/Icon'
import { useTicketActivity } from '../../hooks/useActivity'
import { PRIORITY_LABELS, type TicketActivity, type TicketPriority } from '../../types'
import { useT } from '../../i18n'
import { displayDate, displayTime, exactTime, useDateFormat } from '../../lib/time'
import { UserAvatar } from './UserAvatar'

/**
 * Chronological change history of a ticket: what changed, from what to what and
 * by whom. Rows are written by database triggers (migration 038), so anything
 * that touches a ticket shows up here — including changes made outside the app.
 */

const chip = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-2xs font-medium bg-raised text-fg-2 max-w-[16rem] truncate align-middle'

function Value({ children, color }: { children: React.ReactNode; color?: string }) {
  if (children === null || children === undefined || children === '') return <span className="text-fg-faint">—</span>
  return (
    // Renkli değer (etiket, durum) `chip-dyn` ile: metin rengin koyulaştırılmışı, iki temada da
    // okunur. Ham renk kendi açık zemininde amber'de 1.9:1'e iniyordu (#990dfec5).
    <span className={color ? chip.replace('bg-raised text-fg-2', 'chip-dyn') : chip} style={color ? ({ '--c': color } as React.CSSProperties) : undefined} title={String(children)}>
      {color && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
      {children}
    </span>
  )
}

/** Keys, not words: a label table built at import time would freeze the language. */
/** Priority words are shared vocabulary: `PRIORITY_LABELS` in types holds the
 *  keys, so the activity log and the pickers cannot drift apart. */
const PRIORITY_KEYS = PRIORITY_LABELS

const dateLabel = (v: string | null) => (v ? displayDate(v) : null)

/**
 * Put the value chips into a translated sentence: every `{slot}` in the template
 * is swapped for its element, so each language may order the words around the
 * values however it needs to. The values themselves stay as they were logged.
 */
function fill(template: string, slots: Record<string, React.ReactNode>) {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1]
    return <Fragment key={i}>{name ? slots[name] ?? part : part}</Fragment>
  })
}

/** Icon family per kind — one glyph per group keeps the list scannable. */
export function KindIcon({ kind }: { kind: TicketActivity['kind'] }) {
  const name: IconName =
    kind === 'created' ? 'plus'
    : kind === 'status' ? 'checkCircle'
    : kind === 'priority' ? 'flag'
    : kind.startsWith('assignee') ? 'person'
    : kind.startsWith('tag') ? 'tag'
    : kind.startsWith('attachment') ? 'attach'
    : kind.startsWith('comment') ? 'comment'
    : kind.startsWith('child') ? 'subtask'
    : kind.startsWith('deadline') || kind === 'due_date' ? 'calendar'
    : kind.startsWith('link') ? 'link'
    : kind === 'description' || kind === 'title' ? 'edit'
    : kind === 'imported' ? 'download'
    : kind.includes('archiv') ? 'archive'
    : 'info'
  return <Icon name={name} />
}

/** One line of prose per event — the values keep their names as of that moment. */
export function Sentence({ a }: { a: TicketActivity }) {
  const t = useT()
  const to = a.to_value
  const from = a.from_value
  const priorityLabel = (v: string | null) => {
    if (!v) return null
    const key = PRIORITY_KEYS[v as TicketPriority]
    return key ? t(key) : v
  }
  switch (a.kind) {
    case 'created': return <>{t('ticket.activity.created')}{a.meta?.status ? <> · <Value>{String(a.meta.status)}</Value></> : null}</>
    case 'status': {
      // Imported completions often have no previous column to name.
      const toChip = <Value color={a.meta?.to_color as string | undefined}>{to}</Value>
      return from
        ? <>{fill(t('ticket.activity.status'), { from: <Value>{from}</Value>, to: toChip })}</>
        : <>{fill(t('ticket.activity.statusSet'), { to: toChip })}</>
    }
    case 'priority': return <>{fill(t('ticket.activity.priority'), { from: <Value>{priorityLabel(from)}</Value>, to: <Value>{priorityLabel(to)}</Value> })}</>
    case 'title': return <>{fill(t('ticket.activity.title'), { from: <Value>{from}</Value>, to: <Value>{to}</Value> })}</>
    case 'description': {
      const a0 = Number(a.meta?.from_len ?? 0), a1 = Number(a.meta?.to_len ?? 0)
      const delta = a1 - a0
      const note = a0 === 0 ? t('ticket.activity.descAdded')
        : a1 === 0 ? t('ticket.activity.descRemoved')
        : t('ticket.activity.descDelta', { n: `${delta >= 0 ? '+' : ''}${delta}` })
      // Akışta birleştirilmiş art arda düzeltmeler (#e8bafa89): kaç kez + net değişim.
      const times = Number(a.meta?.merged ?? 1)
      return <>{t('ticket.activity.description')} <span className="text-fg-faint">({times > 1 ? `${t('ticket.activity.descTimes', { n: times })} · ` : ''}{note})</span></>
    }
    case 'due_date':
      if (!to) return <>{fill(t('ticket.activity.dueRemoved'), { from: <Value>{dateLabel(from)}</Value> })}</>
      return from
        ? <>{fill(t('ticket.activity.dueChanged'), { from: <Value>{dateLabel(from)}</Value>, to: <Value>{dateLabel(to)}</Value> })}</>
        : <>{fill(t('ticket.activity.dueSet'), { to: <Value>{dateLabel(to)}</Value> })}</>
    case 'archived': return <>{t('ticket.activity.archived')}</>
    case 'unarchived': return <>{t('ticket.activity.unarchived')}</>
    case 'project': return <>{fill(t('ticket.activity.project'), { from: <Value>{from}</Value>, to: <Value>{to}</Value> })}</>
    case 'parent':
      return to
        ? <>{fill(t('ticket.activity.parentSet'), { to: <Value>{to}</Value> })}</>
        : <>{fill(t('ticket.activity.parentRemoved'), { from: <Value>{from}</Value> })}</>
    case 'child_added': return <>{fill(t('ticket.activity.childAdded'), { to: <Value>{to}</Value> })}</>
    case 'child_removed': return <>{fill(t('ticket.activity.childRemoved'), { from: <Value>{from}</Value> })}</>
    case 'assignee_added': return <>{fill(t('ticket.activity.assigneeAdded'), { to: <Value>{to}</Value> })}</>
    case 'assignee_removed': return <>{fill(t('ticket.activity.assigneeRemoved'), { from: <Value>{from}</Value> })}</>
    case 'tag_added': return <>{fill(t('ticket.activity.tagAdded'), { to: <Value color={a.meta?.color as string | undefined}>{to}</Value> })}</>
    case 'tag_removed': return <>{fill(t('ticket.activity.tagRemoved'), { from: <Value>{from}</Value> })}</>
    case 'attachment_added': return <>{fill(t('ticket.activity.attachmentAdded'), { to: <Value>{to}</Value> })}</>
    case 'attachment_removed': return <>{fill(t('ticket.activity.attachmentRemoved'), { from: <Value>{from}</Value> })}</>
    case 'deadline_added': return <>{fill(t('ticket.activity.deadlineAdded'), { to: <Value>{dateLabel(to)}</Value> })}{a.meta?.note ? <> · {String(a.meta.note)}</> : null}</>
    case 'deadline_removed': return <>{fill(t('ticket.activity.deadlineRemoved'), { from: <Value>{dateLabel(from)}</Value> })}</>
    case 'comment_added': return <>{fill(t('ticket.activity.commentAdded'), { to: <Value>{to}</Value> })}</>
    case 'mentioned': return <>{fill(t('ticket.activity.mentioned'), { to: <Value>{a.meta?.user_name as string || to}</Value> })}</>
    case 'comment_removed': return <>{t('ticket.activity.commentRemoved')}</>
    case 'link_added': return <>{fill(t('ticket.activity.linkAdded'), { to: <Value>{to}</Value> })}</>
    case 'link_removed': return <>{fill(t('ticket.activity.linkRemoved'), { from: <Value>{from}</Value> })}</>
    case 'imported': return to
      ? <>{fill(t('ticket.activity.importedFrom'), { to: <Value>{to}</Value> })}</>
      : <>{t('ticket.activity.imported')}</>
    default: return <>{a.kind}</>
  }
}

export function ActivityList({ ticketId, embedded = false }: { ticketId: string; embedded?: boolean }) {
  const t = useT()
  useDateFormat()   // repaint when the date format changes
  const { data: activity = [], isLoading } = useTicketActivity(ticketId)
  const [newestFirst, setNewestFirst] = useState(true)
  const rows = newestFirst ? [...activity].reverse() : activity

  return (
    <div>
      {/* The tab already labels and counts this section; embedded drops the heading
          but keeps the sort toggle. */}
      {(!embedded || activity.length > 1) && (
        <div className="flex items-center justify-end mb-2 min-h-[1.25rem]">
          {!embedded && (
            <h4 className="text-xs font-semibold text-fg-faint uppercase tracking-wider mr-auto">
              {t('ticket.activityTitle')} {activity.length > 0 && <span className="text-fg-faint/70">({activity.length})</span>}
            </h4>
          )}
          {activity.length > 1 && (
            <button
              onClick={() => setNewestFirst((v) => !v)}
              className="text-xs text-fg-faint hover:text-fg-2 transition-colors"
              title={t('ticket.sortToggle')}
            >
              {newestFirst ? t('ticket.newestFirst') : t('ticket.oldestFirst')}
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-fg-faint">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-fg-faint">{t('ticket.activityEmpty')}</p>
      ) : (
        <ol className="max-h-72 overflow-y-auto scrollbar-thin pr-1 space-y-1.5">
          {rows.map((a) => (
            <li key={a.id} className="flex items-start gap-2 text-xs leading-relaxed">
              <span className="mt-0.5 w-5 h-5 rounded-full bg-raised text-fg-faint flex items-center justify-center flex-shrink-0">
                <KindIcon kind={a.kind} />
              </span>
              {a.actor ? <UserAvatar user={a.actor} size="sm" /> : null}
              <span className="flex-1 min-w-0 text-fg-2">
                <span className="font-medium text-fg">{a.actor?.full_name || a.actor?.email || (a.meta?.by_name as string) || t('ticket.unknownUser')}</span>{' '}
                <Sentence a={a} />
                {a.meta?.imported ? <span className="text-fg-faint"> · {t('ticket.activity.fromImport')}</span> : null}
              </span>
              <time
                className="text-2xs text-fg-faint flex-shrink-0 tabular-nums"
                title={exactTime(a.created_at)}
                dateTime={a.created_at}
              >
                {displayTime(a.created_at)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
