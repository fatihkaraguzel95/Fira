import { friendlyError } from './errorMessage'

/**
 * A tiny bus for the toasts about **your own last action**, separate from the
 * notification bridge (notify.ts), which carries other people's actions.
 * queryClient's MutationCache reports failures here globally, and any code can
 * call `emitError` for a failure it wants to explain or `emitToast` for a
 * confirmation ("Bağlantı panoya kopyalandı" — #d46f6d70, kullanıcı 28 Eyl:
 * düğmeye basılıp basılmadığı anlaşılmıyordu).
 */
export interface ErrorToast {
  id: string
  title: string
  detail?: string
  /** `success` yeşil onay; diğerleri hata tonunda çizilir (NotificationHost). */
  kind: string
  /**
   * Teknik özet: "Detay göster" ile açılır (#4e8dc8f1, kullanıcı 28 Eyl:
   * "teknik bir ekibiz, neyin ters gittiğini yorumlayabiliriz"). Kod, HTTP
   * durumu, sunucunun kendi mesajı ve varsa ipucu — hepsi tek satırda.
   */
  tech?: string
}

/** Hata nesnesinden okunabilir teknik özet. */
function techOf(e: unknown): string | undefined {
  const a = e as { code?: string; status?: number; message?: string; details?: string; hint?: string; name?: string }
  if (!a || typeof a !== 'object') return typeof e === 'string' ? e : undefined
  const parts = [
    a.code ? `code ${a.code}` : null,
    typeof a.status === 'number' ? `http ${a.status}` : null,
    a.message?.trim() || null,
    a.details?.trim() || null,
    a.hint?.trim() ? `ipucu: ${a.hint.trim()}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : (a.name ?? undefined)
}

type Listener = (t: ErrorToast) => void
const listeners = new Set<Listener>()

// Same failure firing twice in a breath (a retry, two mutations hitting the same
// limit) should read as one line, not a stack of identical toasts.
const recent = new Map<string, number>()

export function subscribeErrors(fn: Listener) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function emitError(e: unknown, contextDetail?: string) {
  const f = friendlyError(e, contextDetail)
  // A conflict is resolved inline where it happens (the ticket window), not as a toast.
  if (f.kind === 'conflict') return
  const dedupeKey = `${f.kind}:${f.title}`
  const now = Date.now()
  const last = recent.get(dedupeKey) ?? 0
  if (now - last < 4000) return
  recent.set(dedupeKey, now)
  const toast: ErrorToast = { id: `${dedupeKey}:${now}`, title: f.title, detail: f.detail, kind: f.kind, tech: techOf(e) }
  listeners.forEach((fn) => fn(toast))
}

/** Olumlu, kısa bilgi: "kopyalandı", "gönderildi" gibi. Aynı metin üst üste gelirse tek satır olur. */
export function emitToast(title: string, detail?: string) {
  const dedupeKey = `success:${title}`
  const now = Date.now()
  if (now - (recent.get(dedupeKey) ?? 0) < 2000) return
  recent.set(dedupeKey, now)
  const toast: ErrorToast = { id: `${dedupeKey}:${now}`, title, detail, kind: 'success' }
  listeners.forEach((fn) => fn(toast))
}
