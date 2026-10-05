// @vitest-environment happy-dom
/**
 * Local check of a real Microsoft Whiteboard export against the importer, run by
 * hand: MSWB_ZIP=<path to .zip> npx vitest run scripts/ms-whiteboard-probe.test.ts
 * Prints only counts and positions — never the board's text.
 */
import { it } from 'vitest'
import fs from 'node:fs'
import JSZip from 'jszip'
import { parseMicrosoftWhiteboard } from '../src/components/canvas/whiteboard/msImport'
import { unionBounds } from '../src/components/canvas/whiteboard/geometry'

it.skipIf(!process.env.MSWB_ZIP)('parses a real export', async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(process.env.MSWB_ZIP!))
  const names = Object.keys(zip.files)
  console.log('files in zip:', names.length, names.map((n) => n.replace(/^.*\./, '*.')).join(' '))
  const html = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.html'))!
  const stem = html.name.replace(/\.html$/i, '')
  const comments = zip.files[`${stem}-comments.json`]
  const t0 = Date.now()
  const b = parseMicrosoftWhiteboard(await html.async('string'), comments ? await comments.async('string') : null, { comment: 'Yorum', link: 'Bağlantı' })
  const count: Record<string, number> = {}
  for (const e of b.elements) count[e.type] = (count[e.type] ?? 0) + 1
  console.log('parsed in', Date.now() - t0, 'ms')
  console.log('elements', b.elements.length, JSON.stringify(count))
  console.log('images', b.images.size, [...b.images.values()].map((x) => `${x.type}:${Math.round(x.size / 1024)}K`).join(' '))
  console.log('skipped', JSON.stringify(b.skipped))
  const box = unionBounds(b.elements)
  console.log('bounds', box && [Math.round(box.x), Math.round(box.y), Math.round(box.w), Math.round(box.h)].join(' '))
  const ink = b.elements.filter((e) => e.type === 'ink')
  console.log('ink with outline', ink.filter((e) => e.type === 'ink' && e.outline).length, 'pens', JSON.stringify(ink.reduce((a: Record<string, number>, e) => { if (e.type === 'ink') a[e.pen] = (a[e.pen] ?? 0) + 1; return a }, {})))
}, 60000)
