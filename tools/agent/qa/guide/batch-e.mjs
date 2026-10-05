// Batch E: pages (page screen, version history) and canvases (drawing, whiteboard, pen settings, board menu).
export default (c) => {
  const { p, sleep, until, esc, rectOf, around, clickText, clickLabel, noField, cap, open, rest, LIST, teamsOpen, clean, onlyDemoTeam } = c
  const TEAM = async () => (await rest(`/projects?id=eq.${LIST}&select=team_id`))[0]?.team_id
  const pageId = async (title) => { const team = await TEAM(); return (await rest(`/pages?team_id=eq.${team}&title=eq.${encodeURIComponent(title)}&archived_at=is.null&select=id,kind`))[0]?.id ?? null }
  const page = async (title) => {
    const id = await pageId(title)
    if (!id) { console.log('no demo page:', title); return null }
    await open(p, `/page/${id}`, 5500)
    await teamsOpen(); await clean(); await onlyDemoTeam(p)
    await sleep(800)
    return id
  }
  const buttons = (scope) => p.evaluate((scope) => [...document.querySelectorAll(`${scope} button`)].filter((b) => b.getClientRects().length).map((b) => `${(b.getAttribute('aria-label') ?? b.title ?? '').slice(0, 28)}«${b.innerText.replace(/\s+/g, ' ').trim().slice(0, 18)}»`).join(' '), scope)
  return {
    async 'sayfa'() {
      if (!(await page('Toplantı notları'))) return
      console.log('main buttons:', (await buttons('main')).slice(0, 500))
      await cap('sayfa', null, { expect: () => /Toplantı notları/.test(document.querySelector('main')?.innerText ?? '') })
    },
    async 'surum-gecmisi'() {
      if (!(await page('Toplantı notları'))) return
      console.log('history:', await p.evaluate(() => { const b = [...document.querySelectorAll('main button')].find((x) => /Sürüm geçmişi/.test(x.innerText + (x.getAttribute('aria-label') ?? ''))); b?.click(); return !!b }))
      await until(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /Sürüm geçmişi/.test(d.getAttribute('aria-label') ?? d.innerText.slice(0, 40))), null, 20)
      await sleep(1500)
      // the first older version, compared side by side
      console.log('version rows:', await p.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].find((d) => /Sürüm geçmişi/.test(d.innerText.slice(0, 60))); const rows = d ? [...d.querySelectorAll('button')].filter((b) => /\d{4}|Eyl|Eki/.test(b.innerText) && b.getBoundingClientRect().width > 100) : []; rows[1]?.click(); return rows.map((r) => r.innerText.replace(/\s+/g, ' ').slice(0, 40)) }))
      await sleep(1500)
      const box = await p.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].find((d) => /Sürüm geçmişi/.test(d.innerText.slice(0, 60))); if (!d) return null; let card = d; if (card.getBoundingClientRect().width > innerWidth - 4) card = [...d.querySelectorAll('div')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 500 && r.width < innerWidth - 60 && r.height > 300 }) ?? d; const r = card.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } })
      console.log('history box:', JSON.stringify(box))
      if (box) await cap('surum-gecmisi', box)
      await esc(2)
    },
    async 'cizim'() {
      if (!(await page('Site haritası'))) return
      await sleep(3500)
      // Fit the drawing: an empty spot of the canvas takes the focus (the selection tool is active), Shift+1 fits.
      await p.mouse.click(1250, 620); await sleep(300)
      await p.keyboard.press('Shift+Digit1'); await sleep(1500)
      await cap('cizim', null, { expect: () => !!document.querySelector('canvas') })
    },
    async 'whiteboard'() {
      if (!(await page('Sprint 12 retrospektifi'))) return
      await sleep(3500)
      console.log('fit:', await p.evaluate(() => { const b = [...document.querySelectorAll('main button')].find((x) => (x.getAttribute('aria-label') ?? x.title ?? '').startsWith('Tümünü göster')); b?.click(); return !!b }))
      await sleep(1200)
      // one step out: the floating tool bar no longer sits on the column titles
      for (let i = 0; i < 2; i++) { await p.evaluate(() => [...document.querySelectorAll('main button')].find((x) => (x.getAttribute('aria-label') ?? x.title ?? '').startsWith('Uzaklaştır'))?.click()); await sleep(500) }
      await sleep(900)
      await cap('whiteboard', null, { expect: () => /Sprint 12/.test(document.querySelector('main')?.innerText ?? '') })
    },
  }
}
