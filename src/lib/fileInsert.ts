/**
 * Dosyalar'daki bir belgeyi açıklamaya ya da yoruma koyma (#489eda17).
 *
 * Metne yapıştırılan dosya Dosyalar'a da giriyordu, ama tersi yoktu: yanlışlıkla
 * silinen bir görseli metne geri koymanın tek yolu dosyayı yeniden yüklemekti.
 * Artık Dosyalar'daki her satır (kaynağı ne olursa olsun) editöre sürüklenebilir
 * ve satırın ⋯ menüsünden açıklamaya ya da yorum kutusuna eklenebilir.
 *
 * İki yol da aynı yerden geçer: sürüklemede veri `dataTransfer`'a, menüde bir
 * olayla gider; editör ikisinde de aynı düğümü üretir (görsel/video için görsel
 * düğümü, diğer dosyalar için adıyla bir bağlantı).
 */
import { startDragScroll, stopDragScroll } from './dragScroll'
import { isImageUrl } from './files'
import { VIDEO_URL_RE } from './uploads'

export interface FileRef { url: string; name: string }
/** Hangi editör: görevin açıklaması mı, yorum kutusu mu. */
export type InsertSlot = 'description' | 'comment'

/** Kendi sürüklememiz: tarayıcının dosya sürüklemesiyle karışmasın diye ayrı tür. */
const MIME = 'application/x-fira-file'

export const isMediaUrl = (url: string) => isImageUrl(url) || VIDEO_URL_RE.test(url)

/** Metin kutularına düşerse de bir işe yarasın: markdown biçimi. */
export const markdownFor = (f: FileRef) => `${isMediaUrl(f.url) ? '!' : ''}[${f.name || f.url}](${f.url})`

export function setFileDrag(dt: DataTransfer, file: FileRef) {
  dt.effectAllowed = 'copy'
  dt.setData(MIME, JSON.stringify(file))
  dt.setData('text/uri-list', file.url)
  dt.setData('text/plain', markdownFor(file))
  beginFileDrag()
}

/**
 * Sürükleme sürerken bırakılabilecek yerler işaretlenir (kullanıcı, 25 Eyl:
 * "sürükleme başladığında bırakılabilecek hedeflerin highlight edilmesi
 * gerekiyor"). Sürükleme bittiğinde işaret kalkar; `dragend`/`drop` bazı
 * yollarda gelmediği için modül kendi güvenlik ağını da kurar.
 */
const DRAG_EVENT = 'fira:file-drag'
let dragging = false

export const isFileDragActive = () => dragging

const announce = () => window.dispatchEvent(new CustomEvent<boolean>(DRAG_EVENT, { detail: dragging }))

export function beginFileDrag() {
  if (dragging) return
  dragging = true
  // Kenara yaklaşınca kaydırma yalnız sürükleme sürerken açık kalır.
  startDragScroll()
  announce()
}

export function endFileDrag() {
  if (!dragging) return
  dragging = false
  stopDragScroll()
  announce()
}

export function onFileDragChange(fn: (on: boolean) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<boolean>).detail)
  window.addEventListener(DRAG_EVENT, handler)
  return () => window.removeEventListener(DRAG_EVENT, handler)
}

if (typeof window !== 'undefined') {
  // Fare bırakıldığında sürükleme her hâlükârda bitmiştir.
  window.addEventListener('dragend', endFileDrag, true)
  window.addEventListener('drop', endFileDrag, true)
}

export function readFileDrag(dt: DataTransfer | null | undefined): FileRef | null {
  const raw = dt?.getData(MIME)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<FileRef>
    return v?.url ? { url: String(v.url), name: String(v.name ?? '') } : null
  } catch {
    return null
  }
}

/** Editöre girecek içerik: görsel/video görsel düğümü, diğerleri bağlantı + boşluk. */
export function nodeFor(f: FileRef): object | object[] {
  if (isMediaUrl(f.url)) return { type: 'image', attrs: { src: f.url, alt: f.name } }
  return [
    { type: 'text', text: f.name || f.url, marks: [{ type: 'link', attrs: { href: f.url } }] },
    { type: 'text', text: ' ' },
  ]
}

const EVENT = 'fira:insert-file'
export interface InsertRequest { ticketId: string; slot: InsertSlot; file: FileRef }

export function insertFileInto(req: InsertRequest) {
  window.dispatchEvent(new CustomEvent<InsertRequest>(EVENT, { detail: req }))
}

export function onInsertFile(fn: (r: InsertRequest) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<InsertRequest>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
