import { currentUser } from '../session'
import { uploadWithProgress } from '../uploads'
import { displayUrl } from '../storage'

/**
 * Images on a canvas live in storage under the canvas's own folder
 * (`<user>/<page id>/…`, like page images) and the scene keeps their address —
 * never the bytes: a scene with inline base64 pictures would be megabytes on
 * every save and every broadcast.
 */
const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif',
}
export const extFromMime = (mime: string) => MIME_EXT[mime] ?? (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5)

export async function uploadCanvasFile(pageId: string, blob: Blob, name?: string): Promise<string> {
  const user = await currentUser()
  if (!user) throw new Error('Oturum bulunamadı')
  const ext = extFromMime(blob.type || 'application/octet-stream')
  const path = `${user.id}/${pageId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  return uploadWithProgress(blob, path, pageId, { name: name ?? `görsel.${ext}` })
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const meta = dataUrl.slice(5, comma)
  const mime = meta.split(';')[0] || 'application/octet-stream'
  const body = dataUrl.slice(comma + 1)
  if (meta.includes(';base64')) {
    const bin = atob(body)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }
  return new Blob([decodeURIComponent(body)], { type: mime })
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** Stored file → data URL (Excalidraw keeps images as data URLs in memory; exports inline them). */
export async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(displayUrl(url))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return blobToDataUrl(await res.blob())
}

/** What a picture's bytes say it is — exports label everything text/plain. */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml'
  return null
}

/** Natural size of an image blob (for placing it at its own aspect ratio). */
export function imageSize(blob: Blob): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => { resolve({ w: img.naturalWidth || 320, h: img.naturalHeight || 240 }); URL.revokeObjectURL(url) }
    img.onerror = () => { resolve({ w: 320, h: 240 }); URL.revokeObjectURL(url) }
    img.src = url
  })
}

/** Download a blob under a file name (export). */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** A file name from a title: letters, digits, dashes. */
export function safeFileName(title: string, fallback: string) {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return base || fallback
}
