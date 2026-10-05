import { fold } from './fuzzy'

/**
 * "Görev bağla" çubuğunun adayları (#31b09040). Arama paletin dilini konuşur
 * (paletteQuery + `palette_search`), ama yalnız bulunulan listede; sonuçlar
 * puana göre değil **panodaki sırayla** gelir: önce durum sütunlarının sırası,
 * sütunun içinde kartların sırası. `liste:ad` ile başka bir listeden gelenler
 * kendi listelerine göre gruplanıp arkaya dizilir.
 */
export interface BoardOrdered {
  project_id: string
  order_index: number | null
  title: string
  status_info: { order_index?: number | null } | null
}

const LAST = Number.MAX_SAFE_INTEGER

export function sortLikeBoard<T extends BoardOrdered>(list: readonly T[], projectId: string): T[] {
  return [...list].sort((a, b) =>
    Number(a.project_id !== projectId) - Number(b.project_id !== projectId)
    || (a.project_id < b.project_id ? -1 : a.project_id > b.project_id ? 1 : 0)
    || (a.status_info?.order_index ?? LAST) - (b.status_info?.order_index ?? LAST)
    || (a.order_index ?? LAST) - (b.order_index ?? LAST)
    || a.title.localeCompare(b.title, 'tr'))
}

/**
 * Sunucuya gidecek kadar uzun olmayan yazı (tek harf): başlıkta geçen kelimeler,
 * Türkçe harf ve büyük/küçük harf farkı gözetmeden. Kelime yoksa hepsi geçer.
 */
export function matchesWords(title: string, words: readonly string[]): boolean {
  const t = fold(title)
  return words.every((w) => t.includes(fold(w)))
}
