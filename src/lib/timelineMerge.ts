/**
 * Görev akışında art arda açıklama düzeltmelerini tek satıra indirir (#e8bafa89):
 * "açıklamayı güncelledi (+2 karakter)" gibi satırlar akışı dolduruyor, ayrıntıyı
 * bastırıyordu. Liste yeniden eskiye sıralı gelir. Birleşme şartı: aynı kişi, arada
 * başka kayıt yok ve iki düzeltme arası en fazla `windowMs` (zincirlenir). Birleşen
 * satır en yeni kaydı taşır; `meta.from_len` en eskisinden gelir (net değişim),
 * `meta.merged` kaç düzeltme olduğunu söyler.
 */
type Entry = { type: string; key: string; at: string; a?: { kind: string; meta?: Record<string, unknown> | null } }

export function mergeDescriptionEdits<T extends Entry>(newestFirst: readonly T[], windowMs: number): T[] {
  const out: T[] = []
  let chainAt = ''
  for (const u of newestFirst) {
    const prev = out[out.length - 1]
    if (u.type === 'activity' && u.a?.kind === 'description' && prev?.type === 'activity' && prev.a?.kind === 'description'
      && prev.key === u.key && new Date(chainAt).getTime() - new Date(u.at).getTime() <= windowMs) {
      const times = Number(prev.a.meta?.merged ?? 1) + 1
      out[out.length - 1] = { ...prev, a: { ...prev.a, meta: { ...prev.a.meta, from_len: u.a.meta?.from_len, merged: times } } }
      chainAt = u.at
      continue
    }
    out.push(u)
    chainAt = u.at
  }
  return out
}
