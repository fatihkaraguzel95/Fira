/**
 * Where a card dragged into another column should be inserted.
 *
 * dnd-kit tells us what the pointer is over: either a card (then `overIdx`
 * is its position and `overMid` its vertical centre) or the column itself
 * (`overIdx === -1` — its header, the quick-add card, the empty space below
 * the last card). The dragged card's own centre (`activeMid`) settles the
 * ambiguity:
 *   - over a card: before it when we are above its centre, after it otherwise
 *   - over the column, above the first card's centre: the very top — that is
 *     what "drop it at the top" looks like, the pointer is on the header area
 *   - over the column anywhere else: the end
 * Kept pure so it can be exercised without a browser (see scripts/check-drop.ts).
 */
export function dropIndex(args: {
  length: number
  overIdx: number
  activeMid: number | null
  overMid?: number | null
  firstMid?: number | null
}): number {
  const { length, overIdx, activeMid, overMid = null, firstMid = null } = args
  if (overIdx >= 0) {
    if (activeMid === null || overMid === null) return overIdx
    return activeMid > overMid ? overIdx + 1 : overIdx
  }
  if (length > 0 && activeMid !== null && firstMid !== null && activeMid < firstMid) return 0
  return length
}
