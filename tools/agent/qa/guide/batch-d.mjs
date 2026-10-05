// Batch D: the settings window (tabs), Claude'um, the shortcut list and the F1 layer, team settings.
export default (c) => {
  const { p, sleep, until, esc, rectOf, clickText, noField, viewport, cap, board, menuOf } = c
  // The settings window is the dialog whose own nav has the "Kısayollar" tab (the task window has a nav too).
  const mark = () => p.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].find((d) => [...d.querySelectorAll('nav button')].some((b) => b.innerText.trim() === 'Kısayollar')); document.querySelectorAll('[data-qa-settings]').forEach((e) => e.removeAttribute('data-qa-settings')); d?.setAttribute('data-qa-settings', '1'); return !!d })
  const settingsBox = () => p.evaluate(() => { const r = document.querySelector('[data-qa-settings]')?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null })
  const inSettings = () => !!document.querySelector('[data-qa-settings]')
  const settings = async (tab) => {
    if (!(await mark())) {
      await board()
      await p.locator('[data-tour="profile"] > button').first().click(); await sleep(400)
      await p.locator('[data-tour="profile"] .absolute button').first().click()
      for (let i = 0; i < 30 && !(await mark()); i++) await sleep(250)
      await sleep(600)
    }
    const ok = await p.evaluate((tab) => { const b = [...document.querySelectorAll('[data-qa-settings] nav button')].find((x) => x.innerText.trim() === tab); if (b) b.click(); return !!b }, tab)
    await sleep(1200)
    return ok
  }
  /** No key, no address in a picture: what looks like one is drawn as dots / a made-up one (nothing is saved). */
  const maskSecrets = () => p.evaluate(() => {
    let n = 0
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const v = t.nodeValue
      if (/fira_agt_\w+/.test(v)) { t.nodeValue = v.replace(/fira_agt_\w+…?/g, 'fira_agt_••••'); n++ }
      else if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(v) && !/no@mail\.co|kisi@sirket\.com|ad@sirket\.com/.test(v)) { t.nodeValue = v.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'deniz@ornek.com'); n++ }
    }
    return n
  })
  const teamSettings = async (tab) => {
    if (!(await p.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /takım ayarları/.test(d.getAttribute('aria-label') ?? ''))))) {
      await board()
      if (!(await menuOf('Fira Tanıtım — işlemler'))) return null
      await sleep(300)
      console.log('team settings item:', await clickText('[role="menu"] button, [role="menu"] [role="menuitem"]', 'Takım ayarları'))
      await until(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /takım ayarları/.test(d.getAttribute('aria-label') ?? '')), null, 20)
      await sleep(900)
    }
    const ok = await p.evaluate((tab) => { const d = [...document.querySelectorAll('[role="dialog"]')].find((d) => /takım ayarları/.test(d.getAttribute('aria-label') ?? '')); const b = d && [...d.querySelectorAll('button')].find((x) => x.innerText.trim() === tab); if (b) b.click(); return !!b }, tab)
    await sleep(1500)
    const box = await p.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].find((d) => /takım ayarları/.test(d.getAttribute('aria-label') ?? ''))
      if (!d) return null
      let card = d
      if (card.getBoundingClientRect().width > innerWidth - 4) card = [...d.querySelectorAll('div')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 400 && r.width < innerWidth - 100 && r.height > 300 }) ?? d
      const r = card.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    })
    console.log(`team settings › ${tab}:`, ok, JSON.stringify(box))
    return ok ? box : null
  }
  return {
    async 'ayarlar-bildirimler'() { console.log('tab:', await settings('Bildirimler')); await cap('ayarlar-bildirimler', await settingsBox(), { expect: inSettings }) },
    async 'ayarlar-dil'() { console.log('tab:', await settings('Dil')); await cap('ayarlar-dil', await settingsBox(), { expect: inSettings }) },
    async 'ayarlar-kisayollar'() { console.log('tab:', await settings('Kısayollar')); await cap('ayarlar-kisayollar', await settingsBox(), { expect: inSettings }) },
    async 'claudeum'() {
      console.log('tab:', await settings("Claude'um"))
      await sleep(1500)
      console.log('masked:', await maskSecrets())
      // The agent works in other teams too: only the demo team's name stays in the picture.
      console.log('other teams hidden:', await p.evaluate(() => {
        const demo = [...document.querySelectorAll('[data-qa-settings] *')].find((e) => e.childElementCount === 0 && typeof e.innerText === 'string' && e.innerText.trim() === 'Fira Tanıtım' && !e.closest('nav'))
        if (!demo) return 'demo chip not found'
        let chip = demo, row = demo.parentElement
        while (row && row.childElementCount < 2) { chip = row; row = row.parentElement }
        let n = 0
        for (const c of row.children) if (c !== chip && !/Değiştir/.test(c.innerText)) { c.style.display = 'none'; n++ }
        return n
      }))
      console.log('text:', await p.evaluate(() => document.querySelector('[data-qa-settings]')?.innerText.replace(/\s+/g, ' ').slice(60, 900)))
      await cap('claudeum', await settingsBox(), { expect: inSettings })
    },
    async 'ajan-olustur'() {
      await esc(2)
      await board()
      await settings('Dil')
      await p.evaluate(() => { window.__firaAgentCreatePreview = true })
      console.log('tab:', await settings("Claude'um"))
      await sleep(1200)
      const form = await p.evaluate(() => {
        const b = [...document.querySelectorAll('[data-qa-settings] button')].find((x) => /Ajanı oluştur/.test(x.innerText))
        // the other teams the account is in are not for the picture
        let hidden = 0
        for (const l of document.querySelectorAll('[data-qa-settings] label')) if (l.querySelector('input[type="checkbox"]') && l.innerText.trim() !== 'Fira Tanıtım') { l.style.display = 'none'; hidden++ }
        let f = b
        for (let k = 0; f && k < 8 && !/Claude'unu Fira'ya bağla/.test(f.innerText); k++) f = f.parentElement
        f?.setAttribute('data-qa-create', '1')
        return b ? `teams hidden ${hidden}` : null
      })
      console.log('create form:', form, '·', await p.evaluate(() => document.querySelector('[data-qa-settings]')?.innerText.replace(/\s+/g, ' ').slice(60, 400)))
      await cap('ajan-olustur', await rectOf('[data-qa-create]', 10), { expect: () => !!document.querySelector('[data-qa-create]') })
      await p.evaluate(() => { window.__firaAgentCreatePreview = false })
      await esc(2)
    },
    async 'kisayol-listesi'() {
      await esc(2)
      await board(); await noField()
      await p.keyboard.press('Control+.')
      await until(() => !!document.querySelector('[data-shortcuts-dialog]'), null, 16)
      await sleep(700)
      await cap('kisayol-listesi', await rectOf('[data-shortcuts-dialog]', 0), { expect: () => !!document.querySelector('[data-shortcuts-dialog]') })
      await esc(2)
    },
    async 'f1-katmani'() {
      await esc(2)
      await board(); await noField()
      await p.keyboard.down('F1')
      await until(() => !!document.querySelector('[data-shortcut-layer]'), null, 16)
      await sleep(600)
      await cap('f1-katmani', null, { expect: () => !!document.querySelector('[data-shortcut-layer]') })
      await p.keyboard.up('F1')
      await sleep(400)
    },
    async 'takim-uyeler'() {
      const b = await teamSettings('Üyeler')
      if (!b) return
      // The list of everyone who could be invited names real people: it is taken out of the picture.
      console.log('invite list hidden:', await p.evaluate(() => {
        const h = [...document.querySelectorAll('[role="dialog"] *')].find((e) => e.childElementCount === 0 && typeof e.innerText === 'string' && /KULLANICILARINI DAVET ET/i.test(e.innerText))
        let card = h
        for (let k = 0; card && k < 5 && !/Davet gönder/.test(card.innerText); k++) card = card.parentElement
        if (!card) return false
        card.style.display = 'none'
        return true
      }))
      await sleep(400)
      console.log('masked:', await maskSecrets())
      console.log('people on screen:', await p.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].find((d) => /takım ayarları/.test(d.getAttribute('aria-label') ?? '')); return d.innerText.replace(/\s+/g, ' ').slice(0, 700) }))
      await cap('takim-uyeler', b, { expect: () => ![...document.querySelectorAll('[role="dialog"] *')].some((e) => e.getClientRects().length && e.childElementCount === 0 && /Davet gönder/.test(e.innerText ?? '')) })
    },
    async 'takim-yedek'() { const b = await teamSettings('Yedek ve Taşıma'); if (b) await cap('takim-yedek', b) },
    async 'takim-onenote'() { const b = await teamSettings('OneNote'); if (b) await cap('takim-onenote', b) },
    async 'takim-ajan-kurallari'() { const b = await teamSettings('Ajan kuralları'); if (b) await cap('takim-ajan-kurallari', b) },
    async 'kapat'() { await esc(3) },
  }
}
