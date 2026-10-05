// Bring the QA browser onto the build that was just deployed: activate the waiting
// service worker and reload. (Since 0.81.0 a new version no longer opens the
// "Yenilikler" dialog; the check below only covers a tab still on an older build.)
// usage: node tools/agent/qa/qa-prep.mjs <index hash, e.g. index-Bq4xcUOm>
import { attach, APP } from './browser.mjs'
const WANT = process.argv[2] ?? ''
const { page: p, done } = await attach({ timeoutMs: 90_000 })
const build = () => p.evaluate(() => [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).find((s) => /index-/.test(s)) ?? '')
for (let round = 0; round < 3; round++) {
  await p.goto(APP + '/', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(3500)
  if ((await build()).includes(WANT)) break
  await p.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration()
    if (!r) return
    await r.update().catch(() => {})
    for (let i = 0; i < 20 && !r.waiting; i++) await new Promise((ok) => setTimeout(ok, 250))
    r.waiting?.postMessage({ type: 'SKIP_WAITING' })
  })
  await p.waitForTimeout(1500)
}
const cur = await build()
const news = p.locator('[role=dialog][aria-label="Yenilikler"]')
await p.waitForTimeout(1000)
if (await news.count()) {
  const btn = news.locator('button[aria-label="Kapat"], button:has-text("Kapat"), button:has-text("Tamam")').first()
  if (await btn.count()) await btn.click(); else await p.keyboard.press('Escape')
  await p.waitForTimeout(500)
}
await done(`build ${cur} ${cur.includes(WANT) ? 'OK' : 'OLD'} · Yenilikler open: ${await news.count()}`, cur.includes(WANT) ? 0 : 1)
