import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * A class of a colour step the config does not define is not an error: Tailwind writes no rule for
 * it and the element keeps whatever colour it had. `primary-400` and `primary-800` were used in
 * some ninety places and defined nowhere until 0.96.1 (#4172876d): in the dark theme every link
 * written `text-primary-600 dark:text-primary-400` stayed at 600, about 2.6:1 on the dark surface,
 * and focus borders written `border-primary-400` were never drawn. This keeps the code and the
 * scale in step.
 */
const SRC = path.resolve(__dirname, '..')
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return /\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
  })
}
/** The steps of `primary` as the config writes them (the block is read as text: the config is plain JS without types). */
function definedSteps(): Set<string> {
  const config = fs.readFileSync(path.resolve(SRC, '..', 'tailwind.config.js'), 'utf8')
  const block = config.match(/primary:\s*\{([^}]*)\}/)?.[1] ?? ''
  return new Set([...block.matchAll(/(\d{2,3}):\s*'#/g)].map((m) => m[1]))
}

describe('the brand scale', () => {
  it('is read from the config', () => {
    expect(definedSteps().has('600')).toBe(true)
  })
  it('defines every step the code names', () => {
    const defined = definedSteps()
    const missing = new Map<string, string>()
    for (const file of sources(SRC)) {
      const text = fs.readFileSync(file, 'utf8')
      // a utility of the scale: text-primary-400, dark:hover:bg-primary-500/10, ring-primary-400/70 …
      for (const m of text.matchAll(/\b(?:text|bg|border|ring|outline|fill|stroke|from|via|to|divide|decoration|accent|caret|shadow|placeholder)-primary-(\d{2,3})\b/g)) {
        if (!defined.has(m[1]) && !missing.has(m[1])) missing.set(m[1], path.relative(SRC, file).replace(/\\/g, '/'))
      }
    }
    expect([...missing].map(([step, file]) => `primary-${step} (first in ${file})`)).toEqual([])
  })
})
