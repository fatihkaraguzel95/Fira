import { describe, expect, it } from 'vitest'
import { readPopupKeepOpen, readTicketView } from './ticketView'

describe('ticket window prefs', () => {
  it('defaults: full screen, and a popup closes on an outside click', () => {
    expect(readTicketView({})).toBe('fullscreen')
    expect(readTicketView(null)).toBe('fullscreen')
    expect(readPopupKeepOpen({})).toBe(false)
    expect(readPopupKeepOpen(null)).toBe(false)
  })
  it('keeps the popup open on an outside click only when the user turned it on (#3a5b8d93)', () => {
    expect(readTicketView({ ticketView: 'popup' })).toBe('popup')
    expect(readPopupKeepOpen({ ticketPopupKeepOpen: true })).toBe(true)
    expect(readPopupKeepOpen({ ticketPopupKeepOpen: 'yes' })).toBe(false)
  })
})
