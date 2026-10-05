import { Fragment, useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import type { PageKind, Ticket, TicketAttachment, TicketStatus } from '../../types'
import { useT } from '../../i18n'
import { useChildTickets } from '../../hooks/useChildren'
import { useChecklist } from '../../hooks/useChecklist'
import { useIncomingLinks, useTicketLinks } from '../../hooks/useLinks'
import { useTicketPages } from '../../hooks/usePages'
import { useAttachments, useUpload } from '../../hooks/useUpload'
import { useBeta } from '../../hooks/useBeta'
import { useOpenNewPage } from '../page/useOpenNewPage'
import { TicketPages } from '../page/TicketPages'
import { ChildTicketList } from './ChildTicketList'
import { TicketChecklist } from './TicketChecklist'
import { AttachmentUpload } from './AttachmentUpload'

type SectionKey = 'subtasks' | 'checklist' | 'links' | 'pages' | 'files'
const KEYS: SectionKey[] = ['subtasks', 'checklist', 'links', 'pages', 'files']

interface Props {
  ticket: Ticket
  statuses: TicketStatus[]
  teamId: string | null
  canEdit: boolean
  canDelete: (createdBy: string) => boolean
  /** 3. seviyedeki görev: altına alt görev eklenemez. Üst görev yüklenirken `undefined`. */
  atMaxDepth: boolean | undefined
  onAttachmentDeleted: (att: TicketAttachment) => void
  onSetCover?: (url: string | null) => void
}

/**
 * Görev penceresinde açıklamanın altı (#7c54fb70). Eskiden beş bölüm (alt
 * görevler, yapılacaklar, bağlı görevler, sayfalar, dosyalar) boşken de başlık,
 * boş kutu ve açıklama cümlesiyle yer kaplıyordu. Şimdi:
 *
 *  - İçi dolu bölüm görünür; boş bölüm gizli.
 *  - Gizli bölümlerin başlangıçları tek bir **aksiyon listesinde**: Alt görev
 *    ekle, Yapılacak madde ekle, Görev bağla, Sayfa / Çizim / Whiteboard ekle,
 *    Dosya ekle. Basınca bölüm açılır ve işini yapar (kutuya odak, bağlama
 *    seçicisi, dosya seçme penceresi); bölüm görünür olunca aksiyon listeden
 *    düşer. Yeni bir bölüm türü buraya bir satır olarak eklenir.
 *  - Açılıp boş kalan bölümün başlığında ✕ (üzerine gelince): bölüm yeniden
 *    gizlenir, aksiyon listeye döner.
 *  - Pencere açıkken bir kez görünen bölüm yerinde kalır: son alt görev
 *    silinince liste kaybolup yerine aksiyon zıplamasın (✕ ile gizlenir).
 *
 * Görünürlük yalnız bu pencereye ait: başka görevde ya da yeniden açılışta
 * yine içeriğe göre başlar (TicketModal bileşeni görev kimliğiyle anahtarlar).
 */
export function TicketSections({ ticket, statuses, teamId, canEdit, canDelete, atMaxDepth, onAttachmentDeleted, onSetCover }: Props) {
  const t = useT()
  const { data: children } = useChildTickets(ticket.id)
  const { data: checklist } = useChecklist(ticket.id)
  const { data: links } = useTicketLinks(ticket.id)
  const { data: incoming } = useIncomingLinks(ticket.id)
  const { data: pages } = useTicketPages(ticket.id)
  const { data: attachments } = useAttachments(ticket.id)
  const { kinds } = useBeta()
  const openNew = useOpenNewPage()
  const upload = useUpload()

  const has: Record<SectionKey, boolean> = {
    subtasks: !!children?.length,
    checklist: !!checklist?.length,
    // ChildTicketList'in saydığı satırlar: karşı görevi görünenler.
    links: !!links?.some((l) => l.linked) || !!incoming?.some((l) => l.source),
    pages: !!pages?.length,
    files: !!attachments?.length,
  }
  const ready = !!children && !!checklist && !!links && !!incoming && !!pages && !!attachments && atMaxDepth !== undefined

  const [opened, setOpened] = useState<ReadonlySet<SectionKey>>(() => new Set())
  // Açılışta odaklanacak / seçicisini açacak bölüm. Bölüm bu render'da takılır,
  // kendi efekti okur; hemen ardından sıfırlanır ki sonradan (içerik gelince)
  // takılan bir bölüm eski isteği yeniden çalıştırmasın.
  const [intent, setIntent] = useState<SectionKey | null>(null)
  useEffect(() => { if (intent) setIntent(null) }, [intent])

  const hasKey = KEYS.map((k) => (has[k] ? '1' : '0')).join('')
  useEffect(() => {
    setOpened((prev) => {
      const add = KEYS.filter((k) => has[k] && !prev.has(k))
      return add.length ? new Set([...prev, ...add]) : prev
    })
  }, [hasKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (k: SectionKey) => has[k] || opened.has(k)
  const reveal = (k: SectionKey, withIntent = true) => {
    setOpened((prev) => (prev.has(k) ? prev : new Set([...prev, k])))
    if (withIntent) setIntent(k)
  }
  const hide = (k: SectionKey) => () => {
    setIntent(null)
    setOpened((prev) => { const next = new Set(prev); next.delete(k); return next })
  }

  // ── Aksiyon listesi ──
  const [creating, setCreating] = useState(false)
  const addPage = async (kind: PageKind) => {
    if (!teamId || creating) return
    setCreating(true)
    try { await openNew(teamId, { kind: 'ticket', id: ticket.id }, kind) } finally { setCreating(false) }
  }
  const [dropping, setDropping] = useState(false)
  const onDropFiles = async (e: DragEvent) => {
    e.preventDefault()
    setDropping(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    if (!files.length) return
    reveal('files', false)
    for (const file of files) await upload.mutateAsync({ file, ticketId: ticket.id })
  }

  const actions: { key: SectionKey; node: ReactNode }[] = []
  if (canEdit && ready) {
    if (!shown('subtasks') && !atMaxDepth) {
      actions.push({ key: 'subtasks', node: <ActionRow icon={ICONS.subtask} label={t('ticket.actions.subtask')} onClick={() => reveal('subtasks')} /> })
    }
    if (!shown('checklist')) {
      actions.push({ key: 'checklist', node: <ActionRow icon={ICONS.checklist} label={t('ticket.actions.checklist')} onClick={() => reveal('checklist')} /> })
    }
    if (!shown('links') && teamId) {
      actions.push({ key: 'links', node: <ActionRow icon={ICONS.link} label={t('ticket.actions.link')} onClick={() => reveal('links')} /> })
    }
    if (!shown('pages') && teamId) {
      const options: { kind: PageKind; label: string; aria: string }[] = [
        { kind: 'page', label: t('ticket.actions.page'), aria: t('page.addPage') },
        ...kinds.map((k) => ({ kind: k as PageKind, label: t(`ticket.actions.${k}`), aria: t(`canvas.add.${k}`) })),
      ]
      actions.push({
        key: 'pages',
        node: options.length === 1
          ? <ActionRow icon={ICONS.page} label={options[0].aria} onClick={() => void addPage('page')} disabled={creating} />
          : <PageKindsRow options={options} template={t('ticket.actions.addKinds')} disabled={creating} onPick={(k) => void addPage(k)} />,
      })
    }
    if (!shown('files')) {
      actions.push({
        key: 'files',
        node: (
          <ActionRow icon={ICONS.file} label={upload.isPending ? t('ticketExtra.attachment.uploading') : t('ticket.actions.file')} onClick={() => reveal('files')}
            active={dropping}
            onDragOver={(e) => { e.preventDefault(); setDropping(true) }} onDragLeave={() => setDropping(false)} onDrop={(e) => void onDropFiles(e)} />
        ),
      })
    }
  }

  // Gösterilecek bir şey yoksa (yazamayan kişi, boş görev) boş kutu bile koyma.
  if (!KEYS.some(shown) && actions.length === 0) return null

  return (
    // Tek kapsayıcı: tanıtım turu bölümleri ve aksiyon listesini birlikte gösterir.
    <div data-tour="ticket-sections" className="space-y-6">
      {shown('subtasks') && (
        <ChildTicketList parent={ticket} statuses={statuses} teamId={teamId} canEdit={canEdit} canDelete={canDelete} section="subtasks"
          atMaxDepth={!!atMaxDepth} onHide={hide('subtasks')} autoFocus={intent === 'subtasks'} />
      )}
      {shown('checklist') && (
        <TicketChecklist ticket={ticket} canEdit={canEdit} canConvert={atMaxDepth !== true} onHide={hide('checklist')} autoFocus={intent === 'checklist'} />
      )}
      {shown('links') && (
        <ChildTicketList parent={ticket} statuses={statuses} teamId={teamId} canEdit={canEdit} canDelete={canDelete} section="links"
          onHide={hide('links')} autoFocus={intent === 'links'} />
      )}
      {shown('pages') && <TicketPages ticketId={ticket.id} teamId={teamId} canEdit={canEdit} onHide={hide('pages')} />}
      {shown('files') && (
        <AttachmentUpload
          ticketId={ticket.id}
          onDeleted={onAttachmentDeleted}
          canDelete={(by) => canDelete(by)}
          canUpload={canEdit}
          canInsert={canEdit}
          coverUrl={ticket.cover_url ?? null}
          onSetCover={onSetCover}
          onHide={hide('files')}
          autoPick={intent === 'files'}
        />
      )}
      {actions.length > 0 && (
        <ul data-ticket-actions aria-label={t('ticket.actions.label')} className="-mx-2 space-y-0.5">
          {actions.map((a) => <li key={a.key} data-ticket-action={a.key}>{a.node}</li>)}
        </ul>
      )}
    </div>
  )
}

const rowClass = 'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm text-left transition-colors group/act'
const iconClass = 'w-4 h-4 flex-shrink-0 text-fg-faint group-hover/act:text-primary-600 dark:group-hover/act:text-primary-400 transition-colors'

function ActionRow({ icon, label, onClick, disabled, active, onDragOver, onDragLeave, onDrop }: {
  icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; active?: boolean
  onDragOver?: (e: DragEvent) => void; onDragLeave?: () => void; onDrop?: (e: DragEvent) => void
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      className={`${rowClass} disabled:opacity-50 ${active ? 'bg-primary-50 dark:bg-primary-950/30 text-fg ring-1 ring-primary-500' : 'text-fg-muted hover:text-fg hover:bg-raised'}`}>
      <span className={iconClass} aria-hidden>{icon}</span>
      {label}
    </button>
  )
}

/** "Sayfa / Çizim / Whiteboard ekle": tek satır, her tür kendi düğmesi. */
function PageKindsRow({ options, template, disabled, onPick }: {
  options: { kind: PageKind; label: string; aria: string }[]; template: string; disabled: boolean; onPick: (k: PageKind) => void
}) {
  // Çeviri kalıbı "{kinds} ekle" / "Add {kinds}": düğmeler kalıbın yerine oturur.
  const [pre, post = ''] = template.split('{kinds}')
  return (
    <div className="flex items-center gap-2.5 px-2 text-sm text-fg-muted">
      <span className="w-4 h-4 flex-shrink-0 text-fg-faint" aria-hidden>{ICONS.page}</span>
      <span className="flex flex-wrap items-center -ml-1.5">
        {pre.trim() && <span className="pl-1.5">{pre.trim()}</span>}
        {options.map((o, i) => (
          <Fragment key={o.kind}>
            {i > 0 && <span className="text-fg-faint" aria-hidden>/</span>}
            <button type="button" onClick={() => onPick(o.kind)} disabled={disabled} aria-label={o.aria} data-page-kind={o.kind}
              className="px-1.5 py-1.5 rounded-md hover:text-fg hover:bg-raised disabled:opacity-50 transition-colors">{o.label}</button>
          </Fragment>
        ))}
        {post.trim() && <span className="pr-1.5">{post.trim()}</span>}
      </span>
    </div>
  )
}

const ICONS = {
  subtask: <Icon name="subtask" />,
  checklist: <Icon name="checklist" />,
  link: <Icon name="link" />,
  page: <Icon name="pageAdd" />,
  file: <Icon name="attach" />,
}
