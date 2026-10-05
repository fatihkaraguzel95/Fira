import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: { from: () => ({ select: () => ({ order: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: null }) }) }) }) }) } }))

import { AVATAR_TONES, avatarColor, hashTone, setAvatarOrder, tonesInOrder } from './avatarTone'

const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

/** WCAG contrast of white text on a tone. */
function contrastWithWhite(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05)
}

describe('the tones', () => {
  it('are twelve different colours, each readable with white initials (AA)', () => {
    expect(new Set(AVATAR_TONES).size).toBe(12)
    for (const tone of AVATAR_TONES) expect(contrastWithWhite(tone)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('handing the tones out in order', () => {
  it('gives every one of up to twelve people a different tone', () => {
    const people = Array.from({ length: 12 }, (_, i) => id(i))
    const tones = tonesInOrder(people)
    expect(new Set(tones.values()).size).toBe(12)
  })

  it('a new colleague takes the next tone and nobody else changes', () => {
    const before = tonesInOrder([id(1), id(2), id(3)])
    const after = tonesInOrder([id(1), id(2), id(3), id(4)])
    for (const [k, v] of before) expect(after.get(k)).toBe(v)
    expect(after.get(id(4))).toBe(3)
  })

  it('goes round again after twelve', () => {
    const tones = tonesInOrder(Array.from({ length: 14 }, (_, i) => id(i)))
    expect(tones.get(id(12))).toBe(0)
    expect(tones.get(id(13))).toBe(1)
  })
})

describe('the colour of a person', () => {
  it('follows the order once it is known, and a hash of the id before that', () => {
    const a = id(7), b = id(8)
    expect(avatarColor(a)).toBe(AVATAR_TONES[hashTone(a)])
    setAvatarOrder([a, b])
    expect(avatarColor(a)).toBe(AVATAR_TONES[0])
    expect(avatarColor(b)).toBe(AVATAR_TONES[1])
    // someone outside the order (a name without an id) still gets a colour, always the same one
    expect(avatarColor('Biri')).toBe(avatarColor('Biri'))
    expect(AVATAR_TONES).toContain(avatarColor(null))
  })
})
