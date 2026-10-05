import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { useComments, useAddComment, useDeleteComment, useUpdateComment } from '../../hooks/useComments'
import { useTicketActivity } from '../../hooks/useActivity'
import { useAuth } from '../../hooks/useAuth'
import { useAttachRecord } from '../../hooks/useUpload'
import type { TicketActivity, TicketComment, Ticket, TicketStatus, CommentAction } from '../../types'
import { isCompleteStatus } from '../../types'
import { useAddAssignee } from '../../hooks/useTicketAssignees'
import { useUpdateTicket } from '../../hooks/useTickets'
import { useTeamMemberProfiles } from '../../hooks/useTeams'
import { celebrateTicket } from '../../lib/celebrate'
import { setUnsaved } from '../../lib/unsaved'
import { useCommentDraft } from '../../hooks/useTray'
import { useT } from '../../i18n'
import { UserAvatar } from './UserAvatar'
import { Sentence, KindIcon } from './ActivityList'
import { DescriptionEditor } from './DescriptionEditor'
import { Translated } from './Translated'
import { useTicketTranslations } from '../../hooks/useReading'
import { usePrefs, GLOBAL_SCOPE } from '../../hooks/usePrefs'
import { mergeDescriptionEdits } from '../../lib/timelineMerge'
import { useQueryClient } from '@tanstack/react-query'
import { fileRefs } from '../../lib/fileRefs'
import { pruneDroppedFiles } from '../../lib/pruneFiles'
import { displayTime, exactTime, useDateFormat } from '../../lib/time'

/**
 * One stream of everything that happened on the ticket — activity log and
 * comments interleaved — with the comment composer at the top. Newest first, so
 * the latest change is what you see; posting a comment drops it in at the top.
 * Consecutive entries by the SAME person within a few minutes — activities and
 * comments alike — collapse into one grouped block; a different person or a gap
 * over 5 minutes starts a fresh block. The comment_added/removed activity rows
 * are dropped because the comments themselves are shown.
 */
type Unit =
  | { type: 'activity'; id: string; at: string; key: string; name: string; actor: TicketActivity['actor']; a: TicketActivity }
  | { type: 'comment'; id: string; at: string; key: string; name: string; actor: TicketComment['author']; c: TicketComment }

type Row =
  | { kind: 'single'; id: string; u: Unit }
  | { kind: 'group'; id: string; at: string; name: string; actor: Unit['actor']; units: Unit[] }

const time = displayTime
const clock = displayTime

const GROUP_MS = 5 * 60 * 1000
/** Aynı kişinin art arda açıklama düzeltmeleri bu aralıkla zincirlenip tek satır olur (#e8bafa89). */
const DESC_MERGE_MS = 60 * 60 * 1000

const ChatIcon = () => (
  <Icon name="comment" />
)

export function TicketTimeline({ ticketId, teamId, ticket, statuses = [], canEdit = false, onCollapse, stacked = false }: { ticketId: string; teamId?: string | null; ticket?: Ticket | null; statuses?: TicketStatus[]; canEdit?: boolean; onCollapse?: () => void; stacked?: boolean }) {
  const t = useT()
  useDateFormat()   // repaint when the chosen date format changes
  const { user } = useAuth()
  const { data: comments = [] } = useComments(ticketId)
  // Translations of the comments into this reader's language (113): asked only when the reader and the team want them.
  const translations = useTicketTranslations(ticketId, teamId ?? null)
  const { data: activity = [] } = useTicketActivity(ticketId)
  const addComment = useAddComment()
  const deleteComment = useDeleteComment()
  const updateComment = useUpdateComment()
  const attachRecord = useAttachRecord()

  const [content, setContent] = useState('')
  const [composerKey, setComposerKey] = useState(0)
  // Düzenlenen yorum: kimliği ve üzerinde çalışılan metin (#5d077b0e).
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  // Yarım kalan yorum kaybolmasın (#e6b8797c): taslak sunucuda tutulur ve
  // görev yeniden açılınca kutuya geri konur.
  const draft = useCommentDraft(ticketId)
  const draftLoaded = useRef<string | null>(null)
  useEffect(() => {
    if (!draft.loaded || draftLoaded.current === ticketId) return
    draftLoaded.current = ticketId
    if (draft.initial && !content.replace(/\s|&nbsp;/g, '')) { setContent(draft.initial); setComposerKey((k) => k + 1) }
  }, [draft.loaded, draft.initial, ticketId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { draftLoaded.current = null }, [ticketId])
  const qc = useQueryClient()
  // Akış süzgeci (#e8bafa89): yalnız yorumlar ya da tümü; seçim hesapta saklanır.
  // Varsayılan yorumlar (#854fd59f): tercih yazılmamışsa da, eski `'comments'` değeri
  // yazılıysa da yorumlar; "Tümü" seçimi `'all'` olarak yazılır.
  const prefs = usePrefs(GLOBAL_SCOPE)
  const onlyComments = (prefs.prefs as { timeline?: string }).timeline !== 'all'
  const setOnlyComments = (v: boolean) => prefs.patch({ v: 1, timeline: v ? null : 'all' })
  /** Files pasted into the draft: the ones taken out again before sending leave Files (#0E2B2AB8). */
  const draftFiles = useRef<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // A comment can carry one action (#83CC7930): assign someone, close or block.
  // The comment is posted first and the change follows, so the log reads
  // "wrote a comment · closed the task" and the badge on the comment says why.
  const [action, setAction] = useState<CommentAction | null>(null)
  useEffect(() => { setAction(null) }, [ticketId])
  const members = useTeamMemberProfiles(teamId ?? null)
  const addAssignee = useAddAssignee()
  const updateTicket = useUpdateTicket()
  const closeStatus = statuses.find((s) => s.category === 'done') ?? statuses.find((s) => s.category === 'closed' && !s.is_cancelled) ?? null
  const blockStatus = statuses.find((s) => s.category === 'blocked') ?? null
  const alreadyDone = isCompleteStatus(ticket?.status_info)
  const alreadyBlocked = ticket?.status_info?.category === 'blocked'
  const assignable = members.filter((m) => !(ticket?.assignees ?? []).some((a) => a.user_id === m.id))
  const runAction = useCallback((a: CommentAction) => {
    if (!ticket) return
    if (a.kind === 'assign') { addAssignee.mutate({ ticketId, userId: a.user_id, user: members.find((m) => m.id === a.user_id) }); return }
    const s = a.kind === 'close' ? closeStatus : blockStatus
    if (!s || s.id === ticket.status_id) return
    updateTicket.mutate({ id: ticketId, input: { status_id: s.id, status: s.name } })
    if (a.kind === 'close' && !isCompleteStatus(ticket.status_info)) {
      const origins = Array.from(document.querySelectorAll<HTMLElement>('[data-celebrate-origin]'))
      celebrateTicket(ticketId, s.color, origins.find((o) => o.getBoundingClientRect().width > 0) ?? origins[0])
    }
  }, [ticket, ticketId, addAssignee, updateTicket, members, closeStatus, blockStatus])

  const units = useMemo<Unit[]>(() => {
    const acts: Unit[] = activity
      .filter((a) => a.kind !== 'comment_added' && a.kind !== 'comment_removed' && a.kind !== 'mentioned')
      .map((a) => ({
        type: 'activity', id: `a-${a.id}`, at: a.created_at,
        key: a.actor?.id || `n:${(a.meta?.by_name as string) || '?'}`,
        name: a.actor?.full_name || a.actor?.email || (a.meta?.by_name as string) || t('ticket.unknownUser'),
        actor: a.actor, a,
      }))
    const coms: Unit[] = comments.map((c) => ({
      type: 'comment', id: `c-${c.id}`, at: c.created_at,
      key: c.author_id || 'n:?', name: c.author?.full_name || c.author?.email || t('ticket.unknownUser'), actor: c.author, c,
    }))
    const all = [...acts, ...coms].sort((x, y) => y.at.localeCompare(x.at)) // newest first
    if (onlyComments) return all.filter((u) => u.type === 'comment')
    // Art arda açıklama düzeltmeleri tek satır (#e8bafa89, lib/timelineMerge.ts).
    return mergeDescriptionEdits(all, DESC_MERGE_MS)
  }, [activity, comments, t, onlyComments])

  // Fold consecutive same-person entries within the window into one block.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    let i = 0
    while (i < units.length) {
      const run: Unit[] = [units[i]]
      let j = i + 1
      while (j < units.length && units[j].key === run[0].key
        && new Date(run[run.length - 1].at).getTime() - new Date(units[j].at).getTime() <= GROUP_MS) {
        run.push(units[j]); j++
      }
      if (run.length >= 2) out.push({ kind: 'group', id: `g-${run[0].id}`, at: run[0].at, name: run[0].name, actor: run[0].actor, units: run })
      else out.push({ kind: 'single', id: run[0].id, u: run[0] })
      i = j
    }
    return out
  }, [units])

  // After posting, bring the top (where the new comment lands) into view.
  const listRef = useRef<HTMLDivElement>(null)
  const jumpTop = useRef(false)
  useEffect(() => {
    if (stacked || !jumpTop.current || !listRef.current) return
    jumpTop.current = false
    listRef.current.scrollTo({ top: 0, behavior: 'smooth' })
  }, [rows.length, stacked])

  const empty = !content.replace(/\s|&nbsp;/g, '')
  // A half-written comment holds back automatic updates (#5A06299B).
  useEffect(() => { setUnsaved(`comment:${ticketId}`, !empty); return () => setUnsaved(`comment:${ticketId}`, false) }, [empty, ticketId])
  // Yarım kalan bir **düzenleme** de kendiliğinden yenilemeyi tutar (#5d077b0e).
  useEffect(() => { setUnsaved(`comment-edit:${ticketId}`, !!editing); return () => setUnsaved(`comment-edit:${ticketId}`, false) }, [editing, ticketId])
  // Taslağı yazmaya ara verilince kaydet; pencere kapanırken beklemeden yaz.
  const contentRef = useRef(content); contentRef.current = content
  useEffect(() => { if (draftLoaded.current === ticketId) draft.save(content) }, [content]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (draftLoaded.current === ticketId) draft.flush(contentRef.current) }, [ticketId]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = useCallback(async () => {
    if (empty || addComment.isPending) return
    jumpTop.current = true
    await addComment.mutateAsync({ ticketId, content: content.trim(), action })
    if (action) runAction(action)
    setAction(null)
    const sent = new Set(fileRefs(content).map((r) => r.url))
    void pruneDroppedFiles(qc, ticketId, draftFiles.current.filter((u) => !sent.has(u)))
    draftFiles.current = []
    setContent('')
    draft.clear()
    setComposerKey((k) => k + 1)
  }, [empty, addComment, ticketId, content, qc, action, runAction, draft])

  /** Yorumu kaydet: metinden düşen dosyalar silme yolundaki gibi toplanır. */
  const saveEdit = async (c: TicketComment) => {
    if (!editing || editing.id !== c.id) return
    const next = editing.text.trim()
    if (!next || next === c.content) { setEditing(null); return }
    const before = fileRefs(c.content).map((r) => r.url)
    await updateComment.mutateAsync({ id: c.id, ticketId, content: next })
    setEditing(null)
    const kept = new Set(fileRefs(next).map((r) => r.url))
    void pruneDroppedFiles(qc, ticketId, before.filter((u) => !kept.has(u)))
  }

  /** Kendi yorumunun satır işlemleri: Düzenle ve Sil (#5d077b0e). */
  const rowBtns = (c: TicketComment) =>
    user?.id === c.author_id && (
      confirmDelete === c.id ? (
        <span className="flex items-center gap-1.5 text-xs">
          <button onClick={() => { deleteComment.mutate({ id: c.id, ticketId }, { onSuccess: () => void pruneDroppedFiles(qc, ticketId, fileRefs(c.content).map((r) => r.url)) }); setConfirmDelete(null) }} className="px-1.5 py-0.5 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700">{t('common.delete')}</button>
          <button onClick={() => setConfirmDelete(null)} className="text-fg-muted hover:text-fg-2">{t('common.giveUp')}</button>
        </span>
      ) : editing?.id === c.id ? null : (
        <span className="flex items-center gap-2">
          <button onClick={() => { setConfirmDelete(null); setEditing({ id: c.id, text: c.content }) }} className="inline-flex items-center justify-center min-h-6 min-w-6 px-1 opacity-0 group-hover/c:opacity-100 focus-visible:opacity-100 text-xs text-fg-faint hover:text-fg-2 transition-opacity">{t('common.edit')}</button>
          <button onClick={() => setConfirmDelete(c.id)} className="inline-flex items-center justify-center min-h-6 min-w-6 px-1 opacity-0 group-hover/c:opacity-100 focus-visible:opacity-100 text-xs text-fg-faint hover:text-danger transition-opacity">{t('common.delete')}</button>
        </span>
      )
    )

  // A comment that did something (#83CC7930) is a comment first — same bubble,
  // same body — but the bubble wears the event's colour: a thick left edge, a
  // tinted ground and a strip on top naming the action, so it reads at a glance
  // (kullanıcı: "sadece etiketten anlaşılmasın").
  const actionLabel = (a: NonNullable<TicketComment['action']>) =>
    a.kind === 'assign' ? t('ticket.comment.badgeAssign', { name: a.user_name }) : a.kind === 'close' ? t('ticket.comment.badgeClose', { status: a.status }) : t('ticket.comment.badgeBlock', { status: a.status })
  const actionTone = (a: NonNullable<TicketComment['action']>) =>
    a.kind === 'close'
      ? { edge: 'border-success', ground: 'bg-success/5', strip: 'bg-success/10 text-success', chip: 'bg-success/10 text-success' }
      : a.kind === 'block'
        ? { edge: 'border-warning', ground: 'bg-warning/5', strip: 'bg-warning/10 text-warning', chip: 'bg-warning/10 text-warning' }
        : { edge: 'border-primary-500', ground: 'bg-primary-500/5', strip: 'bg-primary-500/10 text-primary-700 dark:text-primary-300', chip: 'bg-primary-500/10 text-primary-700 dark:text-primary-300' }
  const actionIcon = (kind: NonNullable<TicketComment['action']>['kind']) =>
    kind === 'close'
      ? <Icon name="checkCircle" />
      : kind === 'block'
        ? <Icon name="ban" />
        : <Icon name="userAdd" />
  const actionBadge = (c: TicketComment) => {
    const a = c.action
    if (!a) return null
    return <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-2xs font-medium ${actionTone(a).chip}`}>{actionIcon(a.kind)}{actionLabel(a)}</span>
  }

  const bubbleEl = (c: TicketComment) => {
    // A posted comment can be as long as a description (#1E605419): the same
    // read-only view is used, so it gets the "tam ekran" button on hover and
    // the inline file preview without a second implementation.
    const a = c.action
    const tone = a ? actionTone(a) : null
    return (
      <div data-comment={c.id} className={`text-sm rounded-lg comment-md overflow-hidden border ${tone ? `${tone.edge} border-l-4 ${tone.ground}` : 'bg-raised/70 border-line-soft'}`}>
        {a && tone && (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${tone.strip}`}>
            {actionIcon(a.kind)}
            <span>{actionLabel(a)}</span>
          </div>
        )}
        <div className="px-3 py-2">
          {editing?.id === c.id ? (
            <div className="flex flex-col gap-2" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveEdit(c) } }}>
              <div className="rounded-lg border border-line focus-within:border-primary-400 transition-colors bg-surface">
                <DescriptionEditor
                  key={`edit-${c.id}`}
                  teamId={teamId}
                  value={editing.text}
                  onChange={(v) => setEditing((e) => (e && e.id === c.id ? { ...e, text: v } : e))}
                  ticketId={ticketId}
                  minHeight="60px"
                  maxHeight="40vh"
                  placeholder={t('ticket.comment.placeholder')}
                  fullscreenTitle={t('ticket.comment.editTitle')}
                  onUploaded={(url, file) => attachRecord.mutate({ ticketId, fileUrl: url, fileName: file.name || t('ticket.comment.imageName') })}
                />
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button type="button" onClick={() => void saveEdit(c)} disabled={updateComment.isPending || !editing.text.trim()}
                  className="px-2.5 py-1 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-50 cursor-pointer">{t('common.save')}</button>
                <button type="button" onClick={() => setEditing(null)} className="text-fg-muted hover:text-fg-2 cursor-pointer">{t('common.giveUp')}</button>
              </div>
            </div>
          ) : (
            <Translated original={c.content} row={translations.byKey.get(c.id)} reading={translations.reading}>
              {(text) => (
                <DescriptionEditor
                  readOnly
                  bare
                  value={text}
                  onChange={() => {}}
                  ticketId={ticketId}
                  minHeight="0px"
                  fullscreenTitle={t('ticket.comment.one')}
                  /* Yorumda blok çapası yok (#d46f6d70, kullanıcı 28 Eyl): paragraf
                     bağlantısı yorumlarda geri alındı; sayfalarda ve açıklamada var. */
                />
              )}
            </Translated>
          )}
        </div>
      </div>
    )
  }

  // Standalone (head): avatar + name + body. Inside a group: an activity-style row
  // (chat icon + "yorum ekledi" + right-aligned time) so it lines up with the
  // other entries in the block, then the comment body beneath.
  const commentNode = (c: TicketComment, at: string, head: boolean) => head ? (
    <div className="flex gap-2.5 group/c">
      <div className="mt-0.5 flex-shrink-0"><UserAvatar user={c.author} size="sm" /></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-fg-2">{c.author?.full_name || c.author?.email || t('ticket.unknownUser')}</span>
          {actionBadge(c)}
          <span className="text-xs text-fg-faint" title={exactTime(at)}>{time(at)}</span>
          {c.edited_at && <span className="text-xs text-fg-faint" title={exactTime(c.edited_at)}>· {t('ticket.comment.edited')}</span>}
          <span className="ml-auto">{rowBtns(c)}</span>
        </div>
        <div className="mt-1">{bubbleEl(c)}</div>
      </div>
    </div>
  ) : (
    <div className="group/c">
      <div className="flex items-start gap-1.5 text-sm text-fg-2 leading-relaxed">
        <span className="mt-0.5 w-4 h-4 text-fg-faint flex-shrink-0"><ChatIcon /></span>
        <span className="flex-1 min-w-0">{t('ticket.comment.added')} {actionBadge(c)}{c.edited_at && <span className="text-xs text-fg-faint" title={exactTime(c.edited_at)}> · {t('ticket.comment.edited')}</span>}</span>
        <span className="flex-shrink-0">{rowBtns(c)}</span>
        <time className="text-xs text-fg-faint flex-shrink-0" title={exactTime(at)}>{clock(at)}</time>
      </div>
      <div className="mt-1 ml-[22px]">{bubbleEl(c)}</div>
    </div>
  )

  const activityFull = (a: TicketActivity, at: string) => (
    <div className="flex items-start gap-2 text-xs leading-relaxed">
      <span className="mt-0.5 w-5 h-5 rounded-full bg-raised text-fg-faint flex items-center justify-center flex-shrink-0"><KindIcon kind={a.kind} /></span>
      {a.actor ? <UserAvatar user={a.actor} size="sm" /> : null}
      <span className="flex-1 min-w-0 text-fg-2">
        <span className="font-medium text-fg">{a.actor?.full_name || a.actor?.email || (a.meta?.by_name as string) || t('ticket.unknownUser')}</span>{' '}
        <Sentence a={a} />
      </span>
      <time className="text-xs text-fg-faint flex-shrink-0" title={exactTime(at)}>{time(at)}</time>
    </div>
  )

  // An activity inside a group: no avatar/name (the header carries them).
  const activityLine = (a: TicketActivity) => (
    <div className="flex items-start gap-1.5 text-sm text-fg-2 leading-relaxed">
      <span className="mt-0.5 w-4 h-4 text-fg-faint flex-shrink-0"><KindIcon kind={a.kind} /></span>
      <span className="flex-1 min-w-0"><Sentence a={a} /></span>
      <time className="text-xs text-fg-faint flex-shrink-0" title={exactTime(a.created_at)}>{clock(a.created_at)}</time>
    </div>
  )

  return (
    <div data-tour="ticket-activity" className={stacked ? 'flex flex-col' : 'flex flex-col md:h-full min-h-0'}>
      <div className={stacked ? 'flex items-center mb-3' : 'px-4 py-2.5 border-b border-line-soft flex-shrink-0 flex items-center'}>
        <h3 className={stacked ? 'text-xs font-semibold text-fg-faint uppercase tracking-wider' : 'text-sm font-semibold text-fg'}>{t('ticket.activityAndComments')}</h3>
        <div role="group" aria-label={t('ticket.timeline.filter')} className="ml-3 inline-flex rounded-lg border border-line p-0.5 text-xs" data-timeline-filter>
          {([true, false] as const).map((only) => (
            <button key={String(only)} type="button" aria-pressed={onlyComments === only} onClick={() => setOnlyComments(only)}
              className={`px-2 py-1 rounded-md transition-colors ${onlyComments === only ? 'bg-raised text-fg font-medium' : 'text-fg-muted hover:text-fg-2'}`}>
              {only ? t('ticket.timeline.comments', { n: comments.length }) : t('ticket.timeline.all')}
            </button>
          ))}
        </div>
        {onCollapse && (
          <button onClick={onCollapse} data-shortcut="ticket-panel" title={t('ticket.panel.hide')} aria-label={t('ticket.panel.hideAria')} className="ml-auto hidden md:flex w-7 h-7 items-center justify-center rounded-lg text-fg-faint hover:text-fg-2 hover:bg-raised transition-colors">
            <Icon name="chevronsRight" />
          </button>
        )}
      </div>

      {/* Composer at the top — the send button only appears once there is something to send */}
      <div className={stacked ? 'mb-3' : 'flex-shrink-0 border-b border-line-soft p-3'}>
        <div data-shortcut="ticket-comment" className="rounded-xl border border-line focus-within:border-primary-400 transition-colors" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() } }}>
          <DescriptionEditor
            key={`comment-${ticketId}-${composerKey}`}
            teamId={teamId}
            value={content}
            onChange={setContent}
            ticketId={ticketId}
            insertSlot="comment"
            toolbarOnFocus
            minHeight="60px"
            maxHeight="40vh"
            placeholder={t('ticket.comment.placeholder')}
            onUploaded={(url, file, inText) => { if (inText) draftFiles.current.push(url); attachRecord.mutate({ ticketId, fileUrl: url, fileName: file.name || t('ticket.comment.imageName') }) }}
          />
        </div>
        {canEdit && ticket && !empty && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs animate-fade-in">
            <span className="text-fg-faint">{t('ticket.comment.with')}</span>
            <select
              aria-label={t('ticket.comment.actAssign')}
              value={action?.kind === 'assign' ? action.user_id : ''}
              onChange={(e) => { const m = members.find((x) => x.id === e.target.value); setAction(m ? { kind: 'assign', user_id: m.id, user_name: m.full_name || m.email || '' } : null) }}
              className={`h-7 max-w-[180px] rounded-full border px-2 bg-surface text-xs cursor-pointer ${action?.kind === 'assign' ? 'border-primary-400 text-primary-700 dark:text-primary-300' : 'border-line text-fg-2'}`}
            >
              <option value="">{t('ticket.comment.actAssign')}</option>
              {assignable.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
            </select>
            {!alreadyDone && (
              <button type="button" aria-pressed={action?.kind === 'close'} disabled={!closeStatus} title={closeStatus ? closeStatus.name : t('ticket.comment.noCloseStatus')}
                onClick={() => setAction(action?.kind === 'close' || !closeStatus ? null : { kind: 'close', status: closeStatus.name })}
                className={`h-7 px-2.5 rounded-full border text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${action?.kind === 'close' ? 'border-success bg-success/10 text-success' : 'border-line text-fg-2 hover:bg-raised'}`}>
                {t('ticket.comment.actClose')}
              </button>
            )}
            {!alreadyBlocked && (
              <button type="button" aria-pressed={action?.kind === 'block'} disabled={!blockStatus} title={blockStatus ? blockStatus.name : t('ticket.comment.noBlockStatus')}
                onClick={() => setAction(action?.kind === 'block' || !blockStatus ? null : { kind: 'block', status: blockStatus.name })}
                className={`h-7 px-2.5 rounded-full border text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${action?.kind === 'block' ? 'border-warning bg-warning/10 text-warning' : 'border-line text-fg-2 hover:bg-raised'}`}>
                {t('ticket.comment.actBlock')}
              </button>
            )}
          </div>
        )}
        {!empty && (
          <div className="flex items-center justify-end mt-2 animate-fade-in">
            <button onClick={submit} disabled={addComment.isPending} className="px-4 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors">
              {addComment.isPending ? t('ticket.comment.sending') : action?.kind === 'assign' ? t('ticket.comment.sendAssign') : action?.kind === 'close' ? t('ticket.comment.sendClose') : action?.kind === 'block' ? t('ticket.comment.sendBlock') : t('ticket.comment.send')}
            </button>
          </div>
        )}
      </div>

      {/* One stream, newest first — its own scroll in the panel, page flow when stacked */}
      <div ref={listRef} className={stacked ? 'space-y-3' : 'flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-4 space-y-3'}>
        {rows.length === 0 && <p className="text-xs text-fg-faint">{t(onlyComments ? 'ticket.timeline.noComments' : 'ticket.timeline.empty')}</p>}
        {rows.map((r) => r.kind === 'single' ? (
          <div key={r.id}>{r.u.type === 'comment' ? commentNode(r.u.c, r.u.at, true) : activityFull(r.u.a, r.u.at)}</div>
        ) : (
          <div key={r.id} className="flex items-start gap-2 text-sm">
            {r.actor ? <UserAvatar user={r.actor} size="sm" /> : <span className="w-5 h-5 rounded-full bg-raised flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-fg">{r.name}</span>
                <span className="text-fg-muted text-xs">· {t('ticket.timeline.actions', { n: r.units.length })}</span>
                <time className="ml-auto text-xs text-fg-faint flex-shrink-0" title={exactTime(r.at)}>{time(r.at)}</time>
              </div>
              <div className="mt-1.5 space-y-2.5 border-l-2 border-line-soft pl-3">
                {r.units.map((u) => (
                  <div key={u.id}>{u.type === 'comment' ? commentNode(u.c, u.at, false) : activityLine(u.a)}</div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

    </div>
  )
}
