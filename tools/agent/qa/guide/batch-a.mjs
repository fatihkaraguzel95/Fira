// Batch A: sidebar menus, the Update button, a board card, quick add, the list view's menus and bulk bar.
export default (c) => {
  const { p, sleep, until, esc, rectOf, clickText, cap, board, listView, backToBoard, menuOf } = c
  return {
    // ── sidebar menus ──
    async 'takimlar-menusu'() {
      await board()
      if (!(await menuOf('Takım oluştur veya katıl'))) return
      await sleep(300)
      await cap('takimlar-menusu', { x: 64, y: 48, width: 640, height: 330 })
      await esc()
    },
    async 'takim-menusu'() {
      await board()
      if (!(await menuOf('Fira Tanıtım — işlemler'))) return
      await sleep(300)
      const m = await rectOf('[role="menu"]')
      await cap('takim-menusu', { x: 64, y: 48, width: 640, height: Math.max(480, m.y + m.height + 16 - 48) })
      await esc()
    },
    async 'klasor-menusu'() {
      await board()
      if (!(await menuOf('Projeler — işlemler'))) return
      await sleep(300)
      const m = await rectOf('[role="menu"]')
      await cap('klasor-menusu', { x: 64, y: 48, width: 640, height: Math.max(420, m.y + m.height + 16 - 48) })
      await esc()
    },
    async 'liste-menusu'() {
      await board()
      if (!(await menuOf('Web sitesi yenileme — işlemler'))) return
      await sleep(300)
      const m = await rectOf('[role="menu"]')
      await cap('liste-menusu', { x: 64, y: 100, width: 600, height: Math.max(420, m.y + m.height + 16 - 100) })
      await esc()
    },

    // ── top bar ──
    async 'guncelle-dugmesi'() {
      await board()
      await p.evaluate(() => window.__firaUpdatePreview?.())
      await until(() => [...document.querySelectorAll('[data-topbar] button')].some((b) => b.innerText.trim() === 'Güncelle'), null, 16)
      await sleep(400)
      await cap('guncelle-dugmesi', { x: 760, y: 0, width: 600, height: 110 }, { expect: () => [...document.querySelectorAll('[data-topbar] button')].some((b) => b.innerText.trim() === 'Güncelle') })
    },

    // ── board ──
    async 'pano-karti'() {
      await board()
      await p.evaluate(() => { const c = [...document.querySelectorAll('[data-ticket-id]')].find((e) => e.innerText.includes('Ana sayfa tasarımı')); c?.setAttribute('data-qa-card', '1') })
      await cap('pano-karti', await rectOf('[data-qa-card]', 14))
    },
    async 'hizli-ekle'() {
      await board()
      await p.evaluate(() => document.querySelector('main [data-shortcut="new-ticket"]')?.click())
      await until(() => !!document.querySelector('main input[placeholder], main textarea[placeholder]'), null, 12)
      await sleep(600)
      console.log('quick add field:', await p.evaluate(() => document.querySelector('main input[placeholder], main textarea[placeholder]')?.getAttribute('placeholder') ?? null))
      await cap('hizli-ekle', { x: 380, y: 110, width: 760, height: 430 }, { expect: () => !!document.querySelector('main input[placeholder], main textarea[placeholder]') })
      await esc(2)
    },
    // ── list view ──
    async 'gorunum-menusu'() {
      await listView()
      console.log('Görünüm menu:', await clickText('[data-list-toolbar] button', 'Görünüm'))
      await sleep(600)
      await cap('gorunum-menusu', { x: 373, y: 48, width: 987, height: 640 })
      await esc()
      await backToBoard()
    },
    async 'tarih-hucresi'() {
      await listView()
      const at = await p.evaluate(() => { const row = [...document.querySelectorAll('[data-list-view] tr[data-ticket-id]')].find((r) => r.innerText.includes('Erişilebilirlik denetimi')); const c = row?.querySelector('td[data-col="due"], td[data-col="due_date"]'); const r = c?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : [...(row?.querySelectorAll('td') ?? [])].map((t) => t.getAttribute('data-col')).join(',') })
      console.log('due cell:', JSON.stringify(at))
      if (at && at.x) { await p.mouse.click(at.x, at.y); await sleep(800) }
      await cap('tarih-hucresi', null, { expect: () => !!document.querySelector('[data-list-view]') })
      await esc(2)
      await backToBoard()
    },
    async 'toplu-islem'() {
      await listView()
      const n = await p.evaluate(() => { let n = 0; for (const t of ['Erişilebilirlik denetimi', 'SSS sayfası içerikleri']) { const row = [...document.querySelectorAll('[data-list-view] tr[data-ticket-id]')].find((r) => r.innerText.includes(t)); const box = row?.querySelector('input[type="checkbox"]'); if (box) { box.click(); n++ } } return n })
      console.log('rows selected:', n)
      await until(() => !!document.querySelector('[data-bulk-bar]'), null, 12)
      await sleep(500)
      await cap('toplu-islem', null, { expect: () => !!document.querySelector('[data-bulk-bar]') })
      await esc(2)
      await p.evaluate(() => { for (const b of document.querySelectorAll('[data-list-view] tr[data-ticket-id] input[type="checkbox"]:checked')) b.click() })
      await backToBoard()
    },
  }
}
