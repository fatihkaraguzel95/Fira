import { useMemo, useState } from 'react'
import type { TicketAttachment } from '../../types'
import { useAttachments } from '../../hooks/useUpload'
import { fileRefs, fileNameFromUrl } from '../../lib/fileRefs'
import { AttachmentPreview } from './AttachmentPreview'

/**
 * A file clicked inside a text (description, comment, page) opens the same
 * viewer as the Files panel (#0E2B2AB8), stepping through the files of that
 * text with ←/→. A file that is also a ticket attachment shows its record
 * (name, uploader, date). No delete here: the text still shows the file —
 * removing it from the text removes it from Files (see `pruneDroppedFiles`).
 */
export function InlineFilePreview({ ticketId, content, url, onClose }: {
  ticketId?: string
  content: string
  url: string
  onClose: () => void
}) {
  const { data: attachments = [] } = useAttachments(ticketId ?? '')
  const refs = useMemo(() => {
    const r = fileRefs(content)
    return r.some((x) => x.url === url) ? r : [{ url, name: fileNameFromUrl(url) }, ...r]
  }, [content, url])
  const items = useMemo(() => refs.map((r): TicketAttachment => attachments.find((a) => a.file_url === r.url) ?? {
    id: r.url, ticket_id: ticketId ?? '', file_url: r.url, file_name: r.name, uploaded_by: '', created_at: '', uploader: null,
  }), [refs, attachments, ticketId])
  const [index, setIndex] = useState(() => Math.max(0, refs.findIndex((r) => r.url === url)))
  return <AttachmentPreview items={items} index={index} onIndexChange={setIndex} onClose={onClose} canDelete={() => false} onDelete={() => {}} />
}
