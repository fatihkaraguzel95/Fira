// Runner of the guide's screenshot recipes (#3492d872). Demo team "Fira Tanıtım" only.
// usage (from tools/agent/qa): FIRA_QA_SHOTS=<dir> node guide/run.mjs guide/batch-<x>.mjs <name,name,…>   (no names: lists the recipes)
// A batch file exports default (ctx) => ({ name: async () => {…} }). Every picture is the whole window
// captured raw; `<name>.json` holds the crop (`python guide/crop.py <dir>` cuts it, `guide/sheet.py` makes a contact sheet).
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { attach, open, SHOTS, waitFocus } from '../browser.mjs'
import { hide, onlyDemoTeam } from '../docshots.mjs'
import { rest } from '../../fira-agent.mjs'

const LIST = 'd9cf3dc5-1f20-41f5-a2bd-aedb0fdcf014', LIST_NAME = 'Web sitesi yenileme'
const batch = process.argv[2]
const names = (process.argv[3] ?? '').split(',').filter(Boolean)
const { page: p, done } = await attach({ width: 1360, height: 860, timeoutMs: 290_000 })
const cdp = await p.context().newCDPSession(p)
const sleep = (ms) => p.waitForTimeout(ms)
const until = async (fn, arg, tries = 40) => { for (let i = 0; i < tries; i++) { if (await p.evaluate(fn, arg)) return true; await sleep(250) } return false }
const clean = () => hide(p, ['[data-disk-banner]', '[data-task-tray]'])
const esc = async (n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press('Escape'); await sleep(350) } }
const rectOf = (sel, pad = 0) => p.evaluate(([s, pad]) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: Math.max(0, Math.round(r.x - pad)), y: Math.max(0, Math.round(r.y - pad)), width: Math.round(r.width + 2 * pad), height: Math.round(r.height + 2 * pad) } : null }, [sel, pad])
/** One clip around every visible element the selectors match, padded, kept inside the window. */
const around = (sels, pad = 12) => p.evaluate(([sels, pad]) => {
  const rs = sels.flatMap((s) => [...document.querySelectorAll(s)]).filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect())
  if (!rs.length) return null
  const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - pad), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - pad)
  const right = Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + pad), bottom = Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + pad)
  return { x: Math.round(x), y: Math.round(y), width: Math.round(right - x), height: Math.round(bottom - y) }
}, [sels, pad])
const clickText = (scope, text) => p.evaluate(([scope, text]) => { const b = [...document.querySelectorAll(scope)].find((x) => x.getClientRects().length && x.innerText.replace(/\s+/g, ' ').trim() === text); if (b) b.click(); return !!b }, [scope, text])
const clickLabel = (label) => p.evaluate((label) => { const b = [...document.querySelectorAll(`button[aria-label="${label}"]`)].find((x) => x.getClientRects().length); if (b) b.click(); return !!b }, label)
const centre = (sel) => p.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length); const r = e?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null }, sel)
const noField = () => p.evaluate(() => { const a = document.activeElement; if (a && a !== document.body) a.blur() })
const viewport = async (width, height) => { await p.setViewportSize({ width, height }); await sleep(500) }

/**
 * The guide shows neutral sample people only. The demo team has one real member; for the moment of
 * the picture the name is drawn as a made-up one and the photo as initials (nothing is saved).
 * That member's agent carries the person's first names in its own name, so it is renamed too
 * (pictures taken before 0.97.1 show the agent's name as it is).
 */
const neutralPeople = () => p.evaluate(() => {
  const NAMES = [['Ali İlker Topçu', 'Deniz Yılmaz'], ['Ali İlker Claude', 'Deniz Claude'], ['Ali İlker', 'Deniz']]
  const swap = (s) => NAMES.reduce((out, [real, demo]) => out.split(real).join(demo), s)
  let n = 0
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let t = walk.nextNode(); t; t = walk.nextNode()) { const v = swap(t.nodeValue); if (v !== t.nodeValue) { t.nodeValue = v; n++ } }
  for (const el of document.querySelectorAll('[title], [aria-label], [alt]')) for (const a of ['title', 'aria-label', 'alt']) { const v = el.getAttribute(a); if (v && swap(v) !== v) el.setAttribute(a, swap(v)) }
  for (const img of document.querySelectorAll('img')) {
    if (img.dataset.qaNeutral || !/rounded-full/.test(img.className) || !img.getClientRects().length) continue
    const r = img.getBoundingClientRect()
    if (r.width > 96) continue   // an avatar, not a picture of the content
    const dot = document.createElement('span')
    dot.textContent = 'DY'
    dot.className = img.className
    dot.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:${r.width}px;height:${r.height}px;border-radius:9999px;background:#0f766e;color:#fff;font-weight:600;font-size:${Math.max(9, Math.round(r.width * 0.4))}px;flex-shrink:0`
    img.dataset.qaNeutral = '1'
    img.style.display = 'none'
    img.parentElement.insertBefore(dot, img)
    n++
  }
  return n
})

/** The whole window, raw. Refuses when another team could be in the picture or the screen is not the expected one. */
async function cap(name, clip, { expect, pointer = false } = {}) {
  if (expect && !(await p.evaluate(expect))) { console.log(`SKIP ${name}: beklenen ekran değil`); return false }
  const hidden = await onlyDemoTeam(p)
  const teams = await p.evaluate(() => Array.from(document.querySelectorAll('[data-team-dnd]')).filter((h) => h.getClientRects().length).length)
  if (hidden === null && teams > 0) { console.log(`SKIP ${name}: demo takım ekranda yok`); return false }
  await clean()
  const masked = await neutralPeople()
  if (!pointer) { await p.mouse.move(2, 2); await sleep(350) }
  for (let attempt = 0; attempt < 3; attempt++) {
    // A covered window presents no new frame while nothing changes, and the capture waits for one.
    await p.evaluate(() => {
      document.getElementById('qa-tick')?.remove()
      const dot = document.createElement('div')
      dot.id = 'qa-tick'
      dot.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:2147483647;background:#888'
      document.body.appendChild(dot)
      let n = 0
      const t = setInterval(() => { dot.style.transform = `translateX(${n++ % 2}px)`; if (n > 220) { clearInterval(t); dot.remove() } }, 40)
    })
    const res = await Promise.race([cdp.send('Page.captureScreenshot', { format: 'png' }), new Promise((ok) => setTimeout(() => ok(null), 8_000))])
    await p.evaluate(() => document.getElementById('qa-tick')?.remove())
    if (!res) continue
    fs.mkdirSync(SHOTS, { recursive: true })
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(res.data, 'base64'))
    if (clip) fs.writeFileSync(path.join(SHOTS, `${name}.json`), JSON.stringify(clip))
    else fs.rmSync(path.join(SHOTS, `${name}.json`), { force: true })
    console.log('shot', name, clip ? JSON.stringify(clip) : 'whole window', masked ? `· ${masked} masked` : '')
    return true
  }
  console.log(`SKIP ${name}: yakalama zaman aşımı`)
  return false
}

const teamsOpen = async () => {
  const pressed = await p.evaluate(() => document.querySelector('aside [data-shortcut="teams"]')?.getAttribute('aria-pressed'))
  if (pressed !== 'true') { await p.evaluate(() => document.querySelector('aside [data-shortcut="teams"]')?.click()); await sleep(2500) }
}
const board = async () => {
  await open(p, `/list/${LIST}`, 4500)
  await until(() => document.querySelectorAll('[data-ticket-id]').length > 0)
  await teamsOpen()
  await clean()
  await onlyDemoTeam(p)
}
const listView = async () => {
  await board()
  await p.evaluate(() => document.querySelector('[data-builtin-tab="list"]')?.click())
  await until(() => !!document.querySelector('[data-list-view]'))
  await sleep(1500)
}
const backToBoard = async () => { await p.evaluate(() => document.querySelector('[data-builtin-tab="board"]')?.click()); await sleep(800) }
const menuOf = async (label) => {
  if (!(await clickLabel(label))) { console.log('no button:', label); return false }
  return until(() => !!document.querySelector('[role="menu"]'), null, 12)
}
/** A demo task by its title: its id (the demo list's own tasks and their subtasks only). */
const ticketId = async (title) => (await rest(`/tickets?project_id=eq.${LIST}&title=eq.${encodeURIComponent(title)}&select=id`))[0]?.id ?? null
/** The task window, opened by its address (no card click: nothing is left hovered or focused). */
const ticket = async (title) => {
  const id = await ticketId(title)
  if (!id) { console.log('no demo task:', title); return null }
  await open(p, `/ticket/${id}`, 4500)
  await until(() => !!document.querySelector('[data-ticket-window] .ProseMirror, [data-ticket-window] [data-ticket-actions]'))
  await sleep(1500)
  await p.evaluate(() => document.querySelector('[data-tour-close]')?.click())
  await clean()
  return id
}

const ctx = { p, cdp, LIST, LIST_NAME, rest, open, waitFocus, sleep, until, clean, esc, rectOf, around, clickText, clickLabel, centre, noField, viewport, cap, neutralPeople, teamsOpen, board, listView, backToBoard, menuOf, ticketId, ticket, onlyDemoTeam, hide }
const R = (await import(pathToFileURL(path.resolve(batch)).href)).default(ctx)
if (!names.length) console.log('recipes:', Object.keys(R).join(', '))
for (const name of names) {
  if (!R[name]) { console.log('no recipe:', name); continue }
  try { await R[name]() } catch (e) { console.log(`ERROR ${name}: ${String(e?.message ?? e).split('\n')[0].slice(0, 220)}`); await esc(2).catch(() => {}) }
}
await viewport(1360, 860)
await done('done')
