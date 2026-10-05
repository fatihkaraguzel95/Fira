/**
 * The QA browser: a separate Chromium window the scripts attach to over CDP.
 *
 * Checks are NOT done in the user's own Chrome (a notification banner appears,
 * the "last opened list" preference gets overwritten). The person signs in to
 * this window THEMSELVES, once — scripts never type a password and never
 * inject a session; they only drive pages of a window that is already signed in.
 *
 * The window stays visible (the person watches checks in it) but nothing here
 * brings it to the front: every script used to open a tab and raise the window
 * over whatever the person was doing, and what they pressed meanwhile (a zoom,
 * a key) landed in the check. Start it with `qa-browser.mjs start`, which also
 * keeps a covered window drawing.
 *
 *   FIRA_QA_CDP   where the window listens (default http://127.0.0.1:9222)
 *   FIRA_URL      the app (default https://fira.flpconsulting.de)
 *   FIRA_QA_SHOTS where screenshots go (default ./qa-shots)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { cropPng } from './png.mjs'

export const CDP = process.env.FIRA_QA_CDP || 'http://127.0.0.1:9222'
export const APP = (process.env.FIRA_URL || 'https://fira.flpconsulting.de').replace(/\/+$/, '')
export const SHOTS = process.env.FIRA_QA_SHOTS || path.resolve('qa-shots')

/** Attach to the QA tab (see `qaTab`) at the asked size. Never opens a tab in front, never raises the window. */
export async function attach({ width = 1360, height = 900, timeoutMs = 110_000 } = {}) {
  let browser
  try { browser = await chromium.connectOverCDP(CDP) } catch {
    console.log(`ABORT: QA tarayıcısına bağlanılamadı (${CDP}). Başlat: node tools/agent/qa/qa-browser.mjs start (bkz. tools/agent/README.md)`)
    process.exit(1)
  }
  const context = browser.contexts()[0]
  const page = await qaTab(browser, context)
  page.setDefaultTimeout(20_000)
  // A page that asks "leave without saving?" (an import in progress) must not hold the next check.
  page.on('dialog', (d) => { d.accept().catch(() => {}) })
  // The tab stays open and stays where the check left it: the person can look at it, the next check reuses it.
  const done = async (message, code = 0) => { if (message) console.log(message); process.exit(code) }
  setTimeout(() => done('TIMEOUT', 2), timeoutMs)
  await page.setViewportSize({ width, height })
  return { browser, context, page, done, die: (m) => done(`ABORT: ${m}`, 1) }
}

const TAB_FILE = path.join(os.homedir(), '.fira-agent', 'qa-tab.json')
const targetOf = async (context, page) => {
  const s = await context.newCDPSession(page)
  try { return (await s.send('Target.getTargetInfo')).targetInfo.targetId } finally { await s.detach().catch(() => {}) }
}

/**
 * The one tab every check runs in. Opening a tab per script made Chromium jump in
 * front of whatever the person was doing, so the tab is reused and never brought
 * forward: the one remembered from the last run; else the only tab there is; else
 * (the person has tabs of their own open here) a window of its own, opened in the
 * background. A tab the scripts did not open or adopt is never touched.
 */
async function qaTab(browser, context) {
  let known = null
  try { known = JSON.parse(fs.readFileSync(TAB_FILE, 'utf8')).targetId } catch { /* first run */ }
  const pages = context.pages()
  const ids = await Promise.all(pages.map((p) => targetOf(context, p).catch(() => null)))
  let page = pages[ids.indexOf(known)] ?? (pages.length === 1 ? pages[0] : null)
  if (!page) {
    const session = await browser.newBrowserCDPSession()
    const opened = context.waitForEvent('page', { timeout: 15_000 })
    await session.send('Target.createTarget', { url: 'about:blank', newWindow: true, background: true })
    page = await opened
  }
  const id = await targetOf(context, page)
  if (id !== known) {
    fs.mkdirSync(path.dirname(TAB_FILE), { recursive: true })
    fs.writeFileSync(TAB_FILE, JSON.stringify({ targetId: id }) + '\n')
  }
  return page
}

/**
 * Open a path of the app and wait for it to settle; closes the tour if it starts by itself.
 * Stops the script when the page is not at 100 %: zoom is kept per site in the profile, so a
 * zoom left behind in the visible window makes every measurement and picture of a later
 * check wrong without anything failing (a 1360 px window measured 544 px once).
 */
export async function open(page, route = '/', settleMs = 4000) {
  await page.goto(APP + route, { waitUntil: 'domcontentloaded' })
  const want = page.viewportSize()?.width
  const got = await page.evaluate(() => window.innerWidth)
  if (want && Math.abs(got - want) > 1) {
    console.log(`ABORT: sayfa %100 ölçekte değil (istenen genişlik ${want}, ölçülen ${got}; yakınlaştırma %${Math.round((want / got) * 100)}). QA penceresinde Ctrl+0 ile sıfırla.`)
    process.exit(1)
  }
  await page.waitForTimeout(settleMs)
  await page.evaluate(() => document.querySelector('[data-tour-close]')?.click())
}

/**
 * A screenshot that cannot hang the script and does not move the layout.
 *
 * A picture that lies inside the window is the whole window captured raw over
 * CDP, with the asked piece cut out of it here (`png.mjs`). Not Playwright's
 * clipped screenshot: it resizes the page for the picture, and when it gives up
 * half way the layout stays reflowed (the settings window came out in its phone
 * layout, a centred dialog shifted). Not a clipped raw capture either: a piece
 * near the bottom of the window came back empty while the whole window had the
 * text in it (0.95.1, the agent panel's footer). A covered window presents no
 * new frame while nothing changes and the capture waits for one, so a 1 px,
 * nearly transparent dot is nudged while the capture runs. Only a clip that
 * leaves the window goes to Playwright, and then to a raw capture beyond the
 * viewport — open such a picture and look at it.
 */
export async function shot(page, name, clip) {
  fs.mkdirSync(SHOTS, { recursive: true })
  const file = path.join(SHOTS, name.endsWith('.png') ? name : `${name}.png`)
  const saved = (data) => { fs.writeFileSync(file, Buffer.isBuffer(data) ? data : Buffer.from(data, 'base64')); console.log('shot', file); return file }
  const view = page.viewportSize()
  const inside = !clip || !view || (clip.x >= 0 && clip.y >= 0 && clip.x + clip.width <= view.width + 1 && clip.y + clip.height <= view.height + 1)
  if (inside) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await rawCapture(page, {})
      if (!res) continue
      if (!clip) return saved(res.data)
      // The cut is measured against the page's own width: the capture is denser on a scaled screen.
      const width = view?.width ?? await page.evaluate(() => window.innerWidth)
      return saved(cropPng(Buffer.from(res.data, 'base64'), clip, width))
    }
    console.log('shot timed out', name)
    return null
  }
  try {
    await page.screenshot({ path: file, clip, timeout: 10_000 })
    console.log('shot', file)
    return file
  } catch { console.log(`shot ${name}: Playwright yetişmedi, ham yakalamaya geçildi (görüntüyü aç ve bak)`) }
  const res = await rawCapture(page, { clip: { ...clip, scale: 1 }, captureBeyondViewport: true })
  if (!res) { console.log('shot timed out', name); return null }
  return saved(res.data)
}

async function rawCapture(page, params, ms = 7000) {
  const cdp = await page.context().newCDPSession(page)
  try {
    await page.evaluate(() => {
      document.getElementById('qa-tick')?.remove()
      const dot = document.createElement('div')
      dot.id = 'qa-tick'
      dot.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:2147483647;background:#888'
      document.body.appendChild(dot)
      let n = 0
      const t = setInterval(() => { dot.style.transform = `translateX(${n++ % 2}px)`; if (n > 250) { clearInterval(t); dot.remove() } }, 40)
    })
    return await Promise.race([cdp.send('Page.captureScreenshot', { format: 'png', ...params }), new Promise((ok) => setTimeout(() => ok(null), ms))])
  } finally {
    await page.evaluate(() => document.getElementById('qa-tick')?.remove()).catch(() => {})
    await cdp.detach().catch(() => {})
  }
}

/** The padded bounding box of the first element matching each selector, as one clip. */
export const union = (page, selectors, pad = 12) => page.evaluate(([sels, pad]) => {
  const rs = sels.map((s) => document.querySelector(s)?.getBoundingClientRect()).filter(Boolean)
  if (!rs.length) return null
  const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - pad), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - pad)
  return { x, y, width: Math.max(...rs.map((r) => r.right)) - x + pad, height: Math.max(...rs.map((r) => r.bottom)) - y + pad }
}, [selectors, pad])

/**
 * Typing is only safe when the focus is proven to be where it is expected:
 * bare letters are global shortcuts in Fira ("n" once created 83 empty tasks).
 */
export const focusIn = (page, selector) => page.evaluate((s) => !!document.activeElement?.closest?.(s), selector)

/**
 * Wait until focus is inside `selector` (true) or the time is up (false). Use this before typing
 * instead of a fixed pause: focus lands 60–700 ms after the key that opens a field, and a letter
 * typed before it lands is a global shortcut.
 */
export async function waitFocus(page, selector, ms = 3000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await focusIn(page, selector)) return true
    await page.waitForTimeout(50)
  }
  return false
}
