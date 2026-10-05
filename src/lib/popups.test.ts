// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { openLayer, openLayerCount } from './popups'

/** A popup as the app has them: a trigger somewhere, a box somewhere else, and "open" as a flag. */
function popup(triggerParent: HTMLElement = document.body) {
  const trigger = document.createElement('button')
  const box = document.createElement('div')
  triggerParent.appendChild(trigger)
  document.body.appendChild(box) // a portal: not inside its trigger
  const p = { trigger, box, open: false, release: () => {}, show: () => {}, hide: () => {} }
  p.hide = () => { if (!p.open) return; p.open = false; p.release() }
  p.show = () => { p.open = true; p.release = openLayer({ el: () => box, anchor: () => trigger, close: p.hide }) }
  return p
}
/** A press where the element stops the event from going further, as the list's assignee wrapper does. */
function press(el: HTMLElement) {
  el.addEventListener('pointerdown', (e) => e.stopPropagation())
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }))
}

const made: ReturnType<typeof popup>[] = []
const make = (parent?: HTMLElement) => { const p = popup(parent); made.push(p); return p }
afterEach(() => { made.splice(0).forEach((p) => p.hide()); document.body.innerHTML = '' })

describe('one popup at a time', () => {
  it('opening a second one closes the first', () => {
    const a = make(), b = make()
    a.show(); b.show()
    expect([a.open, b.open]).toEqual([false, true])
    expect(openLayerCount()).toBe(1)
  })

  it('a press elsewhere closes it even when the pressed element stops the event', () => {
    const a = make()
    a.show()
    const other = document.createElement('button')
    document.body.appendChild(other)
    press(other)
    expect(a.open).toBe(false)
  })

  it('four triggers pressed one after the other leave one popup, not four (the recording)', () => {
    const rows = [make(), make(), make(), make()]
    for (const r of rows) { press(r.trigger); r.show() }
    expect(rows.map((r) => r.open)).toEqual([false, false, false, true])
  })

  it('a press inside the popup or on its own trigger keeps it', () => {
    const a = make()
    a.show()
    press(a.box)
    expect(a.open).toBe(true)
    press(a.trigger) // the trigger's own click handler decides (it toggles)
    expect(a.open).toBe(true)
  })
})

describe('a popup opened from inside another', () => {
  it('is its child: both stay open, and a press in the child keeps the parent', () => {
    const outer = make()
    outer.show()
    const inner = make(outer.box) // the trigger sits inside the outer popup
    inner.show()
    expect([outer.open, inner.open]).toEqual([true, true])
    press(inner.box)
    expect([outer.open, inner.open]).toEqual([true, true])
  })

  it('a press in the parent closes the child only; a press outside closes both', () => {
    const outer = make()
    outer.show()
    const inner = make(outer.box)
    inner.show()
    const inOuter = document.createElement('span')
    outer.box.appendChild(inOuter)
    press(inOuter)
    expect([outer.open, inner.open]).toEqual([true, false])
    inner.show()
    press(document.body)
    expect([outer.open, inner.open]).toEqual([false, false])
  })

  it('an unrelated popup still closes the pair', () => {
    const outer = make()
    outer.show()
    const inner = make(outer.box)
    inner.show()
    const other = make()
    other.show()
    expect([outer.open, inner.open, other.open]).toEqual([false, false, true])
  })
})
