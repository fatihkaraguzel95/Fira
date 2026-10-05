import type { WbElement } from './model'

/**
 * This user's own undo stack. Each entry holds the elements before and after
 * one action (null = did not exist). Undo writes the "before" states back as
 * new versions, so they sync to everyone like any other change — Teams'
 * whiteboard also undoes only your own actions.
 */
export interface HistoryEntry {
  before: Map<string, WbElement | null>
  after: Map<string, WbElement | null>
}

const LIMIT = 200

export class History {
  private undos: HistoryEntry[] = []
  private redos: HistoryEntry[] = []

  record(entry: HistoryEntry) {
    if (!entry.before.size) return
    this.undos.push(entry)
    if (this.undos.length > LIMIT) this.undos.shift()
    this.redos = []
  }
  undo(): HistoryEntry | null {
    const e = this.undos.pop() ?? null
    if (e) this.redos.push(e)
    return e
  }
  redo(): HistoryEntry | null {
    const e = this.redos.pop() ?? null
    if (e) this.undos.push(e)
    return e
  }
  get canUndo() { return this.undos.length > 0 }
  get canRedo() { return this.redos.length > 0 }
}
