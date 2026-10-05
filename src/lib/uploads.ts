import { useSyncExternalStore } from 'react'
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase'
import { t } from '../i18n'

/**
 * File uploads with progress (#FB541A31). supabase-js uploads with fetch,
 * which reports nothing until the file is in — a large video looked like
 * nothing happened. Uploads to the attachments bucket go through XHR here
 * and are tracked in a small store, so every view of the same ticket (the
 * description editor, the Files panel) shows the same progress bar.
 */
export const ATTACHMENTS_BUCKET = 'ticket-attachments'
/** nginx `client_max_body_size` for /api/storage/ (deploy/nginx/sites-available/fira). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export interface UploadProgress {
  id: string
  ticketId: string
  name: string
  loaded: number
  total: number
}

let uploads: UploadProgress[] = []
const listeners = new Set<() => void>()
const emit = () => { uploads = [...uploads]; listeners.forEach((l) => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** Uploads in flight for one ticket (or page — anything with an id), newest last. */
export function useUploads(ticketId: string | undefined): UploadProgress[] {
  const all = useSyncExternalStore(subscribe, () => uploads)
  return ticketId ? all.filter((u) => u.ticketId === ticketId) : []
}

/** Too big for the server: a ready sentence (code 23514 → errorMessage shows it as is). */
export class UploadTooLargeError extends Error {
  code = '23514'
  constructor(public fileName: string, public bytes: number) {
    super(t('ticketExtra.attachment.tooLarge', { name: fileName, size: (bytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 }), max: String(MAX_UPLOAD_BYTES / 1048576) }))
  }
}

/**
 * Uploads `file` to the attachments bucket at `path` and returns its public
 * URL. Progress is published under `ticketId` while it runs.
 */
export async function uploadWithProgress(
  file: File | Blob, path: string, ticketId: string,
  opts: { name?: string; onProgress?: (loaded: number, total: number) => void } = {},
): Promise<string> {
  const name = opts.name ?? ((file as File).name || 'dosya')
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadTooLargeError(name, file.size)
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Oturum bulunamadı')

  const entry: UploadProgress = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ticketId, name, loaded: 0, total: file.size }
  uploads.push(entry); emit()
  const update = (loaded: number) => {
    uploads = uploads.map((u) => (u.id === entry.id ? { ...u, loaded } : u)); listeners.forEach((l) => l())
    opts.onProgress?.(loaded, file.size)
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const encoded = path.split('/').map(encodeURIComponent).join('/')
      xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${ATTACHMENTS_BUCKET}/${encoded}`)
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY)
      xhr.setRequestHeader('x-upsert', 'false')
      xhr.setRequestHeader('cache-control', 'max-age=3600')
      if (file.type) xhr.setRequestHeader('Content-Type', file.type)
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) update(e.loaded) }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) { update(file.size); resolve(); return }
        if (xhr.status === 413) { reject(new UploadTooLargeError(name, file.size)); return }
        let msg = xhr.statusText || `HTTP ${xhr.status}`
        try { const body = JSON.parse(xhr.responseText); msg = body.message || body.error || msg } catch { /* not JSON */ }
        reject(new Error(msg))
      }
      xhr.onerror = () => reject(new TypeError('Failed to fetch')) // classified as offline, like a fetch
      xhr.send(file)
    })
  } finally {
    uploads = uploads.filter((u) => u.id !== entry.id); emit()
  }
  return supabase.storage.from(ATTACHMENTS_BUCKET).getPublicUrl(path).data.publicUrl
}

/** Video files play in place (description, comments, read view) instead of showing as a link. */
export const VIDEO_URL_RE = /\.(mp4|webm|mov|m4v|ogv)(?:[?#].*)?$/i
export const isVideoFile = (f: { type?: string; name?: string }) => (f.type ?? '').startsWith('video/') || VIDEO_URL_RE.test(f.name ?? '')

/** "12,3 / 48 MB" */
export function formatProgress(u: UploadProgress): string {
  const mb = (n: number) => (n / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })
  return `${mb(u.loaded)} / ${mb(u.total)} MB`
}
