/**
 * Open a team's settings window from anywhere (the import dock's "Raporu aç",
 * #684A9085). The board listens and opens the window on the given tab.
 */
type Listener = (req: { teamId: string; tab: string }) => void
const listeners = new Set<Listener>()

export function openTeamSettings(teamId: string, tab: string) {
  listeners.forEach((l) => l({ teamId, tab }))
}

export function onOpenTeamSettings(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
