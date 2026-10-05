import { supabase } from './supabase'

export const ATTACHMENTS_BUCKET = 'ticket-attachments'

const STORAGE_MARK = '/storage/v1/object/'

/**
 * A stored file address, re-based on the origin the app is open on (#7B52DB8E).
 * File URLs are saved absolute with whatever host the uploader used
 * (`https://fira.flpconsulting.de/api/storage/…`). A colleague who opens Fira
 * on another host, or who clicked through the certificate warning (the local CA
 * is not installed on every PC), then sees every picture fail with
 * ERR_CERT_AUTHORITY_INVALID: the page's own host is allowed, the other one is
 * not. Rendering the same object through the current origin keeps pictures on
 * whichever host the page was loaded from. The stored value is never changed —
 * this is for `src`/`href` at render time only.
 */
export function displayUrl<T extends string | null | undefined>(url: T): T {
  if (!url || typeof window === 'undefined') return url
  const at = url.indexOf(STORAGE_MARK)
  if (at < 0 || !/^https?:\/\//i.test(url)) return url
  try {
    const u = new URL(url)
    if (u.origin === window.location.origin) return url
    return (window.location.origin + u.pathname + u.search + u.hash) as T
  } catch { return url }
}
if (typeof window !== 'undefined') (window as unknown as { __firaDisplayUrl?: typeof displayUrl }).__firaDisplayUrl = displayUrl

/**
 * Object path inside the bucket for a public URL this app produced
 * (`…/storage/v1/object/public/ticket-attachments/<path>?t=…`), or null when
 * the URL points somewhere else.
 */
export function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const marker = `/object/public/${ATTACHMENTS_BUCKET}/`
  const i = url.indexOf(marker)
  if (i === -1) return null
  const path = url.slice(i + marker.length).split(/[?#]/)[0]
  try { return decodeURIComponent(path) } catch { return path }
}

/**
 * Best-effort removal of files we no longer reference. Storage RLS lets a user
 * delete only what they uploaded (and admins everything), so this can silently
 * leave a file behind — the admin's orphan cleanup exists for exactly that.
 * Never throws: losing the record/reference is the operation that matters.
 */
export async function removeStorageUrls(urls: (string | null | undefined)[]): Promise<void> {
  const paths = [...new Set(urls.map(storagePathFromUrl).filter((p): p is string => !!p))]
  if (!paths.length) return
  try {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove(paths)
  } catch {
    /* ignore — see above */
  }
}
