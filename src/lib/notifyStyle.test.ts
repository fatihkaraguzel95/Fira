import { describe, expect, it } from 'vitest'
import { initialsOf, notificationIconSize, statusDot } from './notifyStyle'

describe('statusDot', () => {
  it('picks the dot nearest to the status colour', () => {
    expect(statusDot('#3b82f6')).toBe('🔵')   // blue-500: "Devam Ediyor"
    expect(statusDot('#22c55e')).toBe('🟢')
    expect(statusDot('#ef4444')).toBe('🔴')
    expect(statusDot('#f59e0b')).toBe('🟠')   // amber sits closer to orange than to yellow
    expect(statusDot('#eab308')).toBe('🟡')
    expect(statusDot('#8b5cf6')).toBe('🟣')
    expect(statusDot('#92400e')).toBe('🟤')   // a dark orange reads as brown
  })

  it('sends greys by lightness, they have no hue', () => {
    expect(statusDot('#6b7280')).toBe('⚫')
    expect(statusDot('#e5e7eb')).toBe('⚪')
    expect(statusDot('#000000')).toBe('⚫')
  })

  it('accepts the colour without a hash and in capitals', () => {
    expect(statusDot('3B82F6')).toBe('🔵')
  })

  it('gives nothing when there is no usable colour', () => {
    expect(statusDot(null)).toBe('')
    expect(statusDot('')).toBe('')
    expect(statusDot('blue')).toBe('')
    expect(statusDot('#fff')).toBe('')
  })
})

describe('avatar look', () => {
  it('builds initials like the avatar circle', () => {
    expect(initialsOf('Ali İlker Claude')).toBe('Aİ')
    expect(initialsOf('halil')).toBe('H')
    expect(initialsOf('')).toBe('?')
  })

})

describe('the size the notification icon is drawn at', () => {
  const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

  it('is the size Windows shows it at: 48 px times the display scale', () => {
    expect(notificationIconSize(WIN, 1)).toBe(48)
    expect(notificationIconSize(WIN, 1.25)).toBe(60)
    expect(notificationIconSize(WIN, 1.5)).toBe(72)
    expect(notificationIconSize(WIN, 2)).toBe(96)
  })

  it('a zoomed page does not throw it off: the ratio snaps to a display scale', () => {
    expect(notificationIconSize(WIN, 1.1)).toBe(48)    // 110 % zoom on a 100 % display
    expect(notificationIconSize(WIN, 0.9)).toBe(48)
    expect(notificationIconSize(WIN, 1.65)).toBe(84)   // 110 % zoom on a 150 % display: the nearest scale (175 %)
    expect(notificationIconSize(WIN, NaN)).toBe(48)
    expect(notificationIconSize(WIN, 0)).toBe(48)
  })

  it('stays large where the system smooths the picture itself', () => {
    expect(notificationIconSize(MAC, 2)).toBe(192)
    expect(notificationIconSize('', 1)).toBe(192)
  })
})
