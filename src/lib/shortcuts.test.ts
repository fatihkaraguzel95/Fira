import { describe, expect, it } from 'vitest'
import { SHORTCUTS, comboFromEvent, comboParts, defaultBindings } from './shortcuts'

/** A key event as the matcher reads it. */
const ev = (key: string, code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) =>
  ({ key, code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta }) as KeyboardEvent

describe('kısayol eşleştirme', () => {
  it('rakam fiziksel tuştan okunur: Ctrl+Shift+1 her düzende aynı', () => {
    expect(comboFromEvent(ev('!', 'Digit1', { ctrl: true, shift: true }))).toBe('ctrl+shift+1')
    expect(comboFromEvent(ev('1', 'Digit1', { ctrl: true, shift: true }))).toBe('ctrl+shift+1')
  })

  it('Alt+Shift+harf; Mac Option harfi simgeye çevirse de harf okunur', () => {
    expect(comboFromEvent(ev('N', 'KeyN', { alt: true, shift: true }))).toBe('alt+shift+n')
    expect(comboFromEvent(ev('˜', 'KeyN', { alt: true, shift: true }))).toBe('alt+shift+n')
  })

  it('adlandırılmış tuşlar küçük harfle, Shift dahil', () => {
    expect(comboFromEvent(ev('ArrowDown', 'ArrowDown', { alt: true, shift: true }))).toBe('alt+shift+arrowdown')
    expect(comboFromEvent(ev('Enter', 'Enter', { alt: true, shift: true }))).toBe('alt+shift+enter')
    expect(comboFromEvent(ev('F1', 'F1'))).toBe('f1')
  })

  it('sembolde Shift ayrıca yazılmaz; yalnız değiştirici basışı sayılmaz', () => {
    expect(comboFromEvent(ev('?', 'Minus', { shift: true }))).toBe('?') // Türkçe Q: Shift + -
    expect(comboFromEvent(ev('/', 'Digit7', { shift: true }))).toBe('/') // Türkçe Q: Shift + 7, değiştiricisiz
    expect(comboFromEvent(ev('.', 'Period', { ctrl: true }))).toBe('ctrl+.')
    expect(comboFromEvent(ev('Shift', 'ShiftLeft', { shift: true }))).toBeNull()
  })

  it('görünen adlar', () => {
    expect(comboParts('alt+shift+arrowdown')).toEqual(['Alt', 'Shift', '↓'])
    expect(comboParts('f1')).toEqual(['F1'])
    expect(comboParts('')).toEqual([])
  })
})

describe('varsayılanlar', () => {
  const combos = Object.values(defaultBindings()).filter(Boolean)
  it('iki eylem aynı tuşu paylaşmaz', () => {
    expect(new Set(combos).size).toBe(combos.length)
  })
  it('bir şey yaratan ya da değiştiren eylem tek tuşa bağlı değil', () => {
    const changing = ['new-ticket', 'new-page', 'ticket-done', 'ticket-next', 'favorite', 'theme-toggle']
    for (const s of SHORTCUTS.filter((x) => changing.includes(x.id))) expect(s.keys).toMatch(/\+/)
  })
  it('Ctrl+Alt (Windows\'ta AltGr) ve F1 varsayılanlarda yok', () => {
    for (const c of combos) {
      expect(c).not.toMatch(/ctrl\+alt|alt\+ctrl/)
      expect(c).not.toBe('f1')
    }
  })
})
