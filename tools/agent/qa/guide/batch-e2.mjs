// Batch E2: whiteboard popovers (pen settings, board menu).
export default (c) => {
  const { p, sleep, esc, cap, open, rest, LIST, teamsOpen, clean, onlyDemoTeam } = c
  const board = async () => {
    const team = (await rest(`/projects?id=eq.${LIST}&select=team_id`))[0]?.team_id
    const id = (await rest(`/pages?team_id=eq.${team}&title=eq.${encodeURIComponent('Sprint 12 retrospektifi')}&archived_at=is.null&select=id`))[0]?.id
    await open(p, `/page/${id}`, 6000)
    await teamsOpen(); await clean(); await onlyDemoTeam(p)
    await sleep(3000)
  }
  const holder = (re, maxWidth = 560) => p.evaluate(([src, maxWidth]) => {
    const re = new RegExp(src)
    const e = [...document.querySelectorAll('div')].filter((x) => x.getClientRects().length && typeof x.innerText === 'string' && re.test(x.innerText) && x.getBoundingClientRect().width < maxWidth && x.getBoundingClientRect().height > 120)[0]
    const r = e?.getBoundingClientRect()
    return r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null
  }, [re.source, maxWidth])
  const at = (label) => p.evaluate((label) => { const b = [...document.querySelectorAll('main button')].find((x) => x.getClientRects().length && (x.getAttribute('aria-label') ?? x.title ?? '').startsWith(label)); const r = b?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, left: r.left } : null }, label)
  return {
    async 'kalem'() {
      await board()
      const pen = await at('Gökkuşağı kalemi')
      console.log('pen:', JSON.stringify(pen))
      if (!pen) return
      await p.mouse.click(pen.x, pen.y); await sleep(600)
      let box = await holder(/KALINLIK/)
      if (!box) { await p.mouse.click(pen.x, pen.y); await sleep(700); box = await holder(/KALINLIK/) }
      console.log('pen settings:', JSON.stringify(box))
      const bar = await at('Seç (V)')
      if (box) await cap('kalem', { x: Math.max(0, Math.min(box.x, bar?.left ?? box.x) - 20), y: Math.max(0, (bar?.top ?? box.y) - 16), width: 540, height: box.y + box.height + 20 - Math.max(0, (bar?.top ?? box.y) - 16) }, { pointer: true })
      await esc()
      const sel = await at('Seç (V)'); if (sel) { await p.mouse.click(sel.x, sel.y); await sleep(300) }
    },
    async 'tahta-menusu'() {
      await board()
      const m = await at('Whiteboard menüsü')
      console.log('menu button:', JSON.stringify(m))
      if (!m) return
      await p.mouse.click(m.x, m.y); await sleep(800)
      const box = await p.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].find((e) => e.getClientRects().length && /ARKA PLAN/.test(e.innerText)); const r = d?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null })
      console.log('board menu:', JSON.stringify(box), '·', await p.evaluate(() => [...document.querySelectorAll('[role="menu"], [role="dialog"], [data-wb-menu]')].filter((e) => e.getClientRects().length).map((e) => `${e.getAttribute('role')}:${e.innerText.replace(/\s+/g, ' ').slice(0, 120)}`).join(' | ')))
      if (box) await cap('tahta-menusu', { x: Math.max(0, box.x - 260), y: Math.max(0, m.top - 16), width: Math.min(1360 - Math.max(0, box.x - 260), box.width + 280), height: box.y + box.height + 20 - Math.max(0, m.top - 16) }, { pointer: true })
      await esc()
    },
  }
}
