// A look at a Fira page as people see it, scrolled to a heading — to check a published document.
// usage: node tools/agent/qa/shot-page.mjs <page id> <name> ["heading text"]
import { attach, open, shot } from './browser.mjs'
const [, , id, name = 'page', heading] = process.argv
const { page: p, done, die } = await attach({ height: 1000 })
await open(p, `/page/${id}`, 5000)
for (let i = 0; i < 40 && !(await p.locator('article .ProseMirror').count()); i++) await p.waitForTimeout(250)
if (!(await p.locator('article .ProseMirror').count())) await die('page did not open')
if (heading) {
  const found = await p.evaluate((text) => {
    const h = Array.from(document.querySelectorAll('article h1, article h2, article h3, article h4')).find((x) => x.textContent.trim().startsWith(text))
    if (!h) return false
    h.scrollIntoView({ block: 'start' })
    return true
  }, heading)
  if (!found) await die('heading not found: ' + heading)
}
await p.waitForTimeout(1500)
const broken = await p.evaluate(() => Array.from(document.querySelectorAll('article img')).filter((i) => i.complete && i.naturalWidth === 0).length)
console.log('images that failed to load:', broken)
await shot(p, name)
await done()
