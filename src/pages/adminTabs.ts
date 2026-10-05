import type { TranslationKey } from '../i18n'

/**
 * Yönetim sekmeleri tek başına küçük bir modülde (#990dfec5): Sidebar ve BoardPage
 * yalnız bu listeye ihtiyaç duyuyordu ama AdminPage'i statik içe aktardıkları için
 * bütün yönetim ekranı (ve useAdmin kancaları) ana pakete giriyordu; `lazy()` işe
 * yaramıyordu (Vite uyarısı). Artık AdminPage yalnız açılınca yükleniyor.
 */
export type AdminTab = 'overview' | 'setup' | 'metrics' | 'usage' | 'agents' | 'net' | 'pages' | 'backup' | 'users' | 'tools' | 'logs' | 'deploy'
/** Tab list for the sidebar panel — keys, not labels: this array is built once
 *  at import, so a translated label here would freeze the language (#7AB2D9F6). */
export const ADMIN_TABS: { id: AdminTab; key: TranslationKey }[] = [
  { id: 'overview', key: 'misc.admin.tab.overview' }, { id: 'setup', key: 'misc.admin.tab.setup' },
  { id: 'metrics', key: 'misc.admin.tab.metrics' }, { id: 'usage', key: 'misc.admin.tab.usage' },
  { id: 'agents', key: 'misc.admin.tab.agents' },
  { id: 'net', key: 'misc.admin.tab.net' }, { id: 'pages', key: 'misc.admin.tab.pages' },
  { id: 'backup', key: 'misc.admin.tab.backup' }, { id: 'users', key: 'misc.admin.tab.users' },
  { id: 'tools', key: 'misc.admin.tab.tools' }, { id: 'logs', key: 'misc.admin.tab.logs' },
  { id: 'deploy', key: 'misc.admin.tab.deploy' },
]
export const isAdminTab = (s: string | undefined): s is AdminTab => !!s && ADMIN_TABS.some((x) => x.id === s)
