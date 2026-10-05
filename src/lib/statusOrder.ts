import { STATUS_CATEGORY_ORDER, type StatusCategory } from '../types'

/**
 * Durum sırası ve kategori (#bc239e3c). Sütunlar kategori sırasında durmalı:
 * planlanmadı → aktif → engellendi → tamamlandı → kapatıldı (iptal edilen kapatılanın
 * da sonunda). Yeni durum eskiden kategorisine bakılmadan en sona ekleniyordu;
 * "Planlanıyor" gibi bir durum "Tamamlandı"nın sağına düşüyordu.
 *
 * Kural: mevcut sıra kullanıcı istemeden değişmez. Yeni durum yalnız kendi
 * kategorisinin sonuna yerleşir (diğerlerinin göreli sırası korunur); bütün listeyi
 * kategoriye göre dizmek liste ayarlarındaki düğmeyle, açıkça yapılır.
 */
type Categorized = { category: StatusCategory; is_cancelled?: boolean | null }

export function categoryRank(s: Categorized): number {
  const i = STATUS_CATEGORY_ORDER.indexOf(s.category)
  return (i < 0 ? STATUS_CATEGORY_ORDER.indexOf('active') : i) * 2 + (s.is_cancelled ? 1 : 0)
}

/** Yeni durumun gireceği sıra: kendi kategorisinden ya da öncekilerden olan son durumun hemen arkası. */
export function insertionIndex(statuses: readonly Categorized[], added: Categorized): number {
  const rank = categoryRank(added)
  let at = 0
  statuses.forEach((s, i) => { if (categoryRank(s) <= rank) at = i + 1 })
  return at
}

export function isCategorySorted(statuses: readonly Categorized[]): boolean {
  return statuses.every((s, i) => i === 0 || categoryRank(statuses[i - 1]) <= categoryRank(s))
}

/** Kategoriye göre kararlı sıralama: aynı kategoridekiler kendi aralarındaki sırayı korur. */
export function sortByCategory<T extends Categorized>(statuses: readonly T[]): T[] {
  return statuses
    .map((s, i) => ({ s, i }))
    .sort((a, b) => categoryRank(a.s) - categoryRank(b.s) || a.i - b.i)
    .map((x) => x.s)
}
