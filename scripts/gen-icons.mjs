// Generates every derived brand asset from the master renders in design/brand/.
//   node scripts/gen-icons.mjs
//
// design/brand/*.png  (masters, not shipped)  ->  public/brand/*  +  public/icons/*
// The mark is a 3D render, so the shipped assets are PNG: there is no faithful
// SVG of it. The wordmark ships as an alpha mask and is tinted with currentColor
// by <FiraWordmark>, so it follows the theme.
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const SRC = 'design/brand'
const TILE_BG = '#0B1020'      // same navy as the dark app-icon render
const TILE_EDGE = '#243052'

mkdirSync('public/brand', { recursive: true })
mkdirSync('public/icons', { recursive: true })

const png = (p) => p.png({ compressionLevel: 9 })
const write = async (path, buf) => { await sharp(buf).toFile(path); console.log('wrote', path) }

/** Crop to the alpha bounding box — the renders sit on a big transparent canvas. */
async function trimAlpha(file, threshold = 8) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const box = { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  return { buf: await png(sharp(file).extract(box)).toBuffer(), ...box }
}

const mark = await trimAlpha(`${SRC}/mark.png`)
const word = await trimAlpha(`${SRC}/wordmark.png`)
console.log(`mark ${mark.width}x${mark.height}   wordmark ${word.width}x${word.height} (ratio ${(word.width / word.height).toFixed(4)})`)

/** The mark centred on a transparent square, `pad` of the side left as margin. */
async function squareMark(size, pad = 0.06) {
  const inner = Math.round(size * (1 - 2 * pad))
  const m = await png(sharp(mark.buf).resize(inner, inner, { fit: 'inside' })).toBuffer()
  return png(sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: m, gravity: 'centre' }])).toBuffer()
}

/** Rounded dark tile with the mark on it — the app icon (design/brand/app-icon-dark.png). */
async function tile(size, { radius = 0.235, mark: markShare = 0.58, bleed = false } = {}) {
  const inset = bleed ? 0 : size * 0.02
  const base = bleed
    ? sharp({ create: { width: size, height: size, channels: 4, background: TILE_BG } })
    : sharp(Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
        `<rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" ` +
        `rx="${size * radius}" fill="${TILE_BG}" stroke="${TILE_EDGE}" stroke-width="${size * 0.016}"/></svg>`))
  const m = await png(sharp(mark.buf).resize(Math.round(size * markShare), Math.round(size * markShare), { fit: 'inside' })).toBuffer()
  return png(base.composite([{ input: m, gravity: 'centre' }])).toBuffer()
}

// ── public/brand: what the app itself renders ────────────────────────────────
// Tight crop (no padding) so the mark sits flush next to the wordmark.
await write('public/brand/fira-mark.png', await png(sharp(mark.buf).resize({ height: 256 })).toBuffer())
console.log(`  <FiraMark> aspect ${(mark.width / mark.height).toFixed(4)}`)

// Wordmark as a white-on-transparent alpha mask (CSS mask-image + currentColor).
{
  const w = 720
  const h = Math.round((w * word.height) / word.width)
  const alpha = await sharp(word.buf).resize(w, h).ensureAlpha().extractChannel('alpha').toBuffer()
  const white = await sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } }).png().toBuffer()
  await write('public/brand/fira-wordmark.png', await png(sharp(white).joinChannel(alpha)).toBuffer())
}

// ── public/icons: favicon, PWA, iOS ──────────────────────────────────────────
for (const s of [16, 32, 48]) await write(`public/icons/favicon-${s}.png`, await squareMark(s, 0.02))
for (const s of [192, 512]) await write(`public/icons/icon-${s}.png`, await tile(s))
for (const s of [192, 512]) await write(`public/icons/maskable-${s}.png`, await tile(s, { bleed: true, mark: 0.56 }))
await write('public/icons/apple-touch-icon.png', await tile(180, { bleed: true, mark: 0.62 }))
