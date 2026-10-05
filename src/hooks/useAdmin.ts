import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { t } from '../i18n'
import { useAuth } from './useAuth'

/** System-admin flag (profiles.is_admin, set only via SQL). */
export function useIsAdmin() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['is-admin', user?.id ?? null],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('is_admin').eq('id', user!.id).maybeSingle()
      return !!data?.is_admin
    },
  })
}

/**
 * The latest disk reading, for the admins' disk banner (DK-5): one small row
 * (the report's `disk` object only) every five minutes — the collector writes
 * one report per five minutes. RLS lets only system admins read it.
 */
export function useServerDisk(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'disk'],
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('system_status').select('collected_at, disk:payload->disk').order('collected_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data as { collected_at: string; disk: ServerStatus['disk'] | null } | null
    },
  })
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {})
  if (error) throw new Error(error.message)
  return data as T
}

/**
 * Yalnız okuyan panel sorguları: 502'de bir kez daha dener (#eae148ab). Kong, PostgREST'e
 * açık tuttuğu boştaki bağlantı tam kapanırken onu kullanırsa POST 502 dönüyor; GET'leri
 * Kong kendisi yeniden deniyor, POST'ları denemiyor. Buradaki fonksiyonlar VOLATILE
 * tanımlı olduğu için GET'e çevrilemiyor. Yazan işlemler (`useAdminAction`) `rpc` ile
 * kalır, onlar yeniden denenmez.
 */
async function read<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  let res = await supabase.rpc(fn, args ?? {})
  if (res.error && res.status === 502) res = await supabase.rpc(fn, args ?? {})
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

export interface ServerStatus {
  host: string; uptime_s: number; load: number[]
  disk: { total: number; used: number; avail: number; pct: number }
  mem: { total: number; avail: number }
  containers: { name: string; status: string; health: string; image: string }[]
  cert: { not_after: string; issuer: string }
  backup: {
    last_db_at: string; last_db_bytes: number; last_storage_bytes: number; count: number; total_bytes: number; last_log: string
    /** Reported since 0.15.4: one row per backup file, plus how the last run went. */
    keep_days?: number
    last_ok?: string
    last_error?: string
    files?: { name: string; kind: 'db' | 'storage'; bytes: number; at: string }[]
  }
  storage_bytes: number; db_bytes: number
  app: { bundle: string; version: string; nginx: string; kong_health_http: string }
  versions: { docker: string; nginx: string; os: string }
}

export interface Overview {
  teams: number; lists: number; users: number; tickets: number; subtasks: number; open_tickets: number; comments: number; attachments: number
  storage_objects: number; storage_bytes: number; db_bytes: number; active_users_7d: number; active_users_30d: number; pg_version: string
  last_status: { collected_at: string; payload: ServerStatus } | null
  last_deploy: { deployed_at: string; version: string; bundle: string; note: string | null } | null
  /** Pages (064) and what sits around them — the panel had no view of them (#87BB78EE). */
  folders: number
  pages: number
  pages_trashed: number
  pages_purge_due: number
  page_versions: number
  pages_by_source: Record<string, number>
  page_files: number
  page_bytes: number
  last_page_import: string | null
  last_page_edit: string | null
  /** "Claude'a yaptır" queue (059), by status. */
  ai_requests: Record<string, number>
  last_ai_request: string | null
  settings: Record<string, unknown>
  realtime_tables: string[]
  buckets: { id: string; public: boolean; file_size_limit: number | null }[]
}

export const useAdminOverview = () => useQuery({ queryKey: ['admin', 'overview'], queryFn: () => read<Overview>('admin_overview'), refetchInterval: 60_000 })
export interface AdminPages {
  by_team: { team: string; pages: number; trashed: number; imported: number; versions: number; last_edit: string | null }[]
  trash_soon: { title: string; team: string; archived_at: string }[]
}
export const useAdminPages = () => useQuery({ queryKey: ['admin', 'pages'], queryFn: () => read<AdminPages>('admin_pages') })
/** Tarayıcının saat dilimi: gün sınırı sunucunun UTC'sine göre değil, bakanın gününe göre (091). */
const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Istanbul' } catch { return 'Europe/Istanbul' } }
/** `days = 0` bugünü verir. */
export const useAdminMetrics = (days: number) => useQuery({ queryKey: ['admin', 'metrics', days], queryFn: () => read<AdminMetrics>('admin_metrics', { p_days: days, p_tz: browserTz() }) })

/** Özellik kullanım ısı haritası (091): her özellik için gün gün sayım. */
export interface FeatureUsage {
  days: number; tz: string; dates: string[]
  features: { key: string; group: string; counts: number[]; window_total: number; total: number; last_at: string | null }[]
}
export const useAdminFeatureUsage = (days: number) => useQuery({ queryKey: ['admin', 'usage', days], queryFn: () => read<FeatureUsage>('admin_feature_usage', { p_days: days, p_tz: browserTz() }) })

/** Bir kullanıcının ardında bıraktıkları — silme kutusu bunu gösterir (091). */
export interface UserFootprint {
  id: string; email: string | null; full_name: string | null; is_admin: boolean; source: string
  tickets: number; comments: number; projects: number; pages: number; teams: number
  attachments: number; assigned: number; memberships: number; owner_of: string[]; content: number
}
export const useUserFootprint = (userId: string | null) => useQuery({
  queryKey: ['admin', 'footprint', userId],
  enabled: !!userId,
  queryFn: () => read<UserFootprint>('admin_user_footprint', { p_user: userId }),
})
export const useAdminUsers = () => useQuery({ queryKey: ['admin', 'users'], queryFn: () => read<AdminUser[]>('admin_users') })
export const useAdminTeams = () => useQuery({ queryKey: ['admin', 'teams'], queryFn: () => read<AdminTeam[]>('admin_teams') })
/** Orphans are counted in full but listed in slices: there can be thousands (071). */
export interface OrphanResult { total: number; total_bytes: number; limit: number; files: StorageFile[] }
export const useAdminOrphans = () => useQuery({ queryKey: ['admin', 'orphans'], queryFn: () => read<OrphanResult>('admin_orphan_files') })
export const useAdminLargest = () => useQuery({ queryKey: ['admin', 'largest'], queryFn: () => read<StorageFile[]>('admin_largest_files', { p_limit: 20 }) })
export const useAdminAuthLog = () => useQuery({ queryKey: ['admin', 'authlog'], queryFn: () => read<AuthLogRow[]>('admin_auth_log', { p_limit: 200 }) })
export const useAdminAuditLog = () => useQuery({ queryKey: ['admin', 'auditlog'], queryFn: () => read<AuditRow[]>('admin_audit_log', { p_limit: 200 }) })
export const useAdminStatusHistory = (hours: number) => useQuery({ queryKey: ['admin', 'status-history', hours], queryFn: () => read<{ collected_at: string; payload: ServerStatus }[]>('admin_status_history', { p_hours: hours }) })
export const useAdminDeploys = () => useQuery({ queryKey: ['admin', 'deploys'], queryFn: () => read<DeployRow[]>('admin_deploys', { p_limit: 30 }) })

export interface AdminMetrics {
  days: number
  series: { day: string; created: number; closed: number; comments: number; logins: number }[]
  status_categories: Record<string, number>
  top_users: { email: string; name: string | null; tickets: number; comments: number }[]
  avg_close_hours: number
  archived: number
  per_list: { list: string; team: string; open: number; total: number }[]
}
export interface AdminUser {
  id: string; email: string | null; full_name: string | null; is_admin: boolean; avatar_url: string | null
  created_at: string; last_sign_in_at: string | null; banned_until: string | null
  /** 'import' → no login; created while importing another tool's data (040). */
  source: 'account' | 'import'; imported_from: string | null; external_id: string | null
  /** How many tickets are assigned to them — how much history a takeover carries. */
  assigned: number
  teams: { id: string; name: string; role: string }[]
}
export interface AdminTeam { id: string; name: string; created_at: string; owner: string | null; members: number; lists: number; tickets: number; pending_invites: number }
export interface StorageFile { name: string; bucket?: string; size: number; created_at: string }
export interface AuthLogRow { at: string; action: string; actor: string | null; ip: string | null; traits: Record<string, unknown> | null }
export interface AuditRow { at: string; actor: string | null; action: string; target: string | null; details: Record<string, unknown> | null }
export interface DeployRow { deployed_at: string; version: string | null; bundle: string | null; note: string | null }

// ── Ağ & istekler (055) ───────────────────────────────────────────────────────
export interface NetBucket { requests: number; bytes_in: number; bytes_out: number; s429: number; s5xx: number }
export interface NetSummary {
  last_minute: (NetBucket & { minute: string; avg_ms: number | null; p95_ms: number | null; nic_rx: number | null; nic_tx: number | null; nic_rx_rate: number | null; nic_tx_rate: number | null }) | null
  hour: NetBucket; today: NetBucket; month: NetBucket
  errors_24h: number
  top_paths_hour: { path: string; n: number }[]
}
export interface NetPoint { minute: string; requests: number; bytes_in: number; bytes_out: number; s2xx: number; s4xx: number; s429: number; s5xx: number; avg_ms: number | null; p95_ms: number | null; nic_rx_rate: number | null; nic_tx_rate: number | null }
export interface RequestRow { at: string; ip: string | null; method: string | null; path: string | null; status: number; bytes_in?: number | null; bytes_out: number | null; ms: number | null; ua: string | null }
export const useAdminNet = () => useQuery({ queryKey: ['admin', 'net'], queryFn: () => read<NetSummary>('admin_net_summary'), refetchInterval: 60_000 })
export const useAdminNetSeries = (minutes: number) => useQuery({ queryKey: ['admin', 'net-series', minutes], queryFn: () => read<NetPoint[]>('admin_net_series', { p_minutes: minutes }), refetchInterval: 60_000 })
export const useAdminRequestErrors = (hours: number, status: number | null) => useQuery({ queryKey: ['admin', 'req-errors', hours, status], queryFn: () => read<RequestRow[]>('admin_request_errors', { p_hours: hours, p_status: status }) })
export const useAdminRequestRecent = (limit: number, status: number | null, q: string) => useQuery({ queryKey: ['admin', 'req-recent', limit, status, q], queryFn: () => read<RequestRow[]>('admin_request_recent', { p_limit: limit, p_status: status, p_q: q || null }) })

/**
 * Uyarı sayısı — şeritteki yönetim düğmesinin rozeti (#7AB2D9F6). Panelin
 * tamamını (ve ağır `admin_overview` çağrısını) çekmez: yalnız son durum
 * raporu, eşikler ve ağ özeti; `computeAlerts` da bunlarla çalışıyor.
 */
export function useAdminAlerts(enabled: boolean) {
  const status = useQuery({
    queryKey: ['admin', 'alert-status'],
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('system_status').select('collected_at, payload').order('collected_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data as { collected_at: string; payload: ServerStatus } | null
    },
  })
  const settings = useSystemSettings()
  const net = useQuery({ queryKey: ['admin', 'net'], enabled, staleTime: 60_000, queryFn: () => read<NetSummary>('admin_net_summary') })
  const overview = status.data ? ({ last_status: status.data } as Overview) : undefined
  return computeAlerts(overview, settings.data, net.data ?? undefined)
}

/** Generic admin action → invalidates admin queries. */
export function useAdminAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ fn, args }: { fn: string; args?: Record<string, unknown> }) => rpc<unknown>(fn, args),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin'] }); qc.invalidateQueries({ queryKey: ['system-settings'] }) },
  })
}

/** Announcement / maintenance flags — readable by every signed-in user. */
export interface SystemSettings {
  announcement?: { text: string; until?: string | null; level?: 'info' | 'warning' }
  maintenance?: { on: boolean; message?: string }
  alerts?: { disk_pct?: number; backup_hours?: number; cert_days?: number; status_minutes?: number; net_429_hour?: number; net_gb_day?: number }
}
export function useSystemSettings() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['system-settings'],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<SystemSettings> => {
      const { data } = await supabase.from('system_settings').select('key, value')
      const out: Record<string, unknown> = {}
      for (const r of data ?? []) out[r.key] = r.value
      return out as SystemSettings
    },
  })
}

/**
 * Derived alerts from the latest server report (thresholds from settings).
 *
 * The sentences are translated here, at call time — AdminPage memoises the result
 * on the interface language too, so a switch repaints the banner.
 */
export function computeAlerts(o: Overview | undefined, s: SystemSettings | undefined, net?: NetSummary): { level: 'warning' | 'danger'; text: string }[] {
  if (!o) return []
  const th = { disk_pct: 85, backup_hours: 24, cert_days: 14, status_minutes: 15, net_429_hour: 0, net_gb_day: 5, ...(s?.alerts ?? {}) }
  const out: { level: 'warning' | 'danger'; text: string }[] = []
  const st = o.last_status
  if (!st) { out.push({ level: 'danger', text: t('misc.admin.alert.noStatus') }); return out }
  const ageMin = (Date.now() - new Date(st.collected_at).getTime()) / 60000
  if (ageMin > th.status_minutes) out.push({ level: 'warning', text: t('misc.admin.alert.staleStatus', { n: Math.round(ageMin) }) })
  const p = st.payload
  if (p.disk?.pct >= th.disk_pct) out.push({ level: p.disk.pct >= 95 ? 'danger' : 'warning', text: t('misc.admin.alert.disk', { n: p.disk.pct }) })
  if (p.backup?.last_db_at) {
    const h = (Date.now() - new Date(p.backup.last_db_at).getTime()) / 3600000
    if (h > th.backup_hours) out.push({ level: 'danger', text: t('misc.admin.alert.backupOld', { n: Math.round(h) }) })
  } else out.push({ level: 'danger', text: t('misc.admin.alert.noBackup') })
  if (p.cert?.not_after) {
    const d = (new Date(p.cert.not_after).getTime() - Date.now()) / 86400000
    if (d < th.cert_days) out.push({ level: d < 3 ? 'danger' : 'warning', text: t('misc.admin.alert.cert', { n: Math.max(0, Math.round(d)) }) })
  }
  for (const c of p.containers ?? []) {
    // The container name, its status and its health come from Docker — passed through as they are.
    if (!/^Up/.test(c.status) || c.health === 'unhealthy') out.push({ level: 'danger', text: t('misc.admin.alert.container', { name: c.name, status: `${c.status}${c.health !== 'none' ? ', ' + c.health : ''}` }) })
  }
  if (p.app?.nginx && p.app.nginx !== 'active') out.push({ level: 'danger', text: t('misc.admin.alert.nginx') })
  // Network: rate-limited clients and unexpected traffic (silent when the collector is absent)
  if (net) {
    if (net.hour.s429 > th.net_429_hour) out.push({ level: 'warning', text: t('misc.admin.alert.rate429', { n: net.hour.s429 }) })
    if (net.hour.s5xx > 0) out.push({ level: 'danger', text: t('misc.admin.alert.s5xx', { n: net.hour.s5xx }) })
    const gb = (net.today.bytes_in + net.today.bytes_out) / 1e9
    if (gb > th.net_gb_day) out.push({ level: 'warning', text: t('misc.admin.alert.traffic', { gb: gb.toFixed(1), limit: th.net_gb_day }) })
    if (net.last_minute && Date.now() - new Date(net.last_minute.minute).getTime() > 10 * 60000) out.push({ level: 'warning', text: t('misc.admin.alert.netCollector') })
  }
  return out
}
