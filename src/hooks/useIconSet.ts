import { useSyncExternalStore } from 'react'
import type { FineIcon } from '../components/ui/iconFine'
import type { IconName } from '../components/ui/iconBold'

/**
 * İkon seti (#e8d26977): arayüz ikonlarının hangi çizimle görüneceği kişinin
 * tercihidir. `bold` kalın çizgili (Lucide, varsayılan), `fine` ince çizgili
 * (Fluent). Tema, palet ve yazı boyutu gibi localStorage'ta: ilk boyamadan
 * önce lazım, yoksa her açılışta ikonlar bir kare öbür setle görünür.
 *
 * Kalın set uygulamayla birlikte gelir; ince setin çizimleri ayrı bir parçadır ve
 * yalnız onu seçen indirir (`loadFineIcons`). İnce seti seçmiş biri için parça
 * uygulama çizilmeden önce yüklenir (`initIconSet`, main.tsx); yüklenemezse kalın
 * setle açılır.
 *
 * Tek bir modül deposu: ekrandaki bütün `Icon`'lar aynı değeri okur ve
 * seçim değişince birlikte yeniden çizilir.
 */
export const ICON_SETS = ['bold', 'fine'] as const
export type IconSet = (typeof ICON_SETS)[number]

const KEY = 'icons'
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

function read(): IconSet {
  try { return localStorage.getItem(KEY) === 'fine' ? 'fine' : 'bold' } catch { return 'bold' }
}
let current: IconSet = typeof localStorage === 'undefined' ? 'bold' : read()
let fine: Record<IconName, FineIcon> | null = null
let loading: Promise<void> | null = null

/** The fine set's drawings, once (also for the picker's preview of a set that is not the chosen one). */
export function loadFineIcons(): Promise<void> {
  loading ??= import('../components/ui/iconFine').then((m) => { fine = m.ICON_FINE; emit() }, () => { loading = null })
  return loading
}

/** Before the first paint: someone who chose the fine set gets its drawings before anything is drawn. */
export const initIconSet = () => (current === 'fine' ? loadFineIcons() : Promise.resolve())

export function setIconSet(set: IconSet) {
  current = set
  // Varsayılan anahtar yazmaz: varsayılan bir gün değişirse seçim yapmamış olan onu izler.
  try { if (set === 'bold') localStorage.removeItem(KEY); else localStorage.setItem(KEY, set) } catch { /* özel pencerede yazamayabiliriz */ }
  if (set === 'fine') void loadFineIcons()
  emit()
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const snapshot = () => (fine ? `${current}+` : current)

/** The chosen set. */
export function useIconSet(): IconSet {
  useSyncExternalStore(subscribe, snapshot, snapshot)
  return current
}

/** The fine set's drawings if they have arrived, else null (the bold set is drawn meanwhile). */
export function useFineIcons(): Record<IconName, FineIcon> | null {
  useSyncExternalStore(subscribe, snapshot, snapshot)
  return fine
}
