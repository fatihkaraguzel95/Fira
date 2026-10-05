import { describe, expect, it } from 'vitest'
import { buildTourSteps } from './tour'
import { CHANGELOG } from '../changelog'

describe('tour chapters (#ab88c8f5)', () => {
  it('app chapter: onboarding, then the newest release that has features', async () => {
    const steps = await buildTourSteps('app')
    expect(steps[0].id).toBe('welcome')
    expect(steps.some((s) => s.target?.includes('ticket-'))).toBe(false)
    const withFeatures = CHANGELOG.find((r) => r.features.length > 0)!
    const whatsNew = steps.filter((s) => s.kind === 'whatsnew')
    expect(whatsNew[0].vars?.version).toBe(withFeatures.version)
    expect(whatsNew.length).toBe(withFeatures.features.length + 1)
  })

  it('ticket chapter: steps anchored in the ticket window, optional ones marked', async () => {
    const steps = await buildTourSteps('ticket')
    expect(steps.map((s) => s.id)).toEqual(['t-title', 't-header', 't-props', 't-ai', 't-desc', 't-sections', 't-activity', 't-keys'])
    for (const s of steps) if (s.target) expect(s.target).toMatch(/^\[data-tour="ticket-/)
    expect(steps.filter((s) => s.optional).map((s) => s.id)).toEqual(['t-ai', 't-sections'])
    expect(steps.every((s) => s.titleKey && s.bodyKey)).toBe(true)
  })
})
