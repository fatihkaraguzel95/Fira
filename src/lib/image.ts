import { t } from '../i18n'
import { displayUrl } from './storage'
/**
 * Client-side image resizing (canvas). Used for avatars so we never store or
 * download multi-megabyte originals for a 32px circle.
 */
export interface ResizeOptions {
  /** Longest edge in px. */
  max: number
  type?: 'image/webp' | 'image/jpeg' | 'image/png'
  quality?: number
  /** Crop to a centred square before resizing (avatars). */
  square?: boolean
}

export async function resizeImage(file: Blob, { max, type = 'image/webp', quality = 0.85, square = false }: ResizeOptions): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height
    if (square) {
      const side = Math.min(sw, sh)
      sx = Math.floor((sw - side) / 2)
      sy = Math.floor((sh - side) / 2)
      sw = sh = side
    }
    const scale = Math.min(1, max / Math.max(sw, sh))
    const w = Math.max(1, Math.round(sw * scale))
    const h = Math.max(1, Math.round(sh * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas desteklenmiyor')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
    if (!blob) throw new Error(t('common.imageConvertFailed'))
    return blob
  } finally {
    bitmap.close()
  }
}

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)

/**
 * A resized copy of one of our own storage objects, served by the Storage
 * image endpoint (imgproxy).
 *
 * List logos and card covers are stored at whatever size they were uploaded:
 * a 448 kB PNG was being downloaded for a 20 px square (#B98717D4). The same
 * object rendered at 96 px is 6.7 kB. Only public objects on this origin can be
 * transformed, so anything else is returned untouched — and callers should keep
 * an `onError` fallback to the original, because a self-hosted install without
 * imgproxy would otherwise show a broken image.
 */
const PUBLIC_OBJECT = '/storage/v1/object/public/'

export function thumbUrl(url: string | null | undefined, width: number): string | undefined {
  if (!url) return undefined
  url = displayUrl(url)
  const at = url.indexOf(PUBLIC_OBJECT)
  if (at < 0) return url
  const base = url.slice(0, at)
  const path = url.slice(at + PUBLIC_OBJECT.length)
  return `${base}/storage/v1/render/image/public/${path}?width=${width}&resize=contain&quality=80`
}
