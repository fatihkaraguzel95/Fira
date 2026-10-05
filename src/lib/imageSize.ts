import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorView, NodeView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { t } from '../i18n'
import { displayUrl } from './storage'
import { VIDEO_URL_RE } from './uploads'

/**
 * Görsel boyutu (#58789618): "ufak yazılar içeren kocaman bir görsel ile tek bir
 * ufacık ama yüksek çözünürlüklü ikon aynı kefede tutulmamalı".
 *
 * Genişlik markdown'ın **başlık** alanında taşınır: `![alt](url "w=360")`.
 * Markdown'da genişlik sözdizimi yok; başlık standarttır, dışarı kopyalanınca
 * bozulmaz ve okuma görünümü de aynı yerden okur. Tablo genişliğinde (#1E605419)
 * ayrı bir `{width=…}` satırı kullanılmıştı çünkü tablonun taşıyacak bir alanı
 * yoktu; görselin var.
 */
export const IMAGE_SIZES = [160, 360, 720] as const
/** Küçük resim (thumbnail) sayılan genişlik — metnin akışını bozmayan boy. */
export const THUMB_WIDTH = 160
const MIN_WIDTH = 80
const MAX_WIDTH = 1600

/** `"başlık w=360"` → `{ title: 'başlık', width: 360 }` */
export function readImageTitle(raw: string | null | undefined): { title: string | null; width: number | null } {
  const s = (raw ?? '').trim()
  const m = /(^|\s)w=(\d{2,4})$/.exec(s)
  if (!m) return { title: s || null, width: null }
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number(m[2])))
  const title = s.slice(0, m.index).trim()
  return { title: title || null, width }
}

/** Ters yön: başlık + genişlik → markdown başlığı. */
export function writeImageTitle(title: string | null | undefined, width: number | null | undefined): string | null {
  const base = (title ?? '').trim()
  if (!width) return base || null
  const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)))
  return base ? `${base} w=${w}` : `w=${w}`
}

/**
 * Görselin düğüm görünümü: seçince üstünde ölçü çubuğu (küçük resim · orta ·
 * büyük · tam genişlik) ve sağ alt köşesinde sürükleme tutamacı çıkar.
 */
class ImageView implements NodeView {
  dom: HTMLElement
  private media: HTMLImageElement | HTMLVideoElement
  private bar: HTMLElement
  private handle: HTMLElement
  private drag: { x: number; w: number } | null = null

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.dom = document.createElement('div')
    this.dom.className = 'fira-img'

    const src = displayUrl(String(node.attrs.src ?? ''))
    if (VIDEO_URL_RE.test(src)) {
      const v = document.createElement('video')
      v.src = src; v.controls = true; v.preload = 'metadata'; v.className = 'fira-video'
      this.media = v
    } else {
      const img = document.createElement('img')
      img.src = src
      img.alt = String(node.attrs.alt ?? '')
      this.media = img
    }

    this.bar = document.createElement('div')
    this.bar.className = 'fira-img-bar'
    this.bar.contentEditable = 'false'
    const preset = (label: string, width: number | null) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
      b.addEventListener('click', (e) => { e.preventDefault(); this.setWidth(width) })
      return b
    }
    this.bar.append(
      preset(t('ticket.editor.image.thumb'), THUMB_WIDTH),
      preset(t('ticket.editor.image.medium'), IMAGE_SIZES[1]),
      preset(t('ticket.editor.image.large'), IMAGE_SIZES[2]),
      preset(t('ticket.editor.image.full'), null),
    )

    this.handle = document.createElement('span')
    this.handle.className = 'fira-img-handle'
    this.handle.contentEditable = 'false'
    this.handle.title = t('ticket.editor.image.resize')
    this.handle.addEventListener('pointerdown', (e) => this.startDrag(e))

    this.dom.append(this.bar, this.media, this.handle)
    this.update(node)
  }

  private startDrag(e: PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    this.drag = { x: e.clientX, w: this.media.getBoundingClientRect().width }
    this.handle.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      if (!this.drag) return
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(this.drag.w + ev.clientX - this.drag.x)))
      this.media.style.width = `${w}px`
      this.media.style.maxHeight = 'none'
    }
    const onUp = (ev: PointerEvent) => {
      this.handle.removeEventListener('pointermove', onMove)
      this.handle.removeEventListener('pointerup', onUp)
      this.handle.removeEventListener('pointercancel', onUp)
      if (!this.drag) return
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(this.drag.w + ev.clientX - this.drag.x)))
      this.drag = null
      this.setWidth(w)
    }
    this.handle.addEventListener('pointermove', onMove)
    this.handle.addEventListener('pointerup', onUp)
    this.handle.addEventListener('pointercancel', onUp)
  }

  private setWidth(width: number | null) {
    const pos = this.getPos()
    if (pos === undefined) return
    const { title } = readImageTitle(this.node.attrs.title as string | null)
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      title: writeImageTitle(title, width),
    })
    // Seçim görselde kalsın ki çubuk kapanmasın.
    tr.setSelection(NodeSelection.create(tr.doc, pos))
    this.view.dispatch(tr)
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    const { width } = readImageTitle(node.attrs.title as string | null)
    this.media.style.width = width ? `${width}px` : ''
    this.media.style.maxWidth = '100%'
    // Genişlik elle verildiyse yükseklik sınırı kalkar (#0bb7ea0f): editör görselleri
    // için genel `max-height: 360px` + `object-fit: contain` kuralı, görsel o boyu
    // aşacak kadar büyütülünce onu büyütmüyor, kutunun ortasına sığdırıp yanlarına
    // boşluk bırakıyordu (küçük bir görseli 687 px'e çekmek 404 px'lik görsel verdi).
    this.media.style.maxHeight = width ? 'none' : ''
    if (this.media instanceof HTMLImageElement) this.media.alt = String(node.attrs.alt ?? '')
    return true
  }

  selectNode() { this.dom.classList.add('is-selected') }
  deselectNode() { this.dom.classList.remove('is-selected') }

  stopEvent(event: Event) {
    const el = event.target instanceof HTMLElement ? event.target : null
    return !!el?.closest('.fira-img-bar, .fira-img-handle')
  }

  ignoreMutation() { return true }
}

export const ImageTools = Extension.create({
  name: 'imageTools',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('imageTools'),
        props: {
          nodeViews: {
            image: (node, view, getPos) => new ImageView(node as PMNode, view as EditorView, getPos as () => number | undefined),
          },
        },
      }),
    ]
  },
})
