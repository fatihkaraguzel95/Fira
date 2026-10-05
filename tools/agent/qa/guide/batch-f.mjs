// Batch F: the inbox (the drawer with a notification's detail, and with the release row's).
export default (c) => {
  const { p, sleep, until, esc, rectOf, around, clickText, noField, viewport, cap, board, open, rest, LIST, teamsOpen, clean, onlyDemoTeam, hide } = c
  const demo = async () => {
    const team = (await rest(`/projects?id=eq.${LIST}&select=team_id`))[0]?.team_id
    const lists = await rest(`/projects?team_id=eq.${team}&select=id,name`)
    const tickets = await rest(`/tickets?project_id=in.(${lists.map((l) => l.id).join(',')})&select=id`)
    return { team, names: lists.map((l) => l.name), ids: tickets.map((t) => t.id) }
  }
  /**
   * Inbox rows that are not the demo team's (nor the release row) stay out of the picture. The list
   * redraws itself (more pages load, the unread count ticks), and a row hidden by hand comes back:
   * so every row is hidden by a style rule unless it carries a mark, and only the demo team's rows
   * are marked. A redrawn row has no mark and is hidden: the picture can lose a row, never gain one.
   */
  const inboxDemoOnly = (names) => p.evaluate((names) => {
    if (!document.getElementById('qa-inbox-style')) {
      const st = document.createElement('style')
      st.id = 'qa-inbox-style'
      st.textContent = '[data-inbox-row]:not([data-qa-keep]) { display: none !important }'
      document.head.appendChild(st)
    }
    const rows = [...document.querySelectorAll('[data-inbox-row]')]
    let kept = 0
    for (const r of rows) { const keep = /Fira güncellendi/.test(r.textContent) || names.some((n) => r.textContent.includes(n)); if (keep) { r.setAttribute('data-qa-keep', '1'); kept++ } else r.removeAttribute('data-qa-keep') }
    return `${kept}/${rows.length}`
  }, names)
  /** True when every inbox row on screen is the demo team's or the release row. */
  const inboxClean = (names) => p.evaluate((names) => [...document.querySelectorAll('[data-inbox-row]')].filter((r) => r.getClientRects().length).every((r) => /Fira güncellendi/.test(r.textContent) || names.some((n) => r.textContent.includes(n))), names)
  const inbox = async () => {
    const d = await demo()
    await board(); await noField()
    await p.keyboard.press('Control+Shift+Digit1')
    await until(() => document.querySelectorAll('[data-inbox-row]').length > 0, null, 24)
    await sleep(1500)
    console.log('inbox rows kept:', await inboxDemoOnly(d.names))
    return d
  }
  /** The drawer and, beside it, the detail whose heading matches. */
  const inboxClip = (heading) => p.evaluate((heading) => {
    const row = [...document.querySelectorAll('[data-inbox-row]')].find((r) => r.getClientRects().length)
    let drawer = row
    while (drawer.parentElement && drawer.parentElement.getBoundingClientRect().height < innerHeight - 60) drawer = drawer.parentElement
    drawer = drawer.parentElement ?? drawer
    const r = drawer.getBoundingClientRect()
    const h = [...document.querySelectorAll('h2, h3, p, span, div')].find((e) => e.childElementCount === 0 && e.getClientRects().length && typeof e.innerText === 'string' && e.innerText.trim() === heading && e.getBoundingClientRect().left >= r.right - 4)
    let detail = h
    while (detail && detail.parentElement && detail.getBoundingClientRect().height < innerHeight - 140) detail = detail.parentElement
    const right = detail ? detail.getBoundingClientRect().right : r.right
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(right - r.left), height: Math.round(r.height), detail: !!detail }
  }, heading)
  return {
    async 'gelen-kutusu'() {
      const d = await inbox()
      const at = await p.evaluate(() => { const r = [...document.querySelectorAll('[data-inbox-row]')].find((x) => x.getClientRects().length && /Ana sayfa tasarımı/.test(x.innerText)); const b = r?.getBoundingClientRect(); return b ? { x: b.x + 120, y: b.y + 18, text: r.innerText.replace(/\s+/g, ' ').slice(0, 120) } : null })
      console.log('demo row:', JSON.stringify(at))
      if (!at) { await esc(2); return }
      await p.mouse.click(at.x, at.y); await sleep(2500)
      console.log('rows kept after the click:', await inboxDemoOnly(d.names))
      const clip = await inboxClip('Ne değişti')
      console.log('clip:', JSON.stringify(clip))
      await inboxDemoOnly(d.names)
      // day headings that are left without a row
      await p.evaluate(() => { for (const e of document.querySelectorAll('div, p, h3, span')) if (e.childElementCount === 0 && typeof e.innerText === 'string' && /^(DÜN|BU HAFTA|BU AY|DAHA ESKİ|Daha fazla yükle)$/.test(e.innerText.trim())) (e.innerText.trim() === 'Daha fazla yükle' ? e : (e.parentElement.childElementCount === 1 ? e.parentElement : e)).style.display = 'none' })
      if (!(await inboxClean(d.names))) { console.log('SKIP gelen-kutusu: başka takımın satırı ekranda'); await esc(2); return }
      await cap('gelen-kutusu', { x: clip.x, y: clip.y, width: clip.width, height: clip.height })
      console.log('clean after the capture:', await inboxClean(d.names))
      await esc(2)
    },
    async 'gelen-kutusu-surum'() {
      const d = await inbox()
      const at = await p.evaluate(() => { const r = [...document.querySelectorAll('[data-inbox-row]')].find((x) => x.getClientRects().length && /Fira güncellendi/.test(x.innerText)); const b = r?.getBoundingClientRect(); return b ? { x: b.x + 120, y: b.y + 18 } : null })
      if (!at) { console.log('no release row'); await esc(2); return }
      await p.mouse.click(at.x, at.y); await sleep(3000)
      console.log('rows kept after the click:', await inboxDemoOnly(d.names))
      const clip = await inboxClip('Yenilikler')
      console.log('clip:', JSON.stringify(clip))
      await inboxDemoOnly(d.names)
      // day headings that are left without a row
      await p.evaluate(() => { for (const e of document.querySelectorAll('div, p, h3, span')) if (e.childElementCount === 0 && typeof e.innerText === 'string' && /^(DÜN|BU HAFTA|BU AY|DAHA ESKİ|Daha fazla yükle)$/.test(e.innerText.trim())) (e.innerText.trim() === 'Daha fazla yükle' ? e : (e.parentElement.childElementCount === 1 ? e.parentElement : e)).style.display = 'none' })
      if (!(await inboxClean(d.names))) { console.log('SKIP gelen-kutusu-surum: başka takımın satırı ekranda'); await esc(2); return }
      await cap('gelen-kutusu-surum', { x: clip.x, y: clip.y, width: clip.width, height: clip.height })
      console.log('clean after the capture:', await inboxClean(d.names))
      await esc(2)
    },
  }
}
