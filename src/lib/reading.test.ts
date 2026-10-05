import { describe, expect, it } from 'vitest'
import { NO_READING, langName, normalizeReading, sha256Hex, toggleReadLang, translationFor, type TranslationRow } from './reading'

describe('normalizeReading', () => {
  it('keeps a well-formed preference, lower-cased and without repeats', () => {
    expect(normalizeReading({ read: ['TR', 'en', 'tr'], to: 'TR' })).toEqual({ read: ['tr', 'en'], to: 'tr' })
  })
  it('the target is always one of the languages read', () => {
    expect(normalizeReading({ read: ['en'], to: 'de' })).toEqual({ read: ['de', 'en'], to: 'de' })
  })
  it('anything else is "no preference"', () => {
    for (const raw of [undefined, null, 'tr', [], {}, { read: [], to: 'tr' }, { read: ['tr'] }, { read: 'tr', to: 'tr' }, { read: ['türkçe'], to: 'tr' }, { read: ['tr'], to: 'türkçe' }]) {
      expect(normalizeReading(raw)).toEqual(NO_READING)
    }
  })
})

describe('toggleReadLang', () => {
  it('the first language ticked becomes the target', () => {
    expect(toggleReadLang(NO_READING, 'de', 'tr')).toEqual({ read: ['de'], to: 'de' })
  })
  it('adding a language keeps the target', () => {
    expect(toggleReadLang({ read: ['tr'], to: 'tr' }, 'en', 'tr')).toEqual({ read: ['tr', 'en'], to: 'tr' })
  })
  it('unticking the target moves it: to the language of the screen when it is read, else to the first left', () => {
    expect(toggleReadLang({ read: ['de', 'en', 'tr'], to: 'de' }, 'de', 'tr')).toEqual({ read: ['en', 'tr'], to: 'tr' })
    expect(toggleReadLang({ read: ['de', 'en'], to: 'de' }, 'de', 'tr')).toEqual({ read: ['en'], to: 'en' })
  })
  it('unticking the last language turns translation off', () => {
    expect(toggleReadLang({ read: ['tr'], to: 'tr' }, 'tr', 'tr')).toEqual(NO_READING)
  })
})

describe('translationFor', () => {
  const reading = { read: ['tr', 'en'], to: 'tr' }
  const row: TranslationRow = { comment_id: 'c1', source_hash: 'h1', source_lang: 'de', status: 'done', text: 'Lütfen kontrol edin.' }
  it('shows a finished translation made for exactly this text, from a language the reader does not read', () => {
    expect(translationFor(row, 'h1', reading)).toBe('Lütfen kontrol edin.')
  })
  it('a translation made for an older text is not shown', () => {
    expect(translationFor(row, 'h2', reading)).toBeNull()
  })
  it('nothing is shown while the hash is not known yet', () => {
    expect(translationFor(row, null, reading)).toBeNull()
  })
  it('a text in a language the reader reads is shown as it is, also when somebody else needed the translation', () => {
    expect(translationFor({ ...row, source_lang: 'en' }, 'h1', reading)).toBeNull()
  })
  it('a text whose language could not be told is translated', () => {
    expect(translationFor({ ...row, source_lang: null }, 'h1', reading)).toBe('Lütfen kontrol edin.')
  })
  it('rows that are not translations are not shown', () => {
    for (const status of ['processing', 'none', 'failed', 'skipped']) expect(translationFor({ ...row, status }, 'h1', reading)).toBeNull()
    expect(translationFor({ ...row, text: null }, 'h1', reading)).toBeNull()
    expect(translationFor(undefined, 'h1', reading)).toBeNull()
  })
  it('a reader without a preference sees no translation', () => {
    expect(translationFor(row, 'h1', NO_READING)).toBeNull()
  })
})

describe('sha256Hex', () => {
  // The same two values are in scripts/sql/translate-tests.sql (3i): the server and the screen must hash alike.
  it('is the hash the server stores', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex('Günaydın, ⟦1⟧ hazır mı?\n- [x] evet')).toBe('6c77b1464df6e52b64786431582ba647b5bf50943c52ff8e1d4e0b566ed20682')
  })
})

describe('langName', () => {
  it('names a language in the language of the screen', () => {
    expect(langName('en', 'tr')).toBe('İngilizce')
    expect(langName('de', 'en')).toBe('German')
    expect(langName(null, 'tr')).toBe('')
  })
})
