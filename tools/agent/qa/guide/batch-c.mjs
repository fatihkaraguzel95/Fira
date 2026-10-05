// Batch C: the task window (editor bar, slash menu, recurrence, sections, files, activity, AI button, assignee picker).
export default (c) => {
  const { p, sleep, until, esc, rectOf, around, clickText, noField, cap, ticket, ticketId, listView, backToBoard, waitFocus, rest } = c
  const EDITOR = '[data-ticket-window] [data-tour="ticket-description"] .ProseMirror'
  /** The left column of the full-screen task window (everything left of the activity panel), below the top bar. */
  const leftColumn = () => p.evaluate(() => { const a = document.querySelector('[data-tour="ticket-activity"]')?.getBoundingClientRect(); return { x: 0, y: 48, width: Math.round(a ? a.left : innerWidth), height: innerHeight - 48 } })
  /** Mark the section whose heading starts with the given text; answers whether it was found. */
  const section = (head, mark) => p.evaluate(([head, mark]) => {
    const h = [...document.querySelectorAll('[data-ticket-window] *')].find((e) => e.childElementCount <= 2 && e.getClientRects().length && typeof e.innerText === 'string' && e.innerText.trim().startsWith(head) && e.innerText.trim().length < head.length + 14)
    if (!h) return false
    let s = h
    while (s.parentElement && !s.parentElement.matches('[data-tour="ticket-sections"]') && s.parentElement.getBoundingClientRect().height < 700 && !/group\/sec/.test(s.className)) s = s.parentElement
    s.setAttribute('data-qa-sec', mark)
    return true
  }, [head, mark])
  const scrollTo = async (sel, block = 'start') => { await p.evaluate(([s, block]) => document.querySelector(s)?.scrollIntoView({ block }), [sel, block]); await sleep(500) }
  const groupByStatus = async () => {
    if (!/Grupla: Durum/.test(await p.evaluate(() => document.querySelector('[data-list-toolbar]')?.innerText ?? ''))) {
      await p.evaluate(() => [...document.querySelectorAll('[data-list-toolbar] button')].find((x) => /^Grupla/.test(x.innerText.trim()))?.click()); await sleep(500)
      console.log('group back to status:', await p.evaluate(() => { const b = [...document.querySelectorAll('[role="menu"] button, [role="menu"] label')].find((x) => x.innerText.trim() === 'Durum'); b?.click(); return !!b }))
      await sleep(800); await esc()
    }
  }
  return {
    async 'liste-duzelt'() { await listView(); await groupByStatus(); console.log('toolbar:', await p.evaluate(() => document.querySelector('[data-list-toolbar]')?.innerText.replace(/\s+/g, ' '))); await backToBoard() },
    async 'planlanan-tekrarlar'() {
      await listView(); await groupByStatus()
      await p.evaluate(() => { const s = document.querySelector('[data-list-view]'); const sc = [...s.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 40 && getComputedStyle(e).overflowY !== 'visible'); if (sc) sc.scrollTop = sc.scrollHeight })
      await sleep(900)
      await cap('planlanan-tekrarlar', { x: 373, y: 48, width: 987, height: 812 }, { expect: () => !!document.querySelector('[data-ghost-row]') })
      await backToBoard()
    },
    async 'bicim-cubugu'() {
      if (!(await ticket('Hız ölçümü ve iyileştirme'))) return
      const cell = await p.evaluate((E) => { const td = document.querySelector(`${E} table td`); td?.scrollIntoView({ block: 'center' }); const r = td?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null }, EDITOR)
      console.log('table cell:', JSON.stringify(cell))
      if (!cell) return
      await sleep(400)
      const at = await p.evaluate((E) => { const r = document.querySelector(`${E} table td`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, EDITOR)
      await p.mouse.click(at.x, at.y); await sleep(900)
      await cap('bicim-cubugu', await leftColumn(), { expect: () => !!document.querySelector('[data-ticket-window] .ProseMirror-focused') })
      await noField(); await sleep(300)
    },
    async 'komut-menusu'() {
      const id = await ticket('İletişim formu')
      if (!id) return
      const before = (await rest(`/tickets?id=eq.${id}&select=description`))[0]?.description
      const at = await p.evaluate((E) => { const ps = document.querySelectorAll(`${E} > *`); const last = ps[ps.length - 1]; const r = last?.getBoundingClientRect(); return r ? { x: r.x + r.width - 8, y: r.y + r.height / 2 } : null }, EDITOR)
      if (!at) { console.log('no editor'); return }
      await p.mouse.click(at.x, at.y); await sleep(500)
      if (!(await waitFocus(p, EDITOR))) { console.log('editor has no focus; not typing'); return }
      await p.keyboard.press('End'); await p.keyboard.press('Enter'); await p.keyboard.type('/'); await sleep(900)
      await cap('komut-menusu', await leftColumn())
      await esc(); await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace'); await sleep(400)
      await noField(); await sleep(2500)
      const after = (await rest(`/tickets?id=eq.${id}&select=description`))[0]?.description
      if (after !== before) { await rest(`/tickets?id=eq.${id}`, { method: 'PATCH', body: { description: before } }); console.log('description restored (it had changed)') } else console.log('description unchanged')
    },
    async 'tekrar-penceresi'() {
      if (!(await ticket('Haftalık durum toplantısı notları'))) return
      const at = await p.evaluate(() => {
        const label = [...document.querySelectorAll('[data-tour="ticket-props"] *')].find((e) => e.childElementCount === 0 && typeof e.innerText === 'string' && e.innerText.trim() === 'TEKRAR')
        let row = label?.parentElement
        for (let k = 0; row && k < 3 && !row.querySelector('button'); k++) row = row.parentElement
        const b = row?.querySelector('button')
        const r = b?.getBoundingClientRect()
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, text: b.innerText.trim() } : null
      })
      console.log('recurrence button:', JSON.stringify(at))
      if (!at) return
      await p.mouse.click(at.x, at.y); await sleep(1500)
      const box = await p.evaluate(() => {
        const cards = [...document.querySelectorAll('div, form')].filter((e) => e.getClientRects().length && typeof e.innerText === 'string' && /HATIRLATMA/.test(e.innerText) && /Kaydet/.test(e.innerText) && e.getBoundingClientRect().width < 700)
        const r = cards[0]?.getBoundingClientRect()   // the outermost narrow holder: the card itself
        return r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null
      })
      console.log('recurrence box:', JSON.stringify(box))
      if (box) await cap('tekrar-penceresi', { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 12), width: box.width + 24, height: Math.min(860 - Math.max(0, box.y - 12), box.height + 24) })
      await esc()
    },
    async 'ekleme-listesi'() {
      if (!(await ticket('İletişim formu'))) return
      await scrollTo('[data-tour="ticket-description"]', 'start')
      await cap('ekleme-listesi', await around(['[data-tour="ticket-description"]', '[data-ticket-actions]'], 16), { expect: () => !!document.querySelector('[data-ticket-action="subtasks"]') })
    },
    async 'bos-alt-gorevler'() {
      await c.viewport(1360, 1060)
      if (!(await ticket('İletişim formu'))) return
      const at = await p.evaluate(() => { const r = document.querySelector('[data-ticket-action="subtasks"]')?.getBoundingClientRect(); return r ? { x: r.x + 40, y: r.y + r.height / 2 } : null })
      if (!at) return
      await p.mouse.click(at.x, at.y); await sleep(1200)
      const ok = await p.evaluate(() => { let s = document.activeElement; if (!s || !/Alt görev ekle/.test(s.getAttribute('placeholder') ?? '')) return false; for (let k = 0; k < 6 && !/ALT GÖREVLER/.test(s.innerText ?? ''); k++) s = s.parentElement; s.setAttribute('data-qa-sec', 'sub'); return true })
      console.log('empty section open:', ok)
      await cap('bos-alt-gorevler', await around(['[data-qa-sec="sub"]', '[data-ticket-actions]'], 16), { expect: () => !!document.querySelector('[data-qa-sec="sub"]'), pointer: true })
      await esc()   // Esc in the empty box hides the section again
      await sleep(500)
      console.log('section hidden again:', await p.evaluate(() => !!document.querySelector('[data-ticket-action="subtasks"]')))
      await noField()
    },
    async 'bolumler'() {
      if (!(await ticket('Ana sayfa tasarımı'))) return
      const headTop = (head) => p.evaluate((head) => { const h = [...document.querySelectorAll('[data-ticket-window] *')].find((e) => e.childElementCount <= 2 && e.getClientRects().length && typeof e.innerText === 'string' && e.innerText.trim().startsWith(head) && e.innerText.trim().length < head.length + 14); return h ? Math.round(h.getBoundingClientRect().top) : null }, head)
      console.log('heading marked:', await section('ALT GÖREVLER', 'sub'))
      await scrollTo('[data-qa-sec="sub"]', 'start')
      await p.evaluate(() => { const s = document.querySelector('[data-qa-sec="sub"]'); let sc = s.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 20 && getComputedStyle(sc).overflowY !== 'visible')) sc = sc.parentElement; if (sc) sc.scrollTop -= 24 })
      await sleep(500)
      const col = await leftColumn()
      const top = await headTop('ALT GÖREVLER'), files = await headTop('DOSYALAR'), chk = await headTop('YAPILACAKLAR'), lnk = await headTop('BAĞLI GÖREVLER')
      console.log('tops:', top, chk, lnk, files)
      if (top && files) await cap('bolumler', { x: 8, y: top - 14, width: col.width - 16, height: files - top - 6 })
      if (chk && lnk) await cap('yapilacaklar', { x: 8, y: chk - 14, width: col.width - 16, height: lnk - chk - 4 })
    },
    async 'gorev-bagla'() {
      if (!(await ticket('Ana sayfa tasarımı'))) return
      await scrollTo('[data-link-bar]', 'center')
      const at = await p.evaluate(() => { const r = document.querySelector('[data-link-input]')?.getBoundingClientRect(); return r ? { x: r.x + 40, y: r.y + r.height / 2 } : null })
      if (!at) { console.log('no link bar'); return }
      await p.mouse.click(at.x, at.y); await sleep(1500)
      const list = await p.evaluate(() => { const bar = document.querySelector('[data-link-bar]'); const l = bar && [...document.querySelectorAll('[role="listbox"]')].find((x) => x.getClientRects().length); l?.setAttribute('data-qa-link-list', '1'); return !!l })
      console.log('candidates listed:', list)
      await cap('gorev-bagla', await around(['[data-link-bar]', '[data-qa-link-list]'], 16))
      await esc(); await noField()
    },
    async 'dosyalar'() {
      await c.viewport(1360, 1340)
      if (!(await ticket('Ana sayfa tasarımı'))) return
      console.log('files section:', await section('DOSYALAR', 'files'))
      await scrollTo('[data-qa-sec="files"]', 'center')
      await p.evaluate(() => { const s = document.querySelector('[data-qa-sec="files"]'); let sc = s.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 20 && getComputedStyle(sc).overflowY !== 'visible')) sc = sc.parentElement; if (sc) sc.scrollTop += 120 })
      await sleep(400)
      const info = await p.evaluate(() => { const a = document.querySelectorAll('[data-attachment]')[1]; return a ? [...a.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.title ?? b.innerText.trim()) : null })
      console.log('second file buttons:', JSON.stringify(info))
      const at = await p.evaluate(() => { const r = document.querySelectorAll('[data-attachment]')[1]?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })
      if (at) { await p.mouse.move(at.x, at.y); await sleep(500) }
      const opened = await p.evaluate(() => { const a = document.querySelectorAll('[data-attachment]')[1]; const b = a && [...a.querySelectorAll('button')].find((x) => /işlemler|Diğer|menü/i.test(x.getAttribute('aria-label') ?? x.title ?? '')); b?.click(); return !!b })
      await sleep(600)
      console.log('file menu opened:', opened, await p.evaluate(() => !!document.querySelector('[role="menu"]')))
      const span = await p.evaluate(() => {
        const head = [...document.querySelectorAll('[data-ticket-window] *')].find((e) => e.childElementCount <= 2 && e.getClientRects().length && typeof e.innerText === 'string' && e.innerText.trim().startsWith('BAĞLI GÖREVLER'))
        const menu = [...document.querySelectorAll('div')].filter((e) => e.getClientRects().length && typeof e.innerText === 'string' && /Yeniden adlandır/.test(e.innerText) && /İndir/.test(e.innerText) && e.getBoundingClientRect().width < 320).pop()
        const bottoms = [menu?.getBoundingClientRect().bottom ?? 0, ...[...document.querySelectorAll('[data-attachment]')].map((a) => a.getBoundingClientRect().bottom)]
        return { top: head ? Math.round(head.getBoundingClientRect().top) : 48, bottom: Math.round(Math.max(...bottoms)) }
      })
      console.log('span:', JSON.stringify(span))
      const col = await leftColumn()
      await cap('dosyalar', { x: 0, y: Math.max(48, span.top - 16), width: col.width, height: Math.min(1340, span.bottom + 18) - Math.max(48, span.top - 16) }, { pointer: true })
      await esc()
    },
    async 'dosya-onizleme'() {
      if (!(await ticket('Ana sayfa tasarımı'))) return
      await section('DOSYALAR', 'files')
      await scrollTo('[data-qa-sec="files"]', 'start')
      const at = await p.evaluate(() => { const a = [...document.querySelectorAll('[data-attachment]')].find((x) => /\.png|\.jpg/i.test(x.innerText)) ?? document.querySelector('[data-attachment]'); const img = a?.querySelector('img') ?? a; const r = img?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })
      if (!at) return
      await p.mouse.click(at.x, at.y)
      await until(() => !!document.querySelector('[data-wco-bar]'), null, 16)
      await sleep(1800)
      await cap('dosya-onizleme', null, { expect: () => !!document.querySelector('[data-wco-bar]') })
      await esc()
    },
    async 'etkinlik-paneli'() {
      if (!(await ticket('Ana sayfa tasarımı'))) return
      console.log('Tümü:', await clickText('[data-timeline-filter] button', 'Tümü'))
      await sleep(1500)
      await cap('etkinlik-paneli', await rectOf('[data-tour="ticket-activity"]', 0))
      console.log('back to comments:', await p.evaluate(() => { const b = [...document.querySelectorAll('[data-timeline-filter] button')].find((x) => /^Yorumlar/.test(x.innerText.trim())); b?.click(); return !!b }))
      await sleep(1500)
    },
    async 'claude-yaptir'() {
      if (!(await ticket('Ana sayfa tasarımı'))) return
      const r = await around(['[data-tour="ticket-title"]', '[data-tour="ticket-ai"]'], 24)
      await cap('claude-yaptir', r ? { x: 0, y: r.y, width: 690, height: r.height + 30 } : null)
    },
    async 'ajan-satiri'() {
      if (!(await ticket('Erişilebilirlik denetimi'))) return
      console.log('assign:', await p.evaluate(() => { const b = [...document.querySelectorAll('[data-tour="ticket-props"] button')].find((x) => x.innerText.trim() === 'Kişi ata'); b?.click(); return !!b }))
      await sleep(1500)
      const pick = await p.evaluate(() => { const i = [...document.querySelectorAll('input')].find((x) => x.getClientRects().length && /Ad veya e-posta/.test(x.placeholder)); let b = i; for (let k = 0; b && k < 6 && b.getBoundingClientRect().height < 120; k++) b = b.parentElement; b?.setAttribute('data-qa-picker', '1'); return !!b })
      console.log('picker:', pick)
      const r = await around(['[data-tour="ticket-ai"]', '[data-tour="ticket-props"]', '[data-qa-picker]'], 16)
      await cap('ajan-satiri', r)
      await esc(); await noField()
    },
  }
}
