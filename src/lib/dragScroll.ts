/**
 * Sürüklerken kenara yaklaşınca kaydırma (#489eda17, kullanıcı 28 Eyl:
 * "dosyayı sürüklerken pencerenin üst kısmına fazla yaklaştırırsam scroll
 * etsin, hız da ne kadar yaklaştırdığımla doğru orantılı artsın").
 *
 * Dosyayı Dosyalar bölümünden açıklamaya taşımak çoğu zaman yukarı kaydırmak
 * demek; sürükleme sürerken tekerlek de kullanılamıyor. Bu yüzden imleç
 * kaydırılabilir kabın üst ya da alt kenarına yaklaştıkça kap kendiliğinden
 * kayar: eşiğin dışında hız sıfır, kenara değdiğinde en yüksek.
 *
 * Yalnız Fira'nın kendi dosya sürüklemesinde açılır (fileInsert başlatır);
 * tarayıcının kendi metin sürüklemesine karışmaz.
 */

/** Kenardan bu kadar yakınsa kaydırma başlar. */
const EDGE = 140
/** Kenara tam değdiğinde bir karede kaydırılan piksel (~60 kare/sn). */
const MAX_STEP = 18

let pointerY = 0
let pointerX = 0
let frame = 0
let active = false

const canScroll = (el: Element) => {
  const cs = getComputedStyle(el)
  const oy = cs.overflowY
  return (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 2
}

/** İmlecin altındaki en yakın kaydırılabilir kap (yoksa sayfanın kendisi). */
function scrollerUnder(x: number, y: number): Element | null {
  let el: Element | null = document.elementFromPoint(x, y)
  for (let i = 0; el && i < 20; i++, el = el.parentElement) {
    if (canScroll(el)) return el
  }
  const root = document.scrollingElement
  return root && root.scrollHeight > root.clientHeight + 2 ? root : null
}

function tick() {
  frame = 0
  if (!active) return
  const el = scrollerUnder(pointerX, pointerY)
  if (el) {
    const r = el === document.scrollingElement
      ? { top: 0, bottom: window.innerHeight }
      : el.getBoundingClientRect()
    const fromTop = pointerY - r.top
    const fromBottom = r.bottom - pointerY
    // Yakınlıkla orantılı hız: eşikte 0, kenarda MAX_STEP.
    if (fromTop < EDGE && fromTop > -EDGE) el.scrollTop -= MAX_STEP * Math.min(1, (EDGE - fromTop) / EDGE)
    else if (fromBottom < EDGE && fromBottom > -EDGE) el.scrollTop += MAX_STEP * Math.min(1, (EDGE - fromBottom) / EDGE)
  }
  frame = window.requestAnimationFrame(tick)
}

const onDragOver = (e: DragEvent) => { pointerX = e.clientX; pointerY = e.clientY }

export function startDragScroll() {
  if (active) return
  active = true
  document.addEventListener('dragover', onDragOver, true)
  frame = window.requestAnimationFrame(tick)
}

export function stopDragScroll() {
  if (!active) return
  active = false
  document.removeEventListener('dragover', onDragOver, true)
  if (frame) window.cancelAnimationFrame(frame)
  frame = 0
}
