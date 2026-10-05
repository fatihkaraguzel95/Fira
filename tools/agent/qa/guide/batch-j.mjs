// Batch J: passive jobs (the text in a picture, translation), reading languages, the whiteboard's timer,
// search by kind (0.95.0 – 0.97.1). Demo team only.
export default (c) => {
  const { p, sleep, until, esc, rest, open, rectOf, around, cap, ticket, board, menuOf, clickText, clean, noField } = c
  const TEAM = 'e2fcf0ad-fbaf-4d79-a4aa-9af422e0c4a7'
  const inTicket = () => !!document.querySelector('[data-ticket-window]')
  /** The team settings window on a tab; the clip of the element `sel` inside it. */
  const teamSettings = async (tab, sel) => {
    await board()
    if (!(await menuOf('Fira Tanıtım — işlemler'))) return null
    await sleep(300)
    await clickText('[role="menu"] button, [role="menu"] [role="menuitem"]', 'Takım ayarları')
    await until(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /takım ayarları/.test(d.getAttribute('aria-label') ?? '')), null, 20)
    await sleep(900)
    await p.evaluate((tab) => { const d = [...document.querySelectorAll('[role="dialog"]')].find((d) => /takım ayarları/.test(d.getAttribute('aria-label') ?? '')); [...(d?.querySelectorAll('button') ?? [])].find((x) => x.innerText.trim() === tab)?.click() }, tab)
    await sleep(1500)
    await p.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), sel)
    await sleep(600)
    return rectOf(sel, 10)
  }
  /** The personal settings window on a tab (the dialog whose nav has "Kısayollar"). */
  const settings = async (tab) => {
    await board()
    await p.locator('[data-tour="profile"] > button').first().click(); await sleep(400)
    await p.locator('[data-tour="profile"] .absolute button').first().click()
    const mark = () => p.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].find((d) => [...d.querySelectorAll('nav button')].some((b) => b.innerText.trim() === 'Kısayollar')); d?.setAttribute('data-qa-settings', ''); return !!d })
    for (let i = 0; i < 30 && !(await mark()); i++) await sleep(250)
    await p.evaluate((tab) => [...document.querySelectorAll('[data-qa-settings] nav button')].find((x) => x.innerText.trim() === tab)?.click(), tab)
    await sleep(1200)
  }
  const whiteboard = async () => {
    const [b] = await rest(`/pages?team_id=eq.${TEAM}&kind=eq.whiteboard&archived_at=is.null&select=id&limit=1`)
    if (!b) { console.log('no demo whiteboard'); return false }
    await open(p, `/page/${b.id}`, 6500)
    await until(() => !!document.querySelector('[data-whiteboard]'))
    await sleep(1200)
    await clean()
    // a timer left by an earlier run is closed first
    if (await p.evaluate(() => !!document.querySelector('[data-wb-timer-stop]'))) { await p.locator('[data-wb-timer-stop]').click(); await sleep(1200) }
    return true
  }
  return {
    // The file preview with what was read from the picture (0.95.0).
    async 'gorsel-metin'() {
      if (!(await ticket('Ana sayfa tasarımı'))) return
      await until(() => document.querySelectorAll('[data-ticket-window] [data-attachment]').length > 0, null, 30)
      await p.evaluate(() => [...document.querySelectorAll('[data-attachment]')].find((x) => /\.png/i.test(x.innerText))?.scrollIntoView({ block: 'center' }))
      await sleep(500)
      const at = await p.evaluate(() => { const a = [...document.querySelectorAll('[data-attachment]')].find((x) => /\.png/i.test(x.innerText)); const r = (a?.querySelector('img') ?? a)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })
      if (!at) { console.log('no picture among the files'); return }
      await p.mouse.click(at.x, at.y)
      if (!(await until(() => !!document.querySelector('[data-image-text-toggle]'), null, 24))) { console.log('the picture has no text read'); await esc(); return }
      await p.evaluate(() => document.querySelector('[data-image-text-toggle]').click()); await sleep(900)
      await cap('gorsel-metin', null, { expect: () => !!document.querySelector('[data-image-text]') })
      await esc(); await sleep(400)
    },
    // The team's two switches (0.95.0, 0.96.0).
    async 'pasif-isler'() {
      const r = await teamSettings('Ajan kuralları', '[data-rule-passive]')
      if (r) await cap('pasif-isler', r, { expect: () => !!document.querySelector('[data-passive-translate]') })
      await esc()
    },
    // Settings › Dil › the languages I read (0.96.0).
    async 'okuma-dilleri'() {
      await settings('Dil')
      await p.evaluate(() => document.querySelector('[data-reading]')?.scrollIntoView({ block: 'center' })); await sleep(600)
      await cap('okuma-dilleri', await rectOf('[data-reading]', 12), { expect: () => !!document.querySelector('[data-read-lang]') })
      await esc()
    },
    // Two comments in other languages, shown translated (0.96.0).
    async 'ceviri-yorum'() {
      if (!(await ticket('Ana sayfa tasarımı'))) return
      if (!(await until(() => document.querySelectorAll('[data-translation-note]').length >= 2, null, 30))) { console.log('no translated comments'); return }
      await noField()
      const r = await p.evaluate(() => {
        const col = document.querySelector('[data-tour="ticket-activity"]')?.getBoundingClientRect()
        const notes = [...document.querySelectorAll('[data-tour="ticket-activity"] [data-translation-note]')].map((n) => n.getBoundingClientRect())
        if (!col || !notes.length) return null
        return { x: Math.round(col.left), y: Math.round(col.top), width: Math.round(col.width), height: Math.round(Math.max(...notes.map((n) => n.bottom)) + 24 - col.top) }
      })
      if (r) await cap('ceviri-yorum', r, { expect: inTicket })
    },
    // The same comment with the original showing (0.96.0).
    async 'ceviri-orijinal'() {
      if (!(await ticket('Ana sayfa tasarımı'))) return
      if (!(await until(() => document.querySelectorAll('[data-translation-toggle]').length >= 1, null, 30))) { console.log('no translated comments'); return }
      await p.evaluate(() => document.querySelector('[data-tour="ticket-activity"] [data-translation-toggle]')?.click()); await sleep(700)
      await noField()
      const r = await p.evaluate(() => { const n = document.querySelector('[data-tour="ticket-activity"] [data-translation-note="original"]'); const box = n?.parentElement?.getBoundingClientRect(); return box ? { x: Math.round(box.x) - 12, y: Math.round(box.y) - 12, width: Math.round(box.width) + 24, height: Math.round(box.height) + 24 } : null })
      if (r) await cap('ceviri-orijinal', r, { expect: inTicket })
      await p.evaluate(() => document.querySelector('[data-tour="ticket-activity"] [data-translation-toggle]')?.click()); await sleep(300)
    },
    // A description in another language, shown translated: lists, a table, code and links stay as they are (0.96.0).
    async 'ceviri-aciklama'() {
      const [t] = await rest(`/tickets?title=eq.${encodeURIComponent('Newsletter copy review')}&select=id,project:projects!inner(team_id)&project.team_id=eq.${TEAM}`)
      if (!t) { console.log('no demo task "Newsletter copy review"'); return }
      await open(p, `/ticket/${t.id}`, 5000)
      if (!(await until(() => !!document.querySelector('[data-tour="ticket-description"] [data-translation-note]'), null, 40))) { console.log('the description has no translation'); return }
      await clean(); await noField()
      // the description starts below the properties: it is brought to the top of its column, whole
      await p.evaluate(() => document.querySelector('[data-tour="ticket-description"]')?.scrollIntoView({ block: 'start' })); await sleep(700)
      const r = await p.evaluate(() => { const b = document.querySelector('[data-tour="ticket-description"]')?.getBoundingClientRect(); if (!b) return null; const y = Math.max(0, Math.round(b.y) - 12); return { x: Math.max(0, Math.round(b.x) - 12), y, width: Math.round(b.width) + 24, height: Math.min(innerHeight - y, Math.round(b.height) + 24) } })
      if (r) await cap('ceviri-aciklama', r, { expect: inTicket })
    },
    // The whiteboard's timer: the panel that starts it, and the countdown (0.97.0). The timer is closed again.
    async 'wb-zamanlayici'() {
      if (!(await whiteboard())) return
      await p.locator('[data-wb-tool="timer"]').click(); await sleep(600)
      const panel = await around(['[data-wb-timer-start]', '[data-wb-tool="timer"]', '[data-wb-zoom]'], 22)
      if (panel) await cap('wb-zamanlayici', panel, { expect: () => !!document.querySelector('[data-wb-timer-start]'), pointer: true })
      await p.locator('[data-wb-timer-preset="5"]').click(); await sleep(1800)
      // the whole board, so the countdown is seen where it stands
      const boardBox = await rectOf('[data-whiteboard]', 0)
      if (boardBox) await cap('wb-geri-sayim', boardBox, { expect: () => !!document.querySelector('[data-wb-timer="running"]') })
      await p.locator('[data-wb-timer-stop]').click(); await sleep(1500)
      console.log('timer closed:', await p.evaluate(() => !document.querySelector('[data-wb-timer]')))
    },
    // The palette asked for drawings and whiteboards of the demo team (0.97.1).
    async 'arama-tur'() {
      await board()
      await p.evaluate(() => window.dispatchEvent(new CustomEvent('fira:palette', { detail: 'tür:çizim,whiteboard takım:"Fira Tanıtım" ' })))
      await until(() => document.querySelectorAll('[data-palette-list] [role="option"]').length >= 2, null, 30)
      await sleep(700)
      const rows = await p.evaluate(() => [...document.querySelectorAll('[data-palette-list] [role="option"]')].map((o) => o.innerText.replace(/\s+/g, ' ').trim()))
      if (!rows.every((r) => /Fira Tanıtım/.test(r))) { console.log('SKIP arama-tur: demo takım dışı satır var'); await esc(); return }
      const r = await p.evaluate(() => { const b = document.querySelector('[data-palette]')?.getBoundingClientRect(); const l = document.querySelector('[data-palette-list]')?.getBoundingClientRect(); if (!b || !l) return null; const y = Math.max(0, Math.round(b.y) - 8); return { x: Math.round(b.x) - 10, y, width: Math.round(b.width) + 20, height: Math.round(l.bottom) + 10 - y } })
      if (r) await cap('arama-tur', r, { expect: () => !!document.querySelector('[data-palette-list]'), pointer: true })
      await esc()
    },
  }
}
