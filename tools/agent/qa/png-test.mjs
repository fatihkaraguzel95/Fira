// Run with: node --test tools/agent/qa/png-test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { cropPng, decodePng, encodePng } from './png.mjs'

/** A picture whose every pixel says where it is: red = x, green = y. */
function picture(width, height, channels) {
  const pixels = Buffer.alloc(width * height * channels)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels
    pixels[i] = x; pixels[i + 1] = y; pixels[i + 2] = (x * 7 + y * 13) & 0xff
    if (channels === 4) pixels[i + 3] = 255
  }
  return { width, height, channels, pixels }
}

/** The same picture written the way an encoder that filters would: every row with a filter of its own. */
function filtered({ width, height, channels, pixels }) {
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const filter = y % 5
    raw[y * (stride + 1)] = filter
    for (let x = 0; x < stride; x++) {
      const v = pixels[y * stride + x]
      const a = x >= channels ? pixels[y * stride + x - channels] : 0
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const c = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0
      let pred = 0
      if (filter === 1) pred = a
      else if (filter === 2) pred = b
      else if (filter === 3) pred = (a + b) >> 1
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      raw[y * (stride + 1) + 1 + x] = (v - pred) & 0xff
    }
  }
  // the chunks of a plain picture, with the data swapped for the filtered rows (cut in two, as real files are)
  const plain = encodePng({ width, height, channels, pixels })
  const head = plain.subarray(0, 8 + 25)
  const packed = zlib.deflateSync(raw), half = packed.length >> 1
  const chunk = (type, body) => { const out = Buffer.alloc(12 + body.length); out.writeUInt32BE(body.length, 0); out.write(type, 4, 'latin1'); body.copy(out, 8); return out }   // the reader does not check sums
  return Buffer.concat([head, chunk('IDAT', packed.subarray(0, half)), chunk('IDAT', packed.subarray(half)), chunk('IEND', Buffer.alloc(0))])
}

test('a picture written and read back is the same picture', () => {
  for (const channels of [3, 4]) {
    const p = picture(40, 30, channels)
    const back = decodePng(encodePng(p))
    assert.deepEqual({ w: back.width, h: back.height, c: back.channels }, { w: 40, h: 30, c: channels })
    assert.ok(back.pixels.equals(p.pixels))
  }
})

test('every row filter is undone, and data in several chunks is joined', () => {
  for (const channels of [3, 4]) {
    const p = picture(37, 23, channels)
    assert.ok(decodePng(filtered(p)).pixels.equals(p.pixels))
  }
})

test('the cut is the asked rectangle: its first pixel is the rectangle\'s corner', () => {
  const cut = decodePng(cropPng(filtered(picture(60, 50, 4)), { x: 12, y: 40, width: 20, height: 8 }, 60))
  assert.deepEqual([cut.width, cut.height], [20, 8])
  assert.deepEqual([cut.pixels[0], cut.pixels[1]], [12, 40], 'top left')
  const last = (8 * 20 - 1) * 4
  assert.deepEqual([cut.pixels[last], cut.pixels[last + 1]], [31, 47], 'bottom right')
})

test('a capture denser than the view is cut at the same place', () => {
  const cut = decodePng(cropPng(encodePng(picture(120, 100, 3)), { x: 12, y: 40, width: 20, height: 8 }, 60))   // two picture pixels per view pixel
  assert.deepEqual([cut.width, cut.height], [40, 16])
  assert.deepEqual([cut.pixels[0], cut.pixels[1]], [24, 80])
})

test('what is outside the picture is left out, and nothing at all is an error', () => {
  const p = encodePng(picture(60, 50, 3))
  const cut = decodePng(cropPng(p, { x: 50, y: 45, width: 30, height: 30 }, 60))
  assert.deepEqual([cut.width, cut.height], [10, 5])
  assert.throws(() => cropPng(p, { x: 70, y: 10, width: 10, height: 10 }, 60), /dışında/)
  assert.throws(() => decodePng(Buffer.from('not a picture')), /PNG değil/)
})
