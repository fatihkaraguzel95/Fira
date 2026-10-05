// A look at a ticket as people see it: the whole window, or one element of it.
// usage: node tools/agent/qa/shot-ticket.mjs <ticket id> <name> [css selector to clip to]
import { attach, open, shot, union } from './browser.mjs'
const [, , id, name = 'ticket', selector] = process.argv
const { page: p, done, die } = await attach({ height: 1000 })
await open(p, `/ticket/${id}`, 1500)
for (let i = 0; i < 40 && !(await p.locator('[data-ticket-window]').count()); i++) await p.waitForTimeout(250)
if (!(await p.locator('[data-ticket-window]').count())) await die('ticket window did not open')
await p.waitForTimeout(2500)
await p.evaluate(() => document.querySelector('[data-tour-close]')?.click())
let clip = null
if (selector) {
  await p.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'start' }), selector)
  await p.waitForTimeout(500)
  clip = await union(p, [selector])
  if (!clip) await die('nothing matches ' + selector)
}
await shot(p, name, clip)
await done()
