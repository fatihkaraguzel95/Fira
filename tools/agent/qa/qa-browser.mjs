/**
 * The QA browser's switch: start it, stop it, see how it is doing.
 *
 *   node tools/agent/qa/qa-browser.mjs start      a window you can watch, that never comes to the front
 *   node tools/agent/qa/qa-browser.mjs restart    close and start again (after a flag change here)
 *   node tools/agent/qa/qa-browser.mjs stop       close it (asks the browser itself; never kills by name)
 *   node tools/agent/qa/qa-browser.mjs status     is it up, signed in, and drawing while covered
 *   … start --headless                            no window at all (nothing to watch)
 *   … [--profile <dir>] [--chrome <chrome.exe>]   remembered in ~/.fira-agent/qa-browser.json
 *
 * The window is for watching, not for taking over the screen:
 *  - it is started behind the other windows and without the keyboard (Windows: qa-window.ps1);
 *  - the scripts reuse one tab and never raise it (browser.mjs);
 *  - a covered window keeps drawing: Chromium otherwise stops painting a window that is behind
 *    another one (1 frame a second), which starves animations and screenshots.
 * The person signs in to this window themselves, once; the session lives in the profile folder.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { CDP, APP } from './browser.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONFIG = path.join(os.homedir(), '.fira-agent', 'qa-browser.json')
const [, , COMMAND = 'status', ...rest] = process.argv
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined }

/** Keep painting and keep timers running while the window is behind another one. */
const KEEP_DRAWING = [
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
]

function settings() {
  let saved = {}
  try { saved = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } catch { /* first run */ }
  const next = {
    profile: flag('profile') ?? saved.profile ?? path.join(os.homedir(), '.fira-agent', 'qa-profile'),
    chrome: flag('chrome') ?? saved.chrome ?? chromium.executablePath(),
  }
  if (next.profile !== saved.profile || next.chrome !== saved.chrome) {
    fs.mkdirSync(path.dirname(CONFIG), { recursive: true })
    fs.writeFileSync(CONFIG, JSON.stringify(next, null, 2) + '\n')
  }
  return next
}

/** What is listening on the port: null, or how it runs. */
async function running() {
  try {
    const r = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(2000) })
    const v = await r.json()
    return { headless: /Headless/i.test(v.Browser ?? ''), browser: v.Browser }
  } catch { return null }
}
const label = (r) => (r.headless ? 'penceresiz' : 'pencereli')
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms))
const quoted = (a) => (/\s/.test(a) ? a.replace(/^(--[\w-]+=)?(.*)$/, (_, k = '', v) => `${k}"${v}"`) : a)

async function stop() {
  if (!(await running())) return false
  const browser = await chromium.connectOverCDP(CDP)
  const session = await browser.newBrowserCDPSession()
  await session.send('Browser.close').catch(() => {})
  for (let i = 0; i < 40 && (await running()); i++) await wait(250)
  return !(await running())
}

async function start(headless, { again = false } = {}) {
  const now = await running()
  if (now && now.headless === headless && !again) { console.log(`QA tarayıcısı zaten çalışıyor (${label(now)}).`); return health() }
  if (now && !(await stop())) return fail('Çalışan QA tarayıcısı kapanmadı; elle kapatıp yeniden dene.')
  if (now) await wait(1200) // the profile lock is released a moment after the port goes quiet
  const { profile, chrome } = settings()
  if (!fs.existsSync(chrome)) return fail(`Chromium bulunamadı: ${chrome} (--chrome ile göster ya da "npx playwright install chromium")`)
  const args = [
    `--remote-debugging-port=${new URL(CDP).port || 9222}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', ...KEEP_DRAWING,
    // No address: the profile reopens what it had (an address here adds a window on every start).
    ...(headless ? ['--headless=new', '--window-size=1360,900'] : []),
  ]
  if (process.platform === 'win32' && !headless) {
    // A plain spawn leaves the new window in front, holding the keyboard; the script hands it back.
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'qa-window.ps1'), '-Chrome', chrome, '-ArgLine', args.map(quoted).join(' ')], { encoding: 'utf8' })
    if (r.status !== 0) return fail(`QA penceresi açılamadı: ${(r.stderr || r.stdout || '').trim().split('\n')[0]}`)
  } else {
    spawn(chrome, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  }
  let up = null
  for (let i = 0; i < 60 && !up; i++) { await wait(250); up = await running() }
  if (!up) return fail('QA tarayıcısı açılmadı (profil başka bir Chromium tarafından kullanılıyor olabilir).')
  console.log(`QA tarayıcısı açıldı (${label(up)}). Profil: ${profile}`)
  await health()
}

/** Signed in? Drawing while it is not in front? Looks at the app, not at any credential. */
async function health() {
  const browser = await chromium.connectOverCDP(CDP)
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.newPage())
  try {
    if (!page.url().startsWith(APP)) await page.goto(APP + '/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    let state = 'belirsiz'
    for (let i = 0; i < 40 && state === 'belirsiz'; i++) {
      await wait(500)
      state = await page.evaluate(() => (document.querySelector('[data-topbar]') ? 'açık' : document.querySelector('input[type="password"]') ? 'yok' : 'belirsiz'))
    }
    console.log(`OTURUM: ${state}${state === 'yok' ? ' (QA penceresinde kendin giriş yap; betikler şifre yazmaz)' : ''}`)
    await roomy(browser, context, page)
    const frames = await page.evaluate(() => new Promise((ok) => {
      let n = 0
      const tick = () => { n++; requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
      setTimeout(() => ok(n), 1000)
    }))
    console.log(`ÇİZİM: saniyede ${frames} kare${frames < 20 ? ' — pencere örtülüyken çizmiyor; "qa-browser.mjs restart" ile yeniden başlat' : ''}`)
  } catch (e) {
    console.log(`DURUM: bakılamadı (${String(e?.message ?? e).split('\n')[0]})`)
  }
}

/**
 * A window that came back tiny draws one frame a second and no whole-window picture can be taken
 * in it (the profile remembers its last size: it reopened at 516×151 once, and the frame count
 * read as "does not draw while covered"). Give it a usable size; resizing does not raise it.
 */
async function roomy(browser, context, page) {
  try {
    const own = await context.newCDPSession(page)
    const { targetInfo } = await own.send('Target.getTargetInfo')
    const session = await browser.newBrowserCDPSession()
    const { windowId, bounds } = await session.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId })
    if (bounds.windowState !== 'normal' || (bounds.width >= 1000 && bounds.height >= 700)) return
    await session.send('Browser.setWindowBounds', { windowId, bounds: { width: 1400, height: 1000 } })
    console.log(`PENCERE: ${bounds.width}×${bounds.height} idi, 1400×1000 yapıldı`)
    await wait(600)
  } catch { /* no window to size (headless) */ }
}

function fail(message) { console.log(`ABORT: ${message}`); process.exitCode = 1 }

const headless = rest.includes('--headless')
if (COMMAND === 'start') await start(headless)
else if (COMMAND === 'restart') await start(headless, { again: true })
else if (COMMAND === 'stop') console.log((await stop()) ? 'QA tarayıcısı kapandı.' : (await running()) ? 'Kapanmadı.' : 'Zaten kapalı.')
else if (COMMAND === 'status') {
  const now = await running()
  if (!now) console.log('QA tarayıcısı kapalı. Başlat: node tools/agent/qa/qa-browser.mjs start')
  else { console.log(`QA tarayıcısı çalışıyor (${label(now)}; ${now.browser}).`); await health() }
} else fail('kullanım: qa-browser.mjs start [--headless] | restart | stop | status [--profile <klasör>] [--chrome <chrome.exe>]')
process.exit(process.exitCode ?? 0)
