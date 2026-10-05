import { useEffect, useRef, useState, DragEvent } from 'react'
import { Icon } from '../ui/Icon'
import { usePopupLayer } from '../../lib/popups'
import { createPortal } from 'react-dom'
import { useAttachments, useUpload, useDeleteAttachment, useRenameAttachment } from '../../hooks/useUpload'
import { PendingUploads } from '../ui/UploadProgress'
import { FileThumb } from '../ui/FileThumb'
import { useAuth } from '../../hooks/useAuth'
import type { TicketAttachment } from '../../types'
import { UserAvatar } from './UserAvatar'
import { AttachmentPreview } from './AttachmentPreview'
import { isImageUrl, downloadFile, copyText, formatFileDate } from '../../lib/files'
import { endFileDrag, insertFileInto, setFileDrag } from '../../lib/fileInsert'
import { useT } from '../../i18n'
import { SectionHide } from './SectionHide'

interface Props {
  ticketId: string
  /** Called after an attachment was removed (e.g. to strip it from the description too). */
  onDeleted?: (att: TicketAttachment) => void
  /** Who may delete/rename a given attachment. Defaults to "the uploader". */
  canDelete?: (uploadedBy: string) => boolean
  /** Whether the current user may add files. */
  canUpload?: boolean
  /** Inside a labeled tab: drop the collapsing "Files" heading, always open. */
  embedded?: boolean
  /** Current cover image url of the ticket (061), so the menu can toggle it. */
  coverUrl?: string | null
  /** Set/clear the card cover. Absent = the action is not offered. */
  onSetCover?: (url: string | null) => void
  /**
   * Dosyayı açıklamaya / yoruma koyabilir mi (#489eda17). Yazma yetkisi olan
   * herkes için açık; satırlar ayrıca editöre sürüklenebilir.
   */
  canInsert?: boolean
  /** Görev penceresi (#7c54fb70): boşken başlıktaki ✕ bölümü yeniden gizler. */
  onHide?: () => void
  /** Aksiyon listesindeki "Dosya ekle"den açıldı: dosya seçme penceresini hemen aç. */
  autoPick?: boolean
}

type ViewMode = 'grid' | 'list'
const VIEW_KEY = 'fira.attachments.view'

const readView = (): ViewMode => {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid' } catch { return 'grid' }
}

export function AttachmentUpload({ ticketId, onDeleted, canDelete, canUpload = true, embedded = false, coverUrl = null, onSetCover, canInsert = false, onHide, autoPick = false }: Props) {
  const t = useT()
  const { user } = useAuth()
  const { data: attachments = [], isLoading } = useAttachments(ticketId)
  const upload = useUpload()
  const deleteAttachment = useDeleteAttachment()
  const rename = useRenameAttachment()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [open, setOpen] = useState(true)
  const [view, setView] = useState<ViewMode>(readView)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view) } catch { /* ignore */ } }, [view])
  // Önce bölüm açılır, sonra dosya seçilir (#7c54fb70). Tıklamanın hemen ardından
  // çalıştığı için tarayıcı pencereyi açmaya izin veriyor.
  useEffect(() => { if (autoPick && canUpload) fileInputRef.current?.click() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const mayDelete = (att: TicketAttachment) =>
    canDelete ? canDelete(att.uploaded_by) : user?.id === att.uploaded_by

  const handleFiles = async (files: FileList | null) => {
    if (!files || !canUpload) return
    for (const file of Array.from(files)) {
      await upload.mutateAsync({ file, ticketId })
    }
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  const handleDelete = (att: TicketAttachment) => {
    deleteAttachment.mutate({ id: att.id, ticketId }, { onSuccess: () => onDeleted?.(att) })
    if (previewIndex !== null) {
      const remaining = attachments.length - 1
      if (remaining <= 0) setPreviewIndex(null)
      else setPreviewIndex(Math.min(previewIndex, remaining - 1))
    }
  }

  const handleRename = (att: TicketAttachment, name: string) => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === att.file_name) return
    rename.mutate({ id: att.id, ticketId, fileName: trimmed })
  }

  const downloadAll = async () => {
    for (const att of attachments) {
      await downloadFile(att.file_url, att.file_name)
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  const headerBtn = 'p-1.5 rounded-md text-fg-faint hover:text-fg-2 hover:bg-raised transition-colors'

  return (
    <div className="group">
      {/* Header. When there are files, the action buttons only appear on hover
          of the panel — otherwise they add clutter for the common case. */}
      <div className="group/sec flex items-center justify-between mb-2 min-h-[28px]">
        {embedded ? (
          <span />
        ) : (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 text-xs font-semibold text-fg-faint uppercase tracking-wider hover:text-fg-2"
            aria-expanded={open}
          >
            <Icon name="chevronRight" className={`transition-transform ${open ? 'rotate-90' : ''}`} />
            {t('ticketExtra.attachment.title')}
            {attachments.length > 0 && <span className="font-normal normal-case">{attachments.length}</span>}
          </button>
        )}

        {attachments.length > 0 && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button type="button" onClick={downloadAll} className={headerBtn} title={t('ticketExtra.attachment.downloadAll')} aria-label={t('ticketExtra.attachment.downloadAll')}>
              <Icon name="download" />
            </button>
            <button
              type="button"
              onClick={() => setView('grid')}
              className={`${headerBtn} ${view === 'grid' ? 'text-fg bg-raised' : ''}`}
              title={t('ticketExtra.attachment.gridView')} aria-label={t('ticketExtra.attachment.gridView')} aria-pressed={view === 'grid'}
            >
              <Icon name="grid" />
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={`${headerBtn} ${view === 'list' ? 'text-fg bg-raised' : ''}`}
              title={t('ticketExtra.attachment.listView')} aria-label={t('ticketExtra.attachment.listView')} aria-pressed={view === 'list'}
            >
              <Icon name="menu" />
            </button>
            <button type="button" onClick={() => setPreviewIndex(0)} className={headerBtn} title={t('ticketExtra.attachment.viewFullscreen')} aria-label={t('ticketExtra.attachment.viewFullscreen')}>
              <Icon name="maximize" />
            </button>
            {canUpload && (
              <button type="button" onClick={() => fileInputRef.current?.click()} className={headerBtn} title={t('ticketExtra.attachment.add')} aria-label={t('ticketExtra.attachment.add')}>
                <Icon name="plus" />
              </button>
            )}
          </div>
        )}
        {attachments.length === 0 && !isLoading && onHide && <SectionHide name={t('ticketExtra.attachment.title')} onHide={onHide} />}
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />

      {(open || embedded) && (
        attachments.length === 0 && !isLoading ? (
          /* Empty: a single "attach" row (drag onto it too) — no drop-zone prose. */
          canUpload ? (
            <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${isDragging ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30 text-fg' : 'border-line bg-field/40 text-fg-2 hover:bg-raised'}`}
            >
              <Icon name="attach" className="text-fg-faint" />
              {upload.isPending ? t('ticketExtra.attachment.uploading') : t('ticketExtra.attachment.add')}
              <Icon name="plus" className="ml-auto text-fg-faint" />
            </button>
            {/* The first file on its way already shows as its tile. */}
            <PendingUploads ticketId={ticketId} view={view} />
            </>
          ) : (
            <p className="text-xs text-fg-faint">{t('ticketExtra.attachment.empty')}</p>
          )
        ) : (
        <>
          {/* Drop zone (only once there are files; empty state uses the row above) */}
          {canUpload && (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl px-4 py-3 text-center cursor-pointer transition-colors ${
                isDragging
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30'
                  : 'border-line hover:border-fg-faint hover:bg-raised/60'
              }`}
            >
              {upload.isPending ? (
                <p className="text-sm text-primary-500">{t('ticketExtra.attachment.uploading')}</p>
              ) : (
                <p className="text-sm text-fg-faint">
                  {t('ticketExtra.attachment.dropHint')} <span className="text-primary-600 dark:text-primary-400 font-medium underline underline-offset-2">{t('ticketExtra.attachment.dropChoose')}</span>
                </p>
              )}
            </div>
          )}

          {/* Files still going up: their own tiles with a progress ring, before the finished ones. */}
          <PendingUploads ticketId={ticketId} view={view} />
          {isLoading ? (
            <div className="mt-3 text-xs text-fg-faint">{t('common.loading')}</div>
          ) : view === 'grid' ? (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pr-1">
              {attachments.map((att, i) => (
                <AttachmentCard
                  key={att.id}
                  att={att}
                  canDelete={mayDelete(att)}
                  canInsert={canInsert}
                  onOpen={() => setPreviewIndex(i)}
                  onDelete={() => handleDelete(att)}
                  onRename={(n) => handleRename(att, n)}
                  isCover={!!coverUrl && coverUrl === att.file_url}
                  onSetCover={onSetCover}
                />
              ))}
            </div>
          ) : (
            <div className="mt-3 border border-line rounded-xl divide-y divide-line-soft">
              {attachments.map((att, i) => (
                <AttachmentRow
                  key={att.id}
                  att={att}
                  canDelete={mayDelete(att)}
                  canInsert={canInsert}
                  onOpen={() => setPreviewIndex(i)}
                  onDelete={() => handleDelete(att)}
                  onRename={(n) => handleRename(att, n)}
                  isCover={!!coverUrl && coverUrl === att.file_url}
                  onSetCover={onSetCover}
                />
              ))}
            </div>
          )}
        </>
        )
      )}

      {previewIndex !== null && attachments[previewIndex] && (
        <AttachmentPreview
          items={attachments}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          canDelete={mayDelete}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────── */

interface ItemProps {
  att: TicketAttachment
  canDelete: boolean
  /** Dosyayı metne koyma seçenekleri (#489eda17). */
  canInsert?: boolean
  onOpen: () => void
  onDelete: () => void
  onRename: (name: string) => void
  isCover?: boolean
  onSetCover?: (url: string | null) => void
}

/** The file's picture: image, video frame, PDF page, text lines or a type icon (FileThumb). */
function Thumb({ att, className, compact = false }: { att: TicketAttachment; className: string; compact?: boolean }) {
  const t = useT()
  return <FileThumb url={att.file_url} name={att.file_name} className={className} compact={compact} fallbackLabel={t('ticketExtra.attachment.fileTypeFallback')} />
}

/** "⋯" menu shared by card and row. */
function ItemMenu({ att, canDelete, canInsert, onDelete, onRenameStart, onClose, anchor, isCover, onSetCover }: {
  att: TicketAttachment; canDelete: boolean; canInsert?: boolean; onDelete: () => void; onRenameStart: () => void; onClose: () => void; anchor: DOMRect
  isCover?: boolean; onSetCover?: (url: string | null) => void
}) {
  const t = useT()
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  usePopupLayer(true, ref, onClose)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true) }
  }, [onClose])

  const item = 'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-fg-2 hover:bg-raised hover:text-fg'

  // Rendered in a portal: the file list scrolls inside its own box, and an
  // absolutely positioned menu would be cut off at that box's edge.
  const width = 176
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))
  const top = Math.min(anchor.bottom + 4, window.innerHeight - 8)

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top, left, width }}
      className="z-50 bg-surface border border-line rounded-lg shadow-lg py-1 animate-fade-in"
      onClick={(e) => e.stopPropagation()}
    >
      <button className={item} onClick={() => { downloadFile(att.file_url, att.file_name); onClose() }}>
        <Icon name="download" />
        {t('common.download')}
      </button>
      <a className={item} href={att.file_url} target="_blank" rel="noopener noreferrer" onClick={onClose}>
        <Icon name="open" />
        {t('ticketExtra.openInNewTab')}
      </a>
      {/* Only an image can head a card, and only if the caller allows covers (061) */}
      {onSetCover && isImageUrl(att.file_url) && (
        <button className={item} onClick={() => { onSetCover(isCover ? null : att.file_url); onClose() }}>
          <Icon name="image" />
          {isCover ? t('ticketExtra.attachment.removeCover') : t('ticketExtra.attachment.setCover')}
        </button>
      )}
      {/* Metne koyma (#489eda17): sürükle-bırak da var ama tek giriş noktası
          sürükleme olmasın diye asıl yol bu menü. */}
      {canInsert && (
        <>
          <div className="my-1 border-t border-line-soft" />
          <button className={item} onClick={() => { insertFileInto({ ticketId: att.ticket_id, slot: 'description', file: { url: att.file_url, name: att.file_name } }); onClose() }}>
            <Icon name="listAdd" />
            {t('ticketExtra.attachment.toDescription')}
          </button>
          <button className={item} onClick={() => { insertFileInto({ ticketId: att.ticket_id, slot: 'comment', file: { url: att.file_url, name: att.file_name } }); onClose() }}>
            <Icon name="comment" />
            {t('ticketExtra.attachment.toComment')}
          </button>
          <div className="my-1 border-t border-line-soft" />
        </>
      )}
      <button className={item} onClick={async () => { await copyText(att.file_url); setCopied(true); setTimeout(onClose, 700) }}>
        <Icon name="link" />
        {copied ? t('common.copied') : t('ticketExtra.copyLink')}
      </button>
      {canDelete && (
        <>
          <button className={item} onClick={() => { onRenameStart(); onClose() }}>
            <Icon name="edit" />
            {t('common.rename')}
          </button>
          <div className="my-1 border-t border-line-soft" />
          {confirming ? (
            <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
              <button className="px-2 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold" onClick={() => { onDelete(); onClose() }}>{t('ticketExtra.confirmDelete')}</button>
              <button className="px-2 py-1 rounded-md text-fg-2 hover:bg-raised" onClick={() => setConfirming(false)}>{t('common.giveUp')}</button>
            </div>
          ) : (
            <button className={`${item} text-danger hover:text-danger`} onClick={() => setConfirming(true)}>
              <Icon name="trash" />
              {t('common.delete')}
            </button>
          )}
        </>
      )}
    </div>,
    document.body,
  )
}

function RenameInput({ value, onCommit, onCancel, className }: { value: string; onCommit: (v: string) => void; onCancel: () => void; className?: string }) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = value.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : value.length)
  }, [value])
  return (
    <input
      ref={ref}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onCommit(v)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); ref.current?.blur() }
        if (e.key === 'Escape') { e.preventDefault(); setV(value); onCancel() }
      }}
      className={`w-full text-xs bg-field border border-primary-500 rounded-md px-1.5 py-0.5 outline-none text-fg ${className ?? ''}`}
    />
  )
}

function AttachmentCard({ att, canDelete, canInsert, onOpen, onDelete, onRename, isCover, onSetCover }: ItemProps) {
  const t = useT()
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const [renaming, setRenaming] = useState(false)
  const actionBtn = 'p-1.5 rounded-md bg-black/55 text-white hover:bg-black/75 transition-colors'

  return (
    <div
      /* Editöre sürüklenebilir (#489eda17): görsel küçük resmi kendi başına da
         sürüklenir, olay köke geldiği için veriyi burada tek yerde koyuyoruz.
         İmleç **kopyalama** imleci (ok + artı): dosya metne kopyalanıyor,
         taşınmıyor; dört oklu "taşı" imleci yanlış şeyi söylüyordu (kullanıcı,
         28 Eyl). `cursor-grab` yasak: Chrome onu kendi bitmap'iyle çiziyor. */
      draggable
      data-attachment={att.id}
      title={t('ticketExtra.attachment.dragHint')}
      onDragStart={(e) => setFileDrag(e.dataTransfer, { url: att.file_url, name: att.file_name })}
      onDragEnd={endFileDrag}
      className="group relative rounded-xl border border-line bg-field/60 hover:border-fg-faint hover:shadow-lg transition-all cursor-copy"
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full aspect-[4/3] rounded-t-xl overflow-hidden bg-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        title={t('ticketExtra.attachment.view')}
      >
        <Thumb att={att} className="w-full h-full" />
      </button>

      {/* Hover actions */}
      <div className={`absolute top-1.5 right-1.5 flex items-center gap-1 ${menu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'} transition-opacity`}>
        <button type="button" onClick={onOpen} className={actionBtn} title={t('common.fullscreen')} aria-label={t('common.fullscreen')}>
          <Icon name="maximize" />
        </button>
        <div className="relative">
          <button type="button" onClick={(e) => setMenu((m) => (m ? null : e.currentTarget.getBoundingClientRect()))} className={actionBtn} title={t('common.more')} aria-label={t('common.moreActions')} aria-expanded={!!menu}>
            <Icon name="more" />
          </button>
          {menu && <ItemMenu att={att} canDelete={canDelete} canInsert={canInsert} onDelete={onDelete} onRenameStart={() => setRenaming(true)} onClose={() => setMenu(null)} anchor={menu} isCover={isCover} onSetCover={onSetCover} />}
        </div>
      </div>

      {/* Footer */}
      <div className="px-2.5 py-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <RenameInput value={att.file_name} onCommit={(v) => { setRenaming(false); onRename(v) }} onCancel={() => setRenaming(false)} />
          ) : (
            <p
              className={`text-xs font-medium text-fg truncate ${canDelete ? 'cursor-text' : ''}`}
              title={canDelete ? `${att.file_name} · ${t('ticketExtra.attachment.renameHint')}` : att.file_name}
              onDoubleClick={() => canDelete && setRenaming(true)}
            >
              {att.file_name}
            </p>
          )}
          <p className="text-2xs text-fg-faint truncate">{formatFileDate(att.created_at)}</p>
        </div>
        <span title={att.uploader?.full_name || att.uploader?.email || ''} className="flex-shrink-0">
          <UserAvatar user={att.uploader} size="sm" />
        </span>
      </div>
    </div>
  )
}

function AttachmentRow({ att, canDelete, canInsert, onOpen, onDelete, onRename, isCover, onSetCover }: ItemProps) {
  const t = useT()
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const [renaming, setRenaming] = useState(false)
  const iconBtn = 'p-1.5 rounded-md text-fg-faint hover:text-fg-2 hover:bg-raised transition-colors'

  return (
    <div
      draggable
      data-attachment={att.id}
      title={t('ticketExtra.attachment.dragHint')}
      onDragStart={(e) => setFileDrag(e.dataTransfer, { url: att.file_url, name: att.file_name })}
      onDragEnd={endFileDrag}
      className="group relative flex items-center gap-3 px-3 py-2 hover:bg-raised/60 first:rounded-t-xl last:rounded-b-xl cursor-copy"
    >
      <button type="button" onClick={onOpen} className="flex-shrink-0 w-10 h-10 rounded-md overflow-hidden border border-line-soft bg-raised" title={t('ticketExtra.attachment.view')}>
        <Thumb att={att} className="w-full h-full" compact />
      </button>
      <div className="min-w-0 flex-1">
        {renaming ? (
          <RenameInput value={att.file_name} onCommit={(v) => { setRenaming(false); onRename(v) }} onCancel={() => setRenaming(false)} className="max-w-md" />
        ) : (
          <button
            type="button"
            onClick={onOpen}
            onDoubleClick={() => canDelete && setRenaming(true)}
            title={canDelete ? `${att.file_name} · ${t('ticketExtra.attachment.renameHint')}` : att.file_name}
            className={`block max-w-full text-left text-xs font-medium text-fg truncate hover:text-primary-600 dark:hover:text-primary-400 ${canDelete ? 'cursor-text' : ''}`}
          >
            {att.file_name}
          </button>
        )}
        <p className="text-2xs text-fg-faint truncate">
          {formatFileDate(att.created_at)} · {att.uploader?.full_name || att.uploader?.email || '—'}
        </p>
      </div>
      <span className="flex-shrink-0 hidden sm:block"><UserAvatar user={att.uploader} size="sm" /></span>
      <div className={`flex items-center gap-0.5 flex-shrink-0 ${menu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'} transition-opacity`}>
        <button type="button" onClick={() => downloadFile(att.file_url, att.file_name)} className={iconBtn} title={t('common.download')} aria-label={t('common.download')}>
          <Icon name="download" />
        </button>
        <div className="relative">
          <button type="button" onClick={(e) => setMenu((m) => (m ? null : e.currentTarget.getBoundingClientRect()))} className={iconBtn} title={t('common.more')} aria-label={t('common.moreActions')} aria-expanded={!!menu}>
            <Icon name="more" />
          </button>
          {menu && <ItemMenu att={att} canDelete={canDelete} canInsert={canInsert} onDelete={onDelete} onRenameStart={() => setRenaming(true)} onClose={() => setMenu(null)} anchor={menu} isCover={isCover} onSetCover={onSetCover} />}
        </div>
      </div>
    </div>
  )
}
