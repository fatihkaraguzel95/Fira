/**
 * "Is there anything the user has typed but not saved?" — one answer for the
 * whole app (#5A06299B). The update banner uses it to decide whether a waiting
 * version may be applied on its own (a reload while a comment is half-written
 * would lose it). Each editing surface registers itself under a key while it
 * holds unsaved text and clears it when the text is saved or discarded.
 */
const dirty = new Set<string>()

export function setUnsaved(key: string, isDirty: boolean) {
  if (isDirty) dirty.add(key)
  else dirty.delete(key)
}

export const hasUnsaved = () => dirty.size > 0

/** QA / debugging: what is currently unsaved. */
export const unsavedKeys = () => Array.from(dirty)
