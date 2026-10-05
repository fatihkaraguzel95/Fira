import { describe, expect, it } from 'vitest'
import { itemText, popupText } from './notifyText'

// The dictionaries load Turkish first; these are the sentences a Turkish reader gets.
describe('itemText', () => {
  it('writes a status with a dot in its own colour', () => {
    expect(itemText({ event: 'status', value: 'Devam Ediyor', color: '#3b82f6' })).toBe('durumu 🔵 Devam Ediyor yaptı')
  })

  it('leaves the dot out when the colour is unknown', () => {
    expect(itemText({ event: 'status', value: 'Devam Ediyor', color: null })).toBe('durumu Devam Ediyor yaptı')
  })

  it('keeps the other events as their plain verb', () => {
    expect(itemText({ event: 'assigned', value: '' })).toBe('seni atadı')
    expect(itemText({ event: 'comment', value: 'Bakar mısın?' })).toBe('yorum yazdı: “Bakar mısın?”')
  })
})

describe('popupText', () => {
  const status = { event: 'status' as const, value: 'İncelemede', color: '#f59e0b' }

  it('puts the person in the title and the task on its own line', () => {
    expect(popupText('Ali İlker Claude', true, [status], 'Bildirim stili')).toEqual({
      title: 'Ali İlker Claude',
      body: 'durumu 🟠 İncelemede yaptı\nBildirim stili',
    })
  })

  it('counts several changes of one person in the title', () => {
    const out = popupText('Halil', true, [{ event: 'assigned', value: '' }, status], 'Görev')
    expect(out.title).toBe('Halil · 2 değişiklik')
    expect(out.body).toBe('seni atadı; durumu 🟠 İncelemede yaptı\nGörev')
  })

  it('names the kind of news when nobody caused it, and keeps a subject in the sentence', () => {
    expect(popupText('Biri', false, [status], 'Görev')).toEqual({ title: 'Durum değişti', body: 'Biri durumu 🟠 İncelemede yaptı\nGörev' })
  })

  it('gives a reminder no subject', () => {
    expect(popupText('Biri', false, [{ event: 'reminder', value: 'yarın 10:00' }], 'Görev')).toEqual({
      title: 'Hatırlatma',
      body: 'Son tarih yaklaşıyor: yarın 10:00\nGörev',
    })
  })

  it('does not leave an empty line when the task has no title', () => {
    expect(popupText('Halil', true, [status], '').body).toBe('durumu 🟠 İncelemede yaptı')
  })
})
