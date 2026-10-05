/**
 * Açılır pencereler: aynı anda yalnız biri (#54b6bed6).
 *
 * Sorun: her açılır pencere "dışarıya tıklandı mı" diye belgede kendi `mousedown`
 * dinleyicisini tutuyordu. Tıklanan öğe yayılımı durduruyorsa (listede atama
 * düğmesinin sarmalayıcısı satırın sürüklenmesini önlemek için durdurur) açık
 * pencere tıklamayı hiç görmüyor ve açık kalıyordu: art arda dört satırın atama
 * düğmesine basınca dört pencere üst üste biniyordu.
 *
 * Çözüm: açık pencereler tek bir yığında durur.
 *  - Belgede **tek** dinleyici vardır ve yakalama aşamasında çalışır; yayılımı
 *    durduran bir öğe onu susturamaz. Tıklama hangi pencerenin (ya da onu açan
 *    öğenin) içindeyse o ve ataları kalır, gerisi kapanır; hiçbirinin içinde
 *    değilse hepsi kapanır.
 *  - Yeni bir pencere açılınca, atası olmayan bütün pencereler kapanır (klavyeyle
 *    açılanda da).
 *  - İç içe olanlar korunur: bir pencerenin içinden açılan pencere onun çocuğudur
 *    (açan öğe ötekinin içindeyse); çocuğa tıklamak ebeveyni kapatmaz.
 *
 * Yeni bir açılır pencere `usePopupLayer` çağırır; kendi `mousedown` dinleyicisini
 * yazmaz. Kapatma işlevi birden çok kez çağrılabilir olmalı.
 */
import { useEffect, useRef, type RefObject } from 'react'

interface Layer {
  el: () => HTMLElement | null
  anchor: () => HTMLElement | null
  close: () => void
  parent: Layer | null
}

const layers: Layer[] = []

const holds = (layer: Layer, node: Node) => !!layer.el()?.contains(node) || !!layer.anchor()?.contains(node)

/** Close every open layer except `keep` and its ancestors. */
function closeOthers(keep: Layer | null) {
  const safe = new Set<Layer>()
  for (let l = keep; l; l = l.parent) safe.add(l)
  for (const l of [...layers].reverse()) if (!safe.has(l)) l.close()
}

function onPointerDown(e: Event) {
  const node = e.target as Node | null
  if (!node) return
  let inside: Layer | null = null
  for (let i = layers.length - 1; i >= 0 && !inside; i--) if (holds(layers[i], node)) inside = layers[i]
  closeOthers(inside)
}

/** Register an open popup. Returns the function that takes it off the stack. */
export function openLayer(spec: { el: () => HTMLElement | null; anchor?: () => HTMLElement | null; close: () => void }): () => void {
  const anchor = spec.anchor ?? (() => null)
  // The parent is the innermost open popup this one was opened from.
  const from = anchor() ?? spec.el()
  let parent: Layer | null = null
  if (from) for (let i = layers.length - 1; i >= 0 && !parent; i--) if (layers[i].el()?.contains(from) && layers[i].el() !== spec.el()) parent = layers[i]
  const layer: Layer = { el: spec.el, anchor, close: spec.close, parent }
  closeOthers(parent)
  if (!layers.length) document.addEventListener('pointerdown', onPointerDown, true)
  layers.push(layer)
  return () => {
    const at = layers.indexOf(layer)
    if (at >= 0) layers.splice(at, 1)
    for (const l of layers) if (l.parent === layer) l.parent = layer.parent
    if (!layers.length) document.removeEventListener('pointerdown', onPointerDown, true)
  }
}

/** For tests. */
export const openLayerCount = () => layers.length

/**
 * A popup joins the stack while `active`. `el` is the popup (or the box that holds both
 * the popup and its trigger); `anchor` is what opened it, when that lies outside `el`.
 */
export function usePopupLayer(active: boolean, el: RefObject<HTMLElement | null>, close: () => void, anchor?: HTMLElement | null) {
  const closeRef = useRef(close); closeRef.current = close
  const anchorRef = useRef(anchor); anchorRef.current = anchor
  useEffect(() => {
    if (!active) return
    return openLayer({ el: () => el.current, anchor: () => anchorRef.current ?? null, close: () => closeRef.current() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
