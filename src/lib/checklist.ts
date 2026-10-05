/**
 * Yapılacaklar listesi (#7c54fb70) — saf yardımcılar: sıra, ilerleme ve
 * yapıştırılan bir listeyi maddelere bölmek. Görev penceresi, pano kartı ve
 * liste görünümü aynı fonksiyonları kullanır; üçü aynı sayıyı göstersin.
 */
import type { ChecklistItem } from '../types'

export const CHECKLIST_TITLE_MAX = 500
/** Pano kartında gösterilen madde sayısı; fazlası "+N" olur. */
export const CARD_CHECKLIST_MAX = 5

/** Maddeler sırasıyla (eşit sırada eklenme zamanı, sonra kimlik). */
export function sortChecklist<T extends Pick<ChecklistItem, 'order_index' | 'id'> & { created_at?: string }>(items: readonly T[] | null | undefined): T[] {
  return [...(items ?? [])].sort((a, b) => a.order_index - b.order_index || (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id))
}

export interface ChecklistProgress { done: number; total: number; pct: number }

/** Tamamlanan / toplam ve yüzde (boş listede 0). */
export function checklistProgress(items: readonly Pick<ChecklistItem, 'done'>[] | null | undefined): ChecklistProgress {
  const total = items?.length ?? 0
  const done = items?.filter((i) => i.done).length ?? 0
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
}

/** Yeni maddenin sırası: sonuncunun bir fazlası. */
export const nextChecklistOrder = (items: readonly Pick<ChecklistItem, 'order_index'>[] | null | undefined) =>
  (items ?? []).reduce((m, i) => Math.max(m, i.order_index), -1) + 1

/**
 * Yapıştırılan metin birden çok satırsa her satır bir madde olur. Satır
 * başındaki madde işaretleri atılır (-, *, •, 1., 1), [ ], [x]); "[x]" ile
 * gelen madde işaretli başlar. Boş satırlar atlanır, uzunluk sınırda kesilir.
 * Tek satırsa null: normal yapıştırma sürsün.
 */
export function parseChecklistPaste(text: string): { title: string; done: boolean }[] | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return null
  return lines.map((line) => {
    let l = line.replace(/^(?:[-*•+]|\d{1,3}[.)])(?:\s+|$)/, '')
    const box = /^\[( |x|X)\]\s*/.exec(l)
    const done = !!box && box[1].toLowerCase() === 'x'
    if (box) l = l.slice(box[0].length)
    return { title: l.trim().slice(0, CHECKLIST_TITLE_MAX), done }
  }).filter((i) => i.title.length > 0)
}
