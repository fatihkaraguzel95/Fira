import { beforeEach, describe, expect, it } from 'vitest'
import { BOARD, decide, isAncestor, noteParent, pagePath, resetNav, ticketPath, track, previousPath, type Move } from './nav'

// The ticket's own example (#a7d43aaf): A has subtasks B and C; C has a sub-page D.
const A = ticketPath('a'), B = ticketPath('b'), C = ticketPath('c'), D = pagePath('d')

/** Apply a move to a history the way the browser would. */
function apply(stack: string[], target: string): string[] {
  const m: Move = decide(stack, target, isAncestor)
  if (m.kind === 'stay') return stack
  if (m.kind === 'back') return stack.slice(0, stack.length - m.steps)
  if (m.kind === 'replace') return [...stack.slice(0, stack.length - m.back - 1), target]
  return [...stack, target]
}
const walk = (start: string[], ...targets: string[]) => targets.reduce(apply, start)

beforeEach(() => {
  resetNav()
  noteParent(A, null)
  noteParent(B, A)
  noteParent(C, A)
  noteParent(D, C)
})

describe('more general / more specific', () => {
  it('follows the chain up to the board', () => {
    expect(isAncestor(A, B)).toBe(true)
    expect(isAncestor(A, D)).toBe(true)
    expect(isAncestor(BOARD, D)).toBe(true)
    expect(isAncestor(B, A)).toBe(false)
    expect(isAncestor(B, C)).toBe(false) // siblings
    expect(isAncestor('/me/tasks', A)).toBe(false)
  })
})

describe('the three examples of the request', () => {
  it('1 — a page opened from a notification: back is the screen before it', () => {
    // The inbox is a drawer, not an entry: X is what was on screen.
    expect(walk(['/me/tasks'], D)).toEqual(['/me/tasks', D])
  })

  it('2 — a task opened from the board: back is the board', () => {
    expect(walk([BOARD], B)).toEqual([BOARD, B])
  })

  it('3 — A, its subtask B, up to A again, then C: back is A, then the board, never B', () => {
    expect(walk([BOARD], A, B)).toEqual([BOARD, A, B])
    expect(walk([BOARD], A, B, A)).toEqual([BOARD, A])
    expect(walk([BOARD], A, B, A, C)).toEqual([BOARD, A, C])
  })
})

describe('going to something more general that is not in the history', () => {
  it('takes the place of the current entry', () => {
    // D opened directly, then up to its task C: back must not return to D.
    expect(walk(['/me/tasks'], D, C)).toEqual(['/me/tasks', C])
    expect(walk(['/me/tasks'], D, C, A)).toEqual(['/me/tasks', A])
  })

  it('drops every more specific entry above it, not only the current one', () => {
    // B opened from Görevlerim, then a link to its sibling's page D, then up to A:
    // B and D are both below A, so neither may be "behind" it.
    expect(walk(['/me/tasks'], C, D, A)).toEqual(['/me/tasks', A])
  })

  it('keeps entries that are not below the target', () => {
    expect(walk(['/me/tasks', '/me/recents'], D, BOARD)).toEqual(['/me/tasks', '/me/recents', BOARD])
  })
})

describe('everything else adds an entry', () => {
  it('a sibling or an unrelated task is forward', () => {
    expect(walk([BOARD], B, C)).toEqual([BOARD, B, C])
    expect(walk([BOARD], A, ticketPath('x'))).toEqual([BOARD, A, ticketPath('x')])
  })

  it('a screen already behind is returned to, not opened again', () => {
    expect(walk([BOARD], '/me/tasks', BOARD)).toEqual([BOARD])
    expect(walk([BOARD], '/me/tasks', '/admin', '/me/tasks')).toEqual([BOARD, '/me/tasks'])
  })

  it('the same screen is not a move', () => {
    expect(decide([BOARD, A], A, isAncestor)).toEqual({ kind: 'stay' })
  })
})

describe('the mirror of the browser history', () => {
  it('follows push, replace and back, and hands over what waits after a step back', () => {
    track('POP', 'k0', '/')
    track('PUSH', 'k1', A)
    track('PUSH', 'k2', B)
    expect(previousPath()).toBe(A)
    track('POP', 'k1', A) // back
    expect(previousPath()).toBe(BOARD)
    track('PUSH', 'k3', C) // forward entry B is gone
    expect(previousPath()).toBe(A)
    track('REPLACE', 'k4', '/page/z?x=1')
    expect(previousPath()).toBe(A)
    track('POP', 'k0', '/')
    expect(previousPath()).toBe(null)
  })

  it('an entry it has never seen starts a new history', () => {
    track('POP', 'k0', '/')
    track('PUSH', 'k1', A)
    track('POP', 'unknown', '/me/tasks')
    expect(previousPath()).toBe(null)
  })
})
