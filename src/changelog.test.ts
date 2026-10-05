import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CHANGELOG } from './changelog'
import { APP_VERSION } from './version'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

describe('release version', () => {
  it('the newest release note, package.json and APP_VERSION agree', () => {
    expect(CHANGELOG[0].version).toBe(pkg.version)
    expect(APP_VERSION).toBe(pkg.version)
  })

  it('releases are newest first and versions are unique', () => {
    const versions = CHANGELOG.map((r) => r.version)
    expect(new Set(versions).size).toBe(versions.length)
    const num = (v: string) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0)
    for (let i = 1; i < versions.length; i++) expect(num(versions[i - 1])).toBeGreaterThan(num(versions[i]))
  })
})
