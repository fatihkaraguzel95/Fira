/**
 * Sayfa içindeki bir bloğa bağlantı (#d46f6d70).
 *
 * Sayfalar düz markdown olarak saklanıyor; blokların kimliği yok. Bu yüzden
 * çapa **metinden** türetiliyor: `b<sıra>-<metnin-ilk-kelimeleri>`. Açan taraf
 * önce aynı metni arar, bulamazsa sıraya düşer — yani sayfa düzenlense de
 * bağlantı çoğu zaman doğru yere götürür, en kötü ihtimalle yakınına.
 *
 * Aynı kural hem okuma görünümünde (`.md-view`) hem editörde (`.ProseMirror`)
 * çalışır: ikisinde de en üst seviye blokların metnine bakılır.
 */
export const slugOf = (text: string) =>
  (text || '')
    .toLocaleLowerCase('tr')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

/** `b3-bu-bir-paragraf` — sıra ve metin birlikte, ikisi de çözümlemede kullanılıyor. */
export const anchorFor = (text: string, index: number) => `b${index + 1}-${slugOf(text)}`

const partsOf = (anchor: string) => {
  const m = /^b(\d+)-(.*)$/.exec(anchor.replace(/^#/, ''))
  return m ? { index: Number(m[1]) - 1, slug: m[2] } : { index: -1, slug: slugOf(anchor.replace(/^#/, '')) }
}

/** Sayfadaki blokları gezip çapanın işaret ettiğini bulur (önce metin, sonra sıra). */
export function findBlock(root: ParentNode | null, anchor: string, byIndexToo = true): HTMLElement | null {
  if (!root || !anchor) return null
  const blocks = [...root.children].filter((el): el is HTMLElement => el instanceof HTMLElement)
  if (!blocks.length) return null
  const { index, slug } = partsOf(anchor)
  if (slug) {
    const exact = blocks.find((el) => slugOf(el.textContent ?? '') === slug)
    if (exact) return exact
    const starts = blocks.find((el) => slugOf(el.textContent ?? '').startsWith(slug.slice(0, 24)))
    if (starts) return starts
  }
  // Sıraya düşmek yalnız son çare: sayfa çizilirken belge daha kısayken aynı
  // sıradaki blok başka bir şeydir, oraya atlayıp durmak yanlış yere götürür.
  return byIndexToo && index >= 0 && index < blocks.length ? blocks[index] : null
}

/**
 * Bloğu görünür alana getirir ve kısa bir vurguyla işaretler.
 *
 * Vurgu bloğun **üstüne** konan ayrı bir katman (#d46f6d70 2. tur): editörde
 * içerik ProseMirror'ın yönettiği DOM'da duruyor ve ilk yeniden çizimde bloğa
 * eklenen sınıf siliniyor — görev açıklamasında vurgu hiç görünmüyordu.
 * Katman sayfanın üstünde durduğu için kimin çizdiğinden bağımsız çalışır;
 * kaydırma sürerken bloğu takip eder.
 */
export function revealBlock(el: HTMLElement) {
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  const mark = document.createElement('div')
  mark.className = 'fira-block-mark'
  mark.setAttribute('aria-hidden', 'true')
  document.body.appendChild(mark)
  const place = () => {
    const r = el.getBoundingClientRect()
    mark.style.left = `${r.left - 4}px`
    mark.style.top = `${r.top - 2}px`
    mark.style.width = `${r.width + 8}px`
    mark.style.height = `${r.height + 4}px`
  }
  place()
  const follow = window.setInterval(place, 80)
  window.setTimeout(() => { window.clearInterval(follow); mark.remove() }, 2200)
}
