/**
 * How a notification looks (#4029f71c): whose face it carries and how a status
 * is written where no styling is possible.
 *
 * A system notification is drawn by the operating system: a title, plain text
 * and one icon. The icon used to be Fira's own logo — which says nothing, the
 * popup already names the app — so it is now the face of the person who caused
 * it. The status chip of the inbox cannot be drawn there; the closest plain
 * text gets is a dot in the status' own colour in front of its name.
 */
import { avatarColor } from './avatarTone'

// The person's colour is one rule for the whole app: lib/avatarTone (the icon below draws the same circle).

export const initialsOf = (name: string) =>
  (name || '?').split(' ').filter(Boolean).map((part) => part[0]).join('').toUpperCase().slice(0, 2) || '?'

/** The coloured circles that exist as characters, with the colour each is usually drawn in. */
const DOTS: [string, [number, number, number]][] = [
  ['🔴', [221, 46, 68]],
  ['🟠', [244, 144, 12]],
  ['🟡', [253, 203, 88]],
  ['🟢', [120, 177, 89]],
  ['🔵', [85, 172, 238]],
  ['🟣', [170, 142, 214]],
  ['🟤', [193, 105, 79]],
]

function hue([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

/**
 * The dot closest to a status colour, or '' when there is no usable colour.
 * Greys have no hue to compare, so they go by lightness; everything else by hue
 * (brown and orange share one, so a dark orange reads as brown).
 */
export function statusDot(hex: string | null | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim())
  if (!m) return ''
  const n = parseInt(m[1], 16)
  const rgb: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const max = Math.max(...rgb), min = Math.min(...rgb)
  const light = (max + min) / 510
  const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255))
  if (sat < 0.2) return light > 0.55 ? '⚪' : '⚫'
  const h = hue(rgb)
  if (h >= 12 && h < 45 && light < 0.42) return '🟤'
  let best = DOTS[0][0], bestD = 361
  for (const [dot, c] of DOTS) {
    if (dot === '🟤') continue
    const d = Math.abs(hue(c) - h)
    const dist = Math.min(d, 360 - d)
    if (dist < bestD) { bestD = dist; best = dot }
  }
  return best
}

export interface NotifyActor { id: string | null; name: string; avatarUrl: string | null }

const FALLBACK_ICON = '/icons/icon-192.png'
const icons = new Map<string, Promise<string>>()

/**
 * How big the icon is drawn (#849ca7fe). Windows shows a toast's picture at 48 px times the
 * display scale and, in the popup, scales a larger picture down without smoothing: a 192 px
 * circle arrived with stair-stepped edges and letters (the same picture looked fine later in
 * the notification centre, which does smooth). So on Windows the icon is drawn at exactly the
 * size it is shown; elsewhere the systems smooth and want a large picture.
 * `ratio` is the page's devicePixelRatio, which also moves with the page zoom: it is snapped
 * to the display scales Windows offers, so a zoomed window still gets a sensible size.
 */
const WINDOWS_SCALES = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 3.5, 4]
export function notificationIconSize(userAgent: string, ratio: number): number {
  if (!/Windows/i.test(userAgent)) return 192
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  const scale = WINDOWS_SCALES.reduce((best, x) => (Math.abs(x - r) < Math.abs(best - r) ? x : best), 1)
  return Math.round(48 * scale)
}
const iconSize = () => notificationIconSize(typeof navigator === 'undefined' ? '' : navigator.userAgent, typeof window === 'undefined' ? 1 : window.devicePixelRatio)

function canvasOf(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return [canvas, ctx]
}

function circle(SIZE: number, draw: (ctx: CanvasRenderingContext2D) => void): string | null {
  const made = canvasOf(SIZE)
  if (!made) return null
  const [canvas, ctx] = made
  ctx.beginPath()
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  draw(ctx)
  return canvas.toDataURL('image/png')
}

function initialsIcon(actor: NotifyActor, SIZE: number): string | null {
  return circle(SIZE, (ctx) => {
    ctx.fillStyle = avatarColor(actor.id ?? actor.name)
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.fillStyle = '#ffffff'
    ctx.font = `600 ${Math.round(SIZE * 0.4)}px Inter, system-ui, "Segoe UI", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initialsOf(actor.name), SIZE / 2, SIZE / 2 + SIZE * 0.03)
  })
}

function photoIcon(url: string, SIZE: number): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const giveUp = window.setTimeout(() => resolve(null), 2500)
    img.onload = () => {
      window.clearTimeout(giveUp)
      try {
        // Cover the circle: the shorter side fills it, the rest is cropped around the centre.
        const side = Math.min(img.naturalWidth, img.naturalHeight)
        resolve(circle(SIZE, (ctx) => ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE)))
      } catch { resolve(null) }   // a file served from another origin taints the canvas
    }
    img.onerror = () => { window.clearTimeout(giveUp); resolve(null) }
    img.src = url
  })
}

/**
 * Fira's own icon for a notification nobody caused (a reminder, "n more"), at the size it is
 * shown. Where the large picture is fine (not Windows) or it cannot be drawn, the file itself.
 */
export function appIcon(): Promise<string> {
  if (typeof document === 'undefined') return Promise.resolve(FALLBACK_ICON)
  const size = iconSize()
  if (size >= 192) return Promise.resolve(FALLBACK_ICON)
  const key = `${size}|app`
  let icon = icons.get(key)
  if (!icon) {
    icon = new Promise<string>((resolve) => {
      const img = new Image()
      const giveUp = window.setTimeout(() => resolve(FALLBACK_ICON), 2500)
      img.onload = () => {
        window.clearTimeout(giveUp)
        const made = canvasOf(size)
        if (!made) { resolve(FALLBACK_ICON); return }
        try { made[1].drawImage(img, 0, 0, size, size); resolve(made[0].toDataURL('image/png')) } catch { resolve(FALLBACK_ICON) }
      }
      img.onerror = () => { window.clearTimeout(giveUp); resolve(FALLBACK_ICON) }
      img.src = FALLBACK_ICON
    })
    icons.set(key, icon)
  }
  return icon
}

/**
 * The icon of a system notification: the actor's photo cut to a circle, their
 * initials on their avatar colour when there is no photo, and Fira's own icon
 * only when nobody caused the event (a reminder). Drawn once per person and
 * address for the session; never rejects. `resolve` re-bases a stored file
 * address on the page's own origin (`displayUrl`), which also keeps the canvas
 * readable; it is passed in so this module stays free of the storage client.
 */
export function notificationIcon(actor: NotifyActor | null | undefined, resolve: (url: string | null) => string | null = (u) => u): Promise<string> {
  if (typeof document === 'undefined') return Promise.resolve(FALLBACK_ICON)
  if (!actor) return appIcon()
  const size = iconSize()
  const key = `${size}|${actor.id ?? actor.name}|${actor.avatarUrl ?? ''}`
  let icon = icons.get(key)
  if (!icon) {
    icon = (async () => {
      try {
        const url = resolve(actor.avatarUrl)
        const photo = url ? await photoIcon(url, size) : null
        return photo ?? initialsIcon(actor, size) ?? FALLBACK_ICON
      } catch { return FALLBACK_ICON }
    })()
    icons.set(key, icon)
  }
  return icon
}
