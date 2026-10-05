import { useCallback, useEffect, useMemo, useRef } from 'react'
import { usePrefs, GLOBAL_SCOPE } from './usePrefs'

/**
 * Simge durumuna küçültülen görevler ve yarım kalan yorumlar (#e6b8797c).
 *
 * İki ayrı şey, aynı yerde saklanıyor (`user_preferences` global kapsam):
 *   • `tray`   — küçültülmüş görevlerin sırası; sağ alttaki çubuk bunu çizer.
 *   • `drafts` — gönderilmemiş yorum metinleri (görev başına bir taslak).
 *
 * Neden sunucuda: tercihlerin yeri orası (localStorage'a yeni tercih yazılmıyor),
 * ayrıca taslak ve çubuk başka sekmede/bilgisayarda da bulunsun — ClickUp'ın
 * Task Tray'i de sekmeler arasında taşınıyor. Taslak yazarken her tuşta değil,
 * yazmaya ara verilince (1,5 sn) yazılır.
 */
const MAX_TRAY = 12
const MAX_DRAFTS = 20
const MAX_DRAFT_CHARS = 20_000
const SAVE_DELAY = 1500

interface Draft { text: string; at: string }
type Drafts = Record<string, Draft>

export function useTray() {
  const prefs = usePrefs(GLOBAL_SCOPE)
  const data = prefs.prefs as { tray?: string[]; drafts?: Drafts }
  const ids = useMemo(() => (Array.isArray(data.tray) ? data.tray.filter((x) => typeof x === 'string') : []), [data.tray])

  const add = useCallback((id: string) => {
    const next = [id, ...ids.filter((x) => x !== id)].slice(0, MAX_TRAY)
    prefs.patch({ v: 1, tray: next })
  }, [ids, prefs])

  const remove = useCallback((id: string) => {
    prefs.patch({ v: 1, tray: ids.filter((x) => x !== id) })
  }, [ids, prefs])

  const clear = useCallback(() => prefs.patch({ v: 1, tray: [] }), [prefs])

  return { ids, add, remove, clear, loaded: prefs.loaded, has: (id: string) => ids.includes(id) }
}

/** Hangi görevlerde bekleyen taslak var — çubuk satırına nokta koymak için. */
export function useDraftIds(): Set<string> {
  const prefs = usePrefs(GLOBAL_SCOPE)
  const drafts = (prefs.prefs as { drafts?: Drafts }).drafts ?? {}
  return useMemo(() => new Set(Object.entries(drafts).filter(([, d]) => !!d?.text?.trim()).map(([id]) => id)), [drafts])
}

/**
 * Bir görevin yorum taslağı. `initial` yalnız ilk okumada doludur: editör
 * kurulurken kullanılır, sonra yazdıkça `save` çağrılır (gecikmeli).
 */
export function useCommentDraft(ticketId: string) {
  const prefs = usePrefs(GLOBAL_SCOPE)
  const drafts = (prefs.prefs as { drafts?: Drafts }).drafts ?? {}
  const initial = drafts[ticketId]?.text ?? ''
  const timer = useRef<number | null>(null)
  const patch = useRef(prefs.patch); patch.current = prefs.patch
  const allRef = useRef(drafts); allRef.current = drafts

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const write = useCallback((text: string) => {
    const trimmed = text.slice(0, MAX_DRAFT_CHARS)
    // Tercihler **anahtar bazında** birleşiyor (035): bir taslağı silmek için
    // anahtarı yazmamak yetmez, `null` göndermek gerekir — yoksa gönderilen
    // yorumun taslağı sunucuda kalıyor ve görev yeniden açılınca geri geliyordu
    // (#e6b8797c, kullanıcı raporu).
    const patchDrafts: Record<string, Draft | null> = {
      [ticketId]: trimmed.trim() ? { text: trimmed, at: new Date().toISOString() } : null,
    }
    // Kutu büyümesin: sınırı aşan en eski taslaklar da aynı yamada silinir.
    const rest = Object.entries(allRef.current)
      .filter(([id, d]) => id !== ticketId && !!d?.text?.trim())
      .sort((a, b) => (b[1].at ?? '').localeCompare(a[1].at ?? ''))
    for (const [id] of rest.slice(MAX_DRAFTS - 1)) patchDrafts[id] = null
    patch.current({ v: 1, drafts: patchDrafts })
  }, [ticketId])

  /** Yazarken çağrılır: son tuştan 1,5 sn sonra yazar. */
  const save = useCallback((text: string) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => write(text), SAVE_DELAY)
  }, [write])

  /** Gönderildi ya da temizlendi: beklemeden sil. */
  const clear = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    write('')
  }, [write])

  /** Pencere kapanırken beklemeden yaz (küçültme, sekme değiştirme). */
  const flush = useCallback((text: string) => {
    if (timer.current) window.clearTimeout(timer.current)
    write(text)
  }, [write])

  return { initial, loaded: prefs.loaded, save, clear, flush }
}
