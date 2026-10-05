/**
 * Open a sidebar panel from outside the sidebar (#43a865fb): the top bar's logo
 * opens Home, a team picked in the command palette opens Teams and scrolls to
 * it. The sidebar owns its view state (and saves it); this is a one-way nudge.
 */
export type RailPanel = 'home' | 'teams'
export interface RailRequest { kind: RailPanel; teamId?: string }

const EVENT = 'fira:rail'

export function openRailPanel(kind: RailPanel, teamId?: string) {
  window.dispatchEvent(new CustomEvent<RailRequest>(EVENT, { detail: { kind, teamId } }))
}

export function onRailRequest(fn: (r: RailRequest) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<RailRequest>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
