import type { TeamFolder } from '../types'

/**
 * Nested folders (068): a folder may sit inside another folder of the team.
 * A folder whose parent is not in the list (deleted, stale cache) counts as
 * top-level, so nothing ever disappears from the tree.
 */
const byOrder = (a: TeamFolder, b: TeamFolder) => a.order_index - b.order_index || a.name.localeCompare(b.name, 'tr')

/** The folders directly inside `parentId` (null = the team root), in order. */
export function childFolders(folders: TeamFolder[], parentId: string | null): TeamFolder[] {
  const ids = new Set(folders.map((f) => f.id))
  return folders.filter((f) => (parentId ? f.parent_id === parentId : !f.parent_id || !ids.has(f.parent_id))).sort(byOrder)
}

/** Root → … → the folder itself. */
export function folderChain(folders: TeamFolder[], id: string | null | undefined): TeamFolder[] {
  const chain: TeamFolder[] = []
  for (let cur = folders.find((f) => f.id === id), hops = 0; cur && hops < 100; cur = folders.find((f) => f.id === cur!.parent_id), hops++) chain.unshift(cur)
  return chain
}

/** Every folder in tree order with its path ("Müşteriler / BA"), for pickers. */
export function folderOptions(folders: TeamFolder[]): { id: string; label: string; depth: number }[] {
  const out: { id: string; label: string; depth: number }[] = []
  const walk = (parent: string | null, prefix: string, depth: number) => {
    for (const f of childFolders(folders, parent)) {
      const label = prefix ? `${prefix} / ${f.name}` : f.name
      out.push({ id: f.id, label, depth })
      if (depth < 50) walk(f.id, label, depth + 1)
    }
  }
  walk(null, '', 0)
  return out
}

/** How many folders sit anywhere below `id`. */
export function subfolderCount(folders: TeamFolder[], id: string): number {
  return folders.filter((f) => f.parent_id === id).reduce((n, f) => n + 1 + subfolderCount(folders, f.id), 0)
}
