/**
 * "Gecikmiş" kuralı tek yerde (#990dfec5): bitiş tarihi **bugünden önce** ve
 * görev **bitmemiş**.
 *
 * Önceden dört ayrı kopya vardı ve ikisi (pano kartı, liste) tamamlanmış
 * görevi de kırmızı ▲ ile gecikmiş gösteriyordu; pano kartı ayrıca günün
 * başı yerine şu anki saate bakıyordu, yani bugün biten görev sabah 03:00'ten
 * sonra gecikmiş sayılıyordu. `due_date` gün dizgesi (YYYY-MM-DD).
 */
export function isOverdue(due: string | null | undefined, now: Date = new Date(), done = false): boolean {
  if (!due || done) return false
  const d = new Date(due)
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  return d < startOfToday
}
