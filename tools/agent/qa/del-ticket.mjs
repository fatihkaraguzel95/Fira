// Delete a ticket that a QA run created, through the ticket window (⋯ → Görevi sil… → Evet, sil).
// Refuses anything whose title does not look like QA data ("QA TL-<number> …"): nobody
// else's ticket is ever deleted by a script.
// usage: node tools/agent/qa/del-ticket.mjs <ticket id>
import { attach, open } from './browser.mjs'
const id = process.argv[2]
const { page: p, done, die } = await attach({ timeoutMs: 60_000 })
await open(p, `/ticket/${id}`, 1500)
for (let i = 0; i < 40 && !(await p.locator('[data-ticket-window]').count()); i++) await p.waitForTimeout(250)
await p.waitForTimeout(1500)
const title = await p.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => (d.getAttribute('aria-label') || '').startsWith('Görev'))?.getAttribute('aria-label'))
if (!title || !/QA TL-\d+/.test(title)) await die('not a QA ticket: ' + title)
if (!(await p.locator('[data-ticket-more]').count())) await die('ticket menu not found')
await p.click('[data-ticket-more]'); await p.waitForTimeout(500)
const hit = await p.evaluate(() => { const x = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] button, button')).find((e) => e.textContent.trim() === 'Görevi sil…'); if (!x) return false; x.click(); return true })
if (!hit) await die('"Görevi sil…" not found')
await p.waitForTimeout(600)
await p.locator('button').filter({ hasText: /^Evet, sil$/ }).first().click(); await p.waitForTimeout(2500)
await done('deleted ' + id)
