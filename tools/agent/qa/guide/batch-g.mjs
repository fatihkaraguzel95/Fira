// Batch G: home panel, Görevlerim, the agent panel, the run detail and its rules box, admin.
export default (c) => {
  const { p, sleep, until, esc, rectOf, around, clickText, noField, viewport, cap, board, open, rest, LIST, clean } = c
  const demo = async () => {
    const team = (await rest(`/projects?id=eq.${LIST}&select=team_id`))[0]?.team_id
    const lists = await rest(`/projects?team_id=eq.${team}&select=id,name`)
    const tickets = await rest(`/tickets?project_id=in.(${lists.map((l) => l.id).join(',')})&select=id,title`)
    const pages = await rest(`/pages?team_id=eq.${team}&select=title`)
    return { team, ids: tickets.map((t) => t.id), allowed: [...lists.map((l) => l.name), ...tickets.map((t) => t.title), ...pages.map((x) => x.title)] }
  }
  /**
   * The home panel lists what was opened lately and the favourites, from every team. A row there has
   * an "— işlemler" button named after it: rows whose name is not the demo team's are hidden by a
   * style rule unless marked (a redrawn row comes back hidden, never shown).
   */
  const homeDemoOnly = (allowed) => p.evaluate((allowed) => {
    if (!document.getElementById('qa-home-style')) { const st = document.createElement('style'); st.id = 'qa-home-style'; st.textContent = '[data-qa-home-row]:not([data-qa-keep]) { display: none !important }'; document.head.appendChild(st) }
    const board = document.querySelector('main')
    let kept = 0, hidden = 0
    for (const b of document.querySelectorAll('button[aria-label$="— işlemler"]')) {
      if (!b.getClientRects().length || board?.contains(b) || b.closest('[data-team-dnd]') || b.closest('[data-qa-demo]')) continue
      const name = b.getAttribute('aria-label').replace(/ — işlemler$/, '')
      let row = b.parentElement
      while (row && row.parentElement && row.getBoundingClientRect().width < 200) row = row.parentElement
      if (!row) continue
      row.setAttribute('data-qa-home-row', '1')
      if (allowed.includes(name)) { row.setAttribute('data-qa-keep', '1'); kept++ } else { row.removeAttribute('data-qa-keep'); hidden++ }
    }
    return `kept ${kept}, hidden ${hidden}`
  }, allowed)
  const homeOpen = async () => { await p.evaluate(() => { const b = document.querySelector('aside [data-shortcut="home"]'); if (b?.getAttribute('aria-pressed') !== 'true') b?.click() }); await sleep(2500) }
  const homeClean = (allowed) => p.evaluate((allowed) => [...document.querySelectorAll('[data-qa-home-row]')].filter((r) => r.getClientRects().length).every((r) => allowed.some((n) => r.textContent.includes(n))), allowed)
  return {
    async 'ana-sayfa'() {
      const d = await demo()
      await board(); await homeOpen()
      console.log('home rows:', await homeDemoOnly(d.allowed))
      await sleep(300)
      if (!(await homeClean(d.allowed))) { console.log('SKIP ana-sayfa: başka takımın satırı ekranda'); return }
      await cap('ana-sayfa', { x: 0, y: 0, width: 1000, height: 720 })
      await p.evaluate(() => document.querySelector('aside [data-shortcut="teams"]')?.click()); await sleep(1500)
    },
    async 'gorevlerim'() {
      const d = await demo()
      await open(p, '/me/tasks?view=all', 5000)
      await homeOpen()
      console.log('home rows:', await homeDemoOnly(d.allowed))
      console.log('task rows kept:', await p.evaluate((ids) => {
        const st = document.createElement('style'); st.textContent = 'tr[data-ticket-id]:not([data-qa-keep]) { display: none !important }'; document.head.appendChild(st)
        let n = 0
        for (const r of document.querySelectorAll('tr[data-ticket-id]')) if (ids.includes(r.getAttribute('data-ticket-id'))) { r.setAttribute('data-qa-keep', '1'); n++ }
        return n
      }, d.ids))
      await sleep(300)
      if (!(await homeClean(d.allowed))) { console.log('SKIP gorevlerim: başka takımın satırı ekranda'); return }
      await cap('gorevlerim', { x: 0, y: 0, width: 1000, height: 720 }, { expect: () => !!document.querySelector('[data-list-view]') })
      await p.evaluate(() => document.querySelector('aside [data-shortcut="teams"]')?.click()); await sleep(1000)
    },
    async 'calistirma-ayrintisi'() {
      const d = await demo()
      await viewport(1360, 1000)
      await open(p, `/me/agents?team=${d.team}`, 6000)
      await until(() => !!document.querySelector('[data-agent-run]'), null, 24)
      await sleep(1500)
      // a run that has steps, tools and rules: the trial job of the runner (its ticket is gone, the record stays)
      const at = await p.evaluate(() => { const rows = [...document.querySelectorAll('[data-agent-run]')].filter((r) => r.getClientRects().length); const pick = rows.find((r) => /QA TL-346/.test(r.innerText)) ?? rows[0]; pick?.scrollIntoView({ block: 'center' }); return pick ? pick.innerText.replace(/\s+/g, ' ').slice(0, 80) : null })
      console.log('run row:', at)
      await sleep(400)
      const pt = await p.evaluate(() => { const rows = [...document.querySelectorAll('[data-agent-run]')].filter((r) => r.getClientRects().length); const pick = rows.find((r) => /QA TL-346/.test(r.innerText)) ?? rows[0]; const cells = pick?.querySelectorAll('td'); const cell = cells && cells.length > 2 ? cells[2] : pick; const b = cell?.getBoundingClientRect(); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null })
      if (!pt) return
      await p.mouse.click(pt.x, pt.y)
      await until(() => !!document.querySelector('[data-run-session], [data-run-rules]'), null, 24)
      await sleep(1500)
      const box = await p.evaluate(() => { const inner = document.querySelector('[data-run-session], [data-run-rules]'); const d = inner?.closest('[role="dialog"]'); if (!d) return null; let card = d; if (card.getBoundingClientRect().width > innerWidth - 4) card = [...d.querySelectorAll('div')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 500 && r.width < innerWidth - 60 && r.height > 300 && e.contains(inner) }) ?? d; const r = card.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } })
      console.log('detail box:', JSON.stringify(box))
      if (box) await cap('calistirma-ayrintisi', box)
      const rules = await rectOf('[data-run-rules]', 10)
      console.log('rules box:', JSON.stringify(rules))
      if (rules) await cap('uyulan-kurallar', rules)
      await esc(2)
      await viewport(1360, 860)
    },
    async 'ajan-paneli'() {
      await viewport(1360, 1280)
      await open(p, `/me/agents?team=${(await demo()).team}`, 6000)
      await until(() => !!document.querySelector('[data-agent-panel]'), null, 24)
      await sleep(2500)
      await p.evaluate(() => { for (const s of ['[data-agent-runs]', '[data-agent-run-list]']) for (const e of document.querySelectorAll(s)) e.style.display = 'none' })
      const r = await around(['[data-agent-period]', '[data-agent-stat]', '[data-agent-card]', '[data-agent-models]'], 16)
      const top = await p.evaluate(() => { const h = [...document.querySelectorAll('[data-agent-panel] h1, [data-agent-panel] h2, main h1, main h2')].find((e) => e.getClientRects().length); return h ? Math.round(h.getBoundingClientRect().top) : null })
      console.log('heading top:', top, 'clip:', JSON.stringify(r))
      if (r) await cap('ajan-paneli', { ...r, y: Math.max(48, r.y - 90), height: r.height + r.y - Math.max(48, r.y - 90) }, { expect: () => !!document.querySelector('[data-agent-models]') })
      await viewport(1360, 860)
    },
    async 'uyulan-kurallar'() {
      await viewport(1360, 1000)
      await open(p, `/me/agents?team=${(await demo()).team}`, 6000)
      await until(() => !!document.querySelector('[data-agent-run]'), null, 24)
      await sleep(1500)
      const pt = await p.evaluate(() => { const rows = [...document.querySelectorAll('[data-agent-run]')].filter((r) => r.getClientRects().length); const pick = rows.find((r) => /QA TL-346/.test(r.innerText)) ?? rows[0]; pick?.scrollIntoView({ block: 'center' }); const cells = pick?.querySelectorAll('td'); const cell = cells && cells.length > 2 ? cells[2] : pick; const b = cell?.getBoundingClientRect(); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null })
      if (!pt) return
      await p.mouse.click(pt.x, pt.y)
      await until(() => !!document.querySelector('[data-run-rules]'), null, 24)
      await sleep(1200)
      await p.evaluate(() => document.querySelector('[data-run-rules]')?.scrollIntoView({ block: 'center' }))
      await sleep(700)
      await cap('uyulan-kurallar', await rectOf('[data-run-rules]', 10), { expect: () => !!document.querySelector('[data-run-rules]') })
      await esc(2)
      await viewport(1360, 860)
    },
    async 'yonetim'() {
      await open(p, '/admin', 6500)
      await cap('yonetim', null)
    },
  }
}
