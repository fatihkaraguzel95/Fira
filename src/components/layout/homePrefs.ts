/**
 * Ana sayfa panelinin tercihleri (`user_preferences` global `home`). Ayrı dosyada:
 * ağaç menüsü (`treeMenus.tsx`) "Ana sayfaya ekle" için okuyor, HomePanel'i
 * içe aktarması PageTree ile döngü kuruyordu.
 */
export type HomeWidget = 'myTasks' | 'favorites' | 'recents' | 'teams'
export const HOME_WIDGETS: HomeWidget[] = ['myTasks', 'favorites', 'recents', 'teams']
const DEFAULT_WIDGETS: HomeWidget[] = ['myTasks', 'favorites', 'recents']

export interface HomePrefs { widgets?: string[]; teams?: string[]; collapsed?: string[] }
export const readHomePrefs = (prefs: unknown): { widgets: HomeWidget[]; teams: string[]; collapsed: HomeWidget[] } => {
  const h = (prefs as { home?: HomePrefs } | null)?.home
  const widgets = (h?.widgets ?? DEFAULT_WIDGETS).filter((w): w is HomeWidget => (HOME_WIDGETS as string[]).includes(w))
  const collapsed = (h?.collapsed ?? []).filter((w): w is HomeWidget => (HOME_WIDGETS as string[]).includes(w))
  return { widgets, teams: h?.teams ?? [], collapsed }
}
