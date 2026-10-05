/**
 * Helpers for the pictures that go into the user guide.
 *
 * The rule (CLAUDE.md): guide screenshots show the demo team "Fira Tanıtım"
 * only — no other team's or customer's name, no secret. These helpers change
 * what is DRAWN in the QA window for the moment of the picture; nothing is
 * saved, and a reload brings everything back.
 *
 *   import { attach, open, shot, union } from './browser.mjs'
 *   import { onlyDemoTeam, hide, mask, unclip, docShot } from './docshots.mjs'
 *
 *   await open(page, '/')
 *   await docShot(page, 'kenar-cubugu', await union(page, ['aside']))
 */
import { shot } from './browser.mjs'

export const DEMO = process.env.FIRA_DEMO_TEAM || 'Fira Tanıtım'

/** Hide every team in the sidebar tree except the demo team. Answers how many were hidden, or null when the demo team is not on screen. */
export const onlyDemoTeam = (page, demo = DEMO) => page.evaluate((demo) => {
  const headers = Array.from(document.querySelectorAll('[data-team-dnd]')).filter((h) => h.getClientRects().length)
  // The header's text starts with the logo's letter; the name is the start of the button's title.
  const isDemo = (h) => (h.querySelector('button[title]')?.getAttribute('title') ?? '').startsWith(demo + ' ·')
  if (!headers.some(isDemo)) return null
  let hidden = 0
  for (const h of headers) {
    if (isDemo(h)) continue
    const block = h.parentElement   // the team's block: header + tree
    if (block) { block.style.display = 'none'; hidden++ }
  }
  return hidden
}, demo)

/** Team headers that are on screen right now (the phone drawer keeps a hidden copy of the tree). */
const teamsOnScreen = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-team-dnd]')).filter((h) => h.getClientRects().length).length)

/** Take elements out of the picture (a banner, a list that names real tasks). Answers how many were hidden. */
export const hide = (page, selectors) => page.evaluate((sels) => {
  let n = 0
  for (const s of sels) for (const el of document.querySelectorAll(s)) { el.style.display = 'none'; n++ }
  return n
}, [selectors].flat())

/** Replace the text of elements that show something secret or personal (a key, an address). */
export const mask = (page, selector, text = '••••••••') => page.evaluate(([s, t]) => {
  let n = 0
  for (const el of document.querySelectorAll(s)) { el.textContent = t; n++ }
  return n
}, [selector, text])

/**
 * Let a panel that scrolls inside itself grow to its full height, so one clip
 * can hold more than a screenful. The window must be tall enough for the clip.
 */
export const unclip = (page, selector) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return false
  el.style.height = 'auto'; el.style.overflow = 'visible'
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { n.style.overflow = 'visible'; n.style.height = 'auto'; n.style.maxHeight = 'none' }
  el.scrollIntoView({ block: 'start' })
  return true
}, selector)

/**
 * A guide picture: other teams out of the sidebar, the pointer out of the way,
 * then the shot. Refuses when the demo team is not on screen and a sidebar is —
 * better no picture than one with somebody else's team in it.
 */
export async function docShot(page, name, clip) {
  const hidden = await onlyDemoTeam(page)
  if (hidden === null && (await teamsOnScreen(page)) > 0) { console.log(`docShot ${name}: demo takım (${DEMO}) ekranda yok, görüntü alınmadı`); return null }
  await page.mouse.move(2, 2)
  await page.waitForTimeout(300)
  return shot(page, name, clip)
}
