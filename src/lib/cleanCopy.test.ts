// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanRangeHtml } from './cleanCopy'

const mount = (html: string) => {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}
const all = (el: Node) => { const r = document.createRange(); r.selectNodeContents(el); return r }
afterEach(() => { document.body.innerHTML = '' })

describe('cleanRangeHtml', () => {
  it('keeps the structure and drops styles, classes and data attributes', () => {
    const host = mount('<p class="x" style="background-color: rgb(31, 41, 55); color: white" data-a="1">Bir <strong style="font-weight:700">kalın</strong> ve <em>eğik</em> söz</p>')
    expect(cleanRangeHtml(all(host))).toBe('<p>Bir <strong>kalın</strong> ve <em>eğik</em> söz</p>')
  })

  it('dissolves inline wrappers and keeps block ones as plain divs', () => {
    const host = mount('<div class="card" style="display:block"><span class="hljs-keyword" style="display:inline">const</span><span style="display:inline"> x</span></div>')
    expect(cleanRangeHtml(all(host))).toBe('<div>const x</div>')
  })

  it('leaves out interface chrome: icons, hidden and unselectable parts', () => {
    const host = mount('<div style="display:block"><div class="bar" style="user-select:none">js · Kopyala</div><svg><path d="M0 0"/></svg><span style="display:none">gizli</span><pre><code>const x = 1</code></pre></div>')
    expect(cleanRangeHtml(all(host))).toBe('<div><pre><code>const x = 1</code></pre></div>')
  })

  it('keeps links (absolute or Fira\'s own scheme), images and table shape', () => {
    const host = mount('<p><a href="https://example.com/a" target="_blank" rel="noopener" class="l">bağlantı</a> <a href="fira://u/abc" class="mention">@Ada</a></p><table class="t"><tbody><tr><td colspan="2" style="background:#eee">bir</td><td></td></tr></tbody></table>')
    expect(cleanRangeHtml(all(host))).toBe('<p><a href="https://example.com/a">bağlantı</a> <a href="fira://u/abc">@Ada</a></p><table><tbody><tr><td colspan="2">bir</td><td></td></tr></tbody></table>')
  })

  it('keeps a task list\'s boxes with their state and no other input', () => {
    const host = mount('<ul><li><input type="checkbox" checked readonly> bitti</li><li><input type="text" value="x"> yazı</li></ul>')
    expect(cleanRangeHtml(all(host))).toBe('<ul><li><input type="checkbox" checked="" disabled=""> bitti</li><li> yazı</li></ul>')
  })

  it('copies only the selected part of a text', () => {
    const host = mount('<p>Merhaba dünya</p>')
    const text = host.querySelector('p')!.firstChild!
    const r = document.createRange(); r.setStart(text, 8); r.setEnd(text, 13)
    expect(cleanRangeHtml(r)).toBe('dünya')
  })

  it('keeps the formatting a partial selection stands in', () => {
    const host = mount('<p>Bir <a href="https://example.com/"><strong>kalın bağlantı</strong></a></p>')
    const text = host.querySelector('strong')!.firstChild!
    const r = document.createRange(); r.setStart(text, 0); r.setEnd(text, 5)
    expect(cleanRangeHtml(r)).toBe('<a href="https://example.com/"><strong>kalın</strong></a>')
  })

  it('gives list items their list and cells their table back', () => {
    const list = mount('<ul class="a"><li>bir</li><li>iki</li><li>üç</li></ul>')
    const items = list.querySelectorAll('li')
    const r = document.createRange(); r.setStart(items[1].firstChild!, 0); r.setEnd(items[2].firstChild!, 2)
    expect(cleanRangeHtml(r)).toBe('<ul><li>iki</li><li>üç</li></ul>')

    const table = mount('<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>')
    const cells = table.querySelectorAll('td')
    const c = document.createRange(); c.setStart(cells[0].firstChild!, 0); c.setEnd(cells[1].firstChild!, 1)
    expect(cleanRangeHtml(c)).toBe('<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>')
  })

  it('answers nothing for an empty selection', () => {
    const host = mount('<p>metin</p>')
    const r = document.createRange(); r.setStart(host.querySelector('p')!.firstChild!, 2); r.collapse(true)
    expect(cleanRangeHtml(r)).toBe('')
  })
})
