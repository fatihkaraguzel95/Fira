/**
 * Kod bloğu tercihleri — şimdilik tek seçenek: satır numarası (#58789618,
 * "bunu da kullanıcının tercihine bırakalım").
 *
 * Neden ayrı bir modül: tercih `user_preferences`'ta (React tarafı `usePrefs`
 * ile okuyup yazıyor), ama kod bloğunun düzenleyici görünümü düz bir
 * ProseMirror düğüm görünümü — hook kullanamıyor. Bu modül ikisi arasındaki
 * köprü: React tarafı değeri buraya yazıyor, düğüm görünümü buradan okuyup
 * değişimi dinliyor.
 */
let lineNumbers = false
const listeners = new Set<(v: boolean) => void>()

export const getCodeLineNumbers = () => lineNumbers

export function setCodeLineNumbers(value: boolean) {
  if (lineNumbers === value) return
  lineNumbers = value
  for (const fn of listeners) fn(value)
}

export function onCodeLineNumbers(fn: (v: boolean) => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
