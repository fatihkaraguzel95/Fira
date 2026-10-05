/**
 * Drag and drop in the sidebar tree (#AC4BC182). One prefix per kind, so a drop
 * target can tell what it is being handed, and one rule for where a drop lands:
 * the middle of a row takes the dragged thing **in**, the top and bottom edges
 * put it **next to** the row. Folders and pages follow the same rule, so the
 * tree behaves the same wherever you grab it.
 */
export const LIST = 'list:'
export const FOLDER = 'folder:'
export const FOLDER_DROP = 'folderdrop:'
export const PAGE = 'page:'
export const ROOT_DROP = 'rootdrop'

export type DropMode = 'nest' | 'before' | 'after'
export interface DropHint { id: string; mode: DropMode }

/** Which third of the row the pointer is in. */
export function dropMode(rect: { top: number; height: number }, pointerY: number): DropMode {
  const r = (pointerY - rect.top) / Math.max(1, rect.height)
  if (r < 0.25) return 'before'
  if (r > 0.75) return 'after'
  return 'nest'
}

/**
 * A row that cannot take anything *in* (a list, when a list is being dragged)
 * splits in two: the pointer is either above its middle or below it. Without
 * this the middle third of every list was a dead band where a reorder drop did
 * nothing at all (#AC4BC182 sonrası "sıralama olmamış").
 */
export function edgeMode(rect: { top: number; height: number }, pointerY: number): DropMode {
  return pointerY - rect.top < Math.max(1, rect.height) / 2 ? 'before' : 'after'
}

/** What a row looks like while it is the drop target: framed to take it in, a line to sit next to it. */
export const nestClass = (mode: DropMode | null | undefined) =>
  mode === 'nest' ? 'ring-2 ring-primary-400 bg-primary-50/60 dark:bg-primary-950/30' : ''

/** Rows that can also be dropped *into* hold their place while a drag is in
 *  flight: a sliding row would move the very edges the pointer is measured
 *  against, and the middle ("put it inside") could never be hit. */
export const holdStill = () => null
