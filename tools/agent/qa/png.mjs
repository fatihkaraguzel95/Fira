/**
 * Cutting a rectangle out of a PNG, without a dependency.
 *
 * Why: a clipped `Page.captureScreenshot` turned out not to be the window with a piece cut out. A
 * region near the bottom of the window came back empty, twice, while the whole-window capture of
 * the same page had the text in it (0.95.1: the agent panel's footer; why Chrome does that was not
 * looked into). So `shot()` captures the whole window and cuts the piece here.
 *
 * Reads what Chrome writes: 8 bit, RGB or RGBA, not interlaced. Writes the same, unfiltered rows.
 */
import zlib from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

/** { width, height, channels, pixels }: rows of `channels` bytes per pixel, top to bottom. */
export function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('PNG değil')
  let at = 8, head = null
  const data = []
  while (at + 8 <= buf.length) {
    const len = buf.readUInt32BE(at), type = buf.toString('latin1', at + 4, at + 8), body = buf.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') head = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] }
    else if (type === 'IDAT') data.push(body)
    else if (type === 'IEND') break
    at += 12 + len
  }
  if (!head) throw new Error('PNG başlığı yok')
  if (head.depth !== 8 || (head.color !== 2 && head.color !== 6) || head.interlace !== 0) throw new Error(`desteklenmeyen PNG (derinlik ${head.depth}, renk türü ${head.color}, geçişli ${head.interlace})`)
  const channels = head.color === 6 ? 4 : 3, stride = head.width * channels
  const raw = zlib.inflateSync(Buffer.concat(data))
  if (raw.length < (stride + 1) * head.height) throw new Error('PNG verisi eksik')
  const pixels = Buffer.alloc(stride * head.height)
  for (let y = 0; y < head.height; y++) {
    const filter = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[dst + x - channels] : 0            // left
      const b = y > 0 ? pixels[dst + x - stride] : 0                       // above
      const c = y > 0 && x >= channels ? pixels[dst + x - stride - channels] : 0   // above left
      let add = 0
      if (filter === 1) add = a
      else if (filter === 2) add = b
      else if (filter === 3) add = (a + b) >> 1
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      else if (filter !== 0) throw new Error(`bilinmeyen PNG süzgeci (${filter})`)
      pixels[dst + x] = (raw[src + x] + add) & 0xff
    }
  }
  return { width: head.width, height: head.height, channels, pixels }
}

export function encodePng({ width, height, channels, pixels }) {
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)   // filter byte stays 0
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length)
    out.writeUInt32BE(body.length, 0); out.write(type, 4, 'latin1'); body.copy(out, 8)
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length)
    return out
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = channels === 4 ? 6 : 2
  return Buffer.concat([SIGNATURE, chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/**
 * The rectangle `clip` (in CSS pixels of a view `viewWidth` wide) cut out of a capture of that view.
 * The capture may be denser than the view (a scaled screen): the rectangle is scaled with it.
 * What falls outside the picture is left out; an empty cut is an error, not an empty picture.
 */
export function cropPng(buf, clip, viewWidth) {
  const img = decodePng(buf)
  const k = viewWidth > 0 ? img.width / viewWidth : 1
  const x0 = Math.max(0, Math.round(clip.x * k)), y0 = Math.max(0, Math.round(clip.y * k))
  const x1 = Math.min(img.width, Math.round((clip.x + clip.width) * k)), y1 = Math.min(img.height, Math.round((clip.y + clip.height) * k))
  if (x1 <= x0 || y1 <= y0) throw new Error('kırpılacak bölge görüntünün dışında')
  const width = x1 - x0, height = y1 - y0, stride = width * img.channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) img.pixels.copy(pixels, y * stride, (y0 + y) * img.width * img.channels + x0 * img.channels, (y0 + y) * img.width * img.channels + x1 * img.channels)
  return encodePng({ width, height, channels: img.channels, pixels })
}
