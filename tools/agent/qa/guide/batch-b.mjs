// Batch B: tour, command palette, the list window, saved views, the filter menu with neutral people.
export default (c) => {
  const { p, sleep, until, esc, rectOf, around, clickText, noField, viewport, cap, board, listView, backToBoard, waitFocus } = c
  const palette = async (text) => {
    await noField()
    await p.keyboard.press('Control+k')
    if (!(await waitFocus(p, '[data-palette-input]'))) { console.log('palette input has no focus'); return false }
    await p.keyboard.press('Control+a'); await p.keyboard.press('Delete')
    if (text) await p.keyboard.type(text, { delay: 25 })
    await sleep(1800)
    return true
  }
  const paletteClip = async (minHeight) => { const r = await around(['[data-palette]', '[data-palette-list]'], 24); return r ? { ...r, y: 0, height: Math.max(minHeight, r.y + r.height) } : null }
  const listed = () => !!document.querySelector('[data-palette-list]')
  return {
    async 'tanitim-turu'() {
      await board()
      await p.locator('[data-tour="profile"] > button').first().click(); await sleep(400)
      console.log('tour row:', await clickText('[data-tour="profile"] .absolute button', 'Tanıtım turu'))
      await until(() => !!document.querySelector('[data-tour-close]'), null, 16)
      await sleep(1200)
      const card = await p.evaluate(() => { const r = document.querySelector('[data-tour-close]')?.closest('.shadow-2xl')?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null })
      console.log('tour card:', JSON.stringify(card))
      if (card) await cap('tanitim-turu', { x: Math.max(0, card.x - 60), y: Math.max(0, card.y - 60), width: card.width + 120, height: card.height + 120 })
      await p.evaluate(() => document.querySelector('[data-tour-close]')?.click())
      await sleep(500)
    },
    async 'palet-filtreler'() { await board(); if (await palette('?')) { await cap('palet-filtreler', await paletteClip(420), { expect: listed }); await esc(2) } },
    async 'palet-filtreli'() { await board(); if (await palette('liste:"web sitesi" durum:açık tasarım')) { await cap('palet-filtreli', await paletteClip(200), { expect: listed }); await esc(2) } },
    async 'palet-arama'() { await board(); if (await palette('kampanya')) { await cap('palet-arama', await paletteClip(240), { expect: listed }); await esc(2) } },
    async 'palet-komutlar'() { await board(); if (await palette('>')) { await cap('palet-komutlar', await paletteClip(560), { expect: listed }); await esc(2) } },
    async 'filtre-menusu'() {
      await board()
      await p.evaluate(() => document.querySelector('[data-context-bar] [data-shortcut="filter"]')?.click())
      await sleep(600)
      const at = await p.evaluate(() => { const x = [...document.querySelectorAll('button, [role="menuitem"]')].find((e) => e.getClientRects().length && /^Atama/.test(e.innerText.trim())); const r = x?.getBoundingClientRect(); return r ? { x: r.x + 30, y: r.y + r.height / 2 } : null })
      const subOpen = () => p.evaluate(() => [...document.querySelectorAll('label, button')].some((e) => e.getClientRects().length && /Atanmayan/.test(e.innerText)))
      if (at) {
        await p.mouse.move(at.x - 5, at.y); await p.mouse.move(at.x, at.y); await sleep(900)
        if (!(await subOpen())) { await p.mouse.click(at.x, at.y); await sleep(800) }
      }
      console.log('submenu open:', await subOpen())
      await cap('filtre-menusu', { x: 373, y: 48, width: 987, height: 560 }, { pointer: true })
      await esc(3)
    },
    // The list window: the whole of it, its top (name, folder, icon, colour, background), its statuses.
    async 'liste-penceresi'() {
      await viewport(1360, 1240)
      await board()
      await p.evaluate(() => document.querySelector('[data-crumb-list]')?.click())
      await until(() => !!document.querySelector('[data-list-modal]'), null, 16)
      await sleep(900)
      const info = await p.evaluate(() => {
        const m = document.querySelector('[data-list-modal]')
        const r = m.getBoundingClientRect()
        const heads = [...m.querySelectorAll('h3, h4, p, label, legend')].filter((e) => /^(DURUMLAR|Durumlar)$/.test(e.innerText.trim()))
        const scroller = [...m.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible')
        return { box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }, statusesAt: heads[0] ? Math.round(heads[0].getBoundingClientRect().y) : null, scrolls: scroller ? scroller.scrollHeight - scroller.clientHeight : 0 }
      })
      console.log('list window:', JSON.stringify(info))
      const b = info.box
      await cap('liste-penceresi', b, { expect: () => !!document.querySelector('[data-list-modal]') })
      if (info.statusesAt) {
        await cap('liste-ust', { ...b, height: info.statusesAt - 14 - b.y })
        await cap('liste-durumlar', { ...b, y: info.statusesAt - 18, height: b.y + b.height - info.statusesAt + 18 })
      }
      await esc(2)
      await viewport(1360, 860)
    },
    // Saved views: the built-in tabs, one saved view and +. The saved view is demo data and stays.
    async 'gorunum-sekmeleri'() {
      await listView()
      const has = () => p.evaluate(() => [...document.querySelectorAll('[data-view-bar] button')].some((b) => b.innerText.trim() === 'Önceliğe göre'))
      if (!(await has())) {
        console.log('group menu:', await p.evaluate(() => { const b = [...document.querySelectorAll('[data-list-toolbar] button')].find((x) => /^Grupla/.test(x.innerText.trim())); b?.click(); return !!b }))
        await sleep(500)
        console.log('by priority:', await p.evaluate(() => { const b = [...document.querySelectorAll('[role="menu"] button, [role="menu"] [role="menuitemradio"], [role="menu"] label')].find((x) => x.innerText.trim() === 'Öncelik'); b?.click(); return !!b }))
        await sleep(900)
        await esc()
        await p.evaluate(() => document.querySelector('[data-view-add]')?.click())
        await sleep(600)
        const field = await p.evaluate(() => { const i = [...document.querySelectorAll('input[type="text"], input:not([type])')].find((x) => x.getClientRects().length && x.closest('[data-context-bar], [role="dialog"], [data-view-bar], .shadow-lg')); i?.setAttribute('data-qa-view-name', '1'); return i ? i.placeholder : null })
        console.log('name field:', field)
        if (field === null || !(await waitFocus(p, '[data-qa-view-name]'))) { console.log('no focused name field; not typing'); await esc(2); return }
        await p.keyboard.type('Önceliğe göre', { delay: 20 })
        await p.keyboard.press('Enter')
        await sleep(1500)
      }
      console.log('saved view there:', await has())
      await cap('gorunum-sekmeleri', { x: 373, y: 48, width: 987, height: 560 }, { expect: () => [...document.querySelectorAll('[data-view-bar] button')].some((b) => b.innerText.trim() === 'Önceliğe göre') })
      await p.evaluate(() => document.querySelector('[data-builtin-tab="list"]')?.click()); await sleep(700)
      await backToBoard()
    },
  }
}
