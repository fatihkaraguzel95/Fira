// Frames of a video attached to a ticket — a screen recording in a comment is
// part of the request (CLAUDE.md, "AI devri"), and the agent cannot watch it.
// The video is loaded in a tab of the QA window (same origin as the storage,
// so the session there may read it), frames are drawn to a canvas and saved.
// No screenshot is taken, so it also works while the window is minimised.
//
// usage: node tools/agent/qa/video-frames.mjs <video url> [out dir] [frame count]
//        (the url is what `fira-agent.mjs brief|claim` prints under MEDYA)
import fs from 'node:fs'
import path from 'node:path'
import { attach, APP } from './browser.mjs'
const [, , url, out = 'fira-media', count = '8'] = process.argv
if (!url) { console.log('usage: node tools/agent/qa/video-frames.mjs <video url> [out dir] [frame count]'); process.exit(1) }
const n = Math.max(1, Math.min(60, Number(count) || 8))
const { page, done, die } = await attach({ timeoutMs: 170_000 })
// Any page of the app's origin will do; the icon is the lightest one.
await page.goto(APP + '/favicon.ico', { waitUntil: 'commit' }).catch(() => {})
await page.waitForTimeout(600)
const res = await page.evaluate(async ([src, n]) => {
  try {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.src = new URL(src, location.origin).pathname.startsWith('/api/') ? new URL(src, location.origin).pathname : src
    document.body.appendChild(v)
    await new Promise((ok, no) => { v.onloadedmetadata = ok; v.onerror = () => no(new Error('video yüklenemedi')) })
    const c = document.createElement('canvas')
    c.width = Math.min(1600, v.videoWidth)
    c.height = Math.round(c.width * v.videoHeight / v.videoWidth)
    const g = c.getContext('2d')
    const frames = []
    for (let i = 0; i < n; i++) {
      // The middle of each of n equal parts: the first and last frame are often blank.
      const t = (v.duration * (i + 0.5)) / n
      await new Promise((ok) => { v.onseeked = ok; v.currentTime = t })
      g.drawImage(v, 0, 0, c.width, c.height)
      frames.push({ t: Math.round(t * 10) / 10, data: c.toDataURL('image/png').split(',')[1] })
    }
    return { seconds: Math.round(v.duration * 10) / 10, size: [v.videoWidth, v.videoHeight], frames }
  } catch (e) { return { error: String(e?.message ?? e) } }
}, [url, n])
if (res.error) await die(res.error)
fs.mkdirSync(out, { recursive: true })
for (const [i, f] of res.frames.entries()) {
  const file = path.join(out, `kare-${String(i + 1).padStart(2, '0')}-${f.t}s.png`)
  fs.writeFileSync(file, Buffer.from(f.data, 'base64'))
  console.log(file)
}
await done(`video: ${res.seconds} sn, ${res.size.join('x')}, ${res.frames.length} kare`)
