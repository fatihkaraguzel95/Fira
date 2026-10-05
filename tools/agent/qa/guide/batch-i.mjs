// Batch I: the "attach a file" question of the editor. The question comes before any upload; it is cancelled.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export default (c) => {
  const { p, sleep, until, esc, cap, ticket, noField, waitFocus } = c
  const EDITOR = '[data-ticket-window] [data-tour="ticket-description"] .ProseMirror'
  return {
    async 'dosya-ekle'() {
      if (!(await ticket('Hız ölçümü ve iyileştirme'))) return
      const file = path.join(os.tmpdir(), 'olcum-raporu.pdf')
      fs.writeFileSync(file, '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n' + ' '.repeat(2800))
      const at = await p.evaluate((E) => { const ps = document.querySelectorAll(`${E} > p`); const first = ps[0]; const r = first?.getBoundingClientRect(); return r ? { x: r.x + r.width - 8, y: r.y + r.height / 2 } : null }, EDITOR)
      if (!at) { console.log('no paragraph in the editor'); return }
      await p.mouse.click(at.x, at.y); await sleep(500)
      if (!(await waitFocus(p, EDITOR))) { console.log('editor has no focus'); return }
      const inputs = await p.evaluate(() => [...document.querySelectorAll('[data-ticket-window] [data-tour="ticket-description"] input[type="file"]')].map((i) => `${i.accept || '*'}${i.multiple ? ' multiple' : ''}`))
      console.log('file inputs:', JSON.stringify(inputs))
      const input = p.locator('[data-ticket-window] [data-tour="ticket-description"] input[type="file"]').last()
      await input.setInputFiles(file)
      const asked = await until(() => !!document.getElementById('fira-file-link-text'), null, 20)
      console.log('question shown:', asked)
      await sleep(600)
      if (asked) {
        const col = await p.evaluate(() => { const a = document.querySelector('[data-tour="ticket-activity"]')?.getBoundingClientRect(); return { x: 0, y: 48, width: Math.round(a ? a.left : innerWidth), height: innerHeight - 48 } })
        await cap('dosya-ekle', col, { pointer: true })
      }
      await esc()
      await sleep(400)
      console.log('question closed:', await p.evaluate(() => !document.getElementById('fira-file-link-text')), '· uploads in flight:', await p.evaluate(() => document.querySelectorAll('[data-ticket-window] [data-upload], [data-ticket-window] progress').length))
      await noField()
      fs.rmSync(file, { force: true })
    },
  }
}
