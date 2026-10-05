import { Fragment, Suspense, lazy, useState } from 'react'
import { APP_VERSION } from '../version'
import { useReleaseNote } from '../hooks/useReleaseNote'
import { localeOf, t, useT, type TranslationKey } from '../i18n'
import { formatBytes } from '../lib/image'
import { supabase } from '../lib/supabase'
import { useIsAdmin, useAdminOverview, useAdminFeatureUsage, useUserFootprint, useAdminPages, useAdminMetrics, useAdminUsers, useAdminTeams, useAdminOrphans, useAdminLargest, useAdminAuthLog, useAdminAuditLog, useAdminStatusHistory, useAdminDeploys, useAdminAction, useSystemSettings, computeAlerts, useAdminNet, useAdminNetSeries, useAdminRequestErrors, useAdminRequestRecent, type Overview, type AdminUser, type ServerStatus, type NetSummary, type NetPoint, type RequestRow } from '../hooks/useAdmin'
import { Spinner, LoadingLine } from '../components/ui/Spinner'
import { copyText } from '../lib/files'

export { ADMIN_TABS, isAdminTab, type AdminTab } from './adminTabs'

// The same panel people open from Claude'um (/me/agents); a system admin's rows are simply everyone's.
const AgentPanel = lazy(() => import('../components/agents/AgentPanel').then((m) => ({ default: m.AgentPanel })))
import type { AdminTab } from './adminTabs'

const dt = (s?: string | null) => (s ? new Date(s).toLocaleString(localeOf()) : '—')
const ago = (s?: string | null) => {
  if (!s) return '—'
  const m = (Date.now() - new Date(s).getTime()) / 60000
  if (m < 1) return t('time.justNow'); if (m < 60) return t('misc.admin.ago.min', { n: Math.round(m) })
  const h = m / 60; if (h < 48) return t('misc.admin.ago.hour', { n: Math.round(h) })
  return t('misc.admin.ago.day', { n: Math.round(h / 24) })
}

/**
 * The admin screen's content (#7AB2D9F6). It used to be a page of its own with
 * its own header and tab rail; now it lives inside the app shell like every
 * other screen — the rail holds the entry, the level-2 panel holds the tabs,
 * and this renders in the main view.
 */
export function AdminView({ tab }: { tab: AdminTab }) {
  const t = useT()
  // Realtime aboneliği kabuğun (BoardPage) işi; yönetim ekranı onun içinde
  // çiziliyor. İkinci bir abonelik aynı kanalları paylaşınca ikisi birbirinin
  // bağlantısını kapatıp yeniden kuruyordu (#0CC7B9F6 tekrarı, 24 Eyl).
  const { data: isAdmin, isFetched } = useIsAdmin()
  const overview = useAdminOverview()
  const settings = useSystemSettings()
  const net = useAdminNet()
  // Not memoised: computeAlerts now builds translated sentences, so the result
  // depends on the interface language as well as on the data.
  const alerts = computeAlerts(overview.data, settings.data, net.data)

  if (isFetched && !isAdmin) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center">
        <p className="text-lg font-semibold text-fg">{t('misc.admin.adminsOnly')}</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin space-y-5 pb-6">
      {overview.error && <p className="text-sm text-danger">{t('misc.admin.loadError', { message: (overview.error as Error).message })}</p>}
      {tab === 'overview' && <OverviewTab o={overview.data} alerts={alerts} />}
      {tab === 'setup' && <SetupTab o={overview.data} />}
      {tab === 'metrics' && <MetricsTab />}
      {tab === 'usage' && <UsageTab />}
      {tab === 'agents' && <Suspense fallback={null}><AgentPanel embedded /></Suspense>}
      {tab === 'net' && <NetTab />}
      {tab === 'pages' && <PagesTab o={overview.data} />}
      {tab === 'backup' && <BackupTab o={overview.data} />}
      {tab === 'users' && <UsersTab />}
      {tab === 'tools' && <ToolsTab o={overview.data} />}
      {tab === 'logs' && <LogsTab />}
      {tab === 'deploy' && <DeployTab o={overview.data} />}
    </div>
  )
}

// ── shared bits ──────────────────────────────────────────────────────────────
const Card = ({ title, value, sub, tone = 'default', onClick }: { title: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'default' | 'ok' | 'warn' | 'bad'; onClick?: () => void }) => (
  <div onClick={onClick} className={`rounded-xl border p-4 bg-surface ${onClick ? 'cursor-pointer hover:border-fg-faint' : ''} ${tone === 'bad' ? 'border-danger/40' : tone === 'warn' ? 'border-warning/40' : tone === 'ok' ? 'border-success/40' : 'border-line'}`}>
    <p className="text-xs font-semibold uppercase tracking-wider text-fg-faint">{title}</p>
    <p className={`text-xl font-bold mt-1 ${tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warning' : 'text-fg'}`}>{value}</p>
    {sub && <p className="text-xs text-fg-muted mt-0.5">{sub}</p>}
  </div>
)
const Section = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <section className="rounded-xl border border-line bg-surface p-4 space-y-3">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-fg">{title}</h3>{right}</div>
    {children}
  </section>
)
/** `loading`: still fetching. An empty table then says so instead of "no records" —
 *  some of these lists take seconds and looked simply empty (#85DBD130). */
function Table({ head, rows, loading }: { head: string[]; rows: React.ReactNode[][]; loading?: boolean }) {
  const t = useT()
  const empty = loading
    ? <LoadingLine text={t('common.loading')} />
    : <span className="text-fg-faint">{t('misc.admin.noRecords')}</span>
  return (
    <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-fg-faint border-b border-line-soft">{head.map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-line-soft">{rows.length === 0 ? <tr><td className="py-2" colSpan={head.length}>{empty}</td></tr> : rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="py-1.5 pr-3 align-top text-fg-2">{c}</td>)}</tr>)}</tbody></table></div>
  )
}

/** A section heading that shows the list is still coming (or refreshing). */
const Busy = ({ on }: { on?: boolean }) => (on ? <Spinner className="text-primary-500" /> : null)
const btn = 'text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-raised disabled:opacity-50'
const btnDanger = 'text-xs font-medium px-2.5 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50'

// ── Overview ─────────────────────────────────────────────────────────────────
function OverviewTab({ o, alerts }: { o?: Overview; alerts: ReturnType<typeof computeAlerts> }) {
  const t = useT()
  if (!o) return <p className="text-sm"><LoadingLine text={t('common.loading')} /></p>
  const p = o.last_status?.payload
  const unhealthy = (p?.containers ?? []).filter((c) => !/^Up/.test(c.status) || c.health === 'unhealthy').length
  const backupH = p?.backup?.last_db_at ? (Date.now() - new Date(p.backup.last_db_at).getTime()) / 3600000 : Infinity
  const certD = p?.cert?.not_after ? (new Date(p.cert.not_after).getTime() - Date.now()) / 86400000 : Infinity
  return (
    <>
      {alerts.length > 0 && (
        <div className="rounded-xl border border-danger/40 bg-danger/5 p-3 space-y-1">
          {alerts.map((a, i) => <p key={i} className={`text-sm ${a.level === 'danger' ? 'text-danger' : 'text-warning'}`}>⚠ {a.text}</p>)}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title={t('misc.admin.overview.app')} value={`v${APP_VERSION}`} sub={o.last_deploy ? t('misc.admin.overview.appSub', { version: o.last_deploy.version ?? '?', when: ago(o.last_deploy.deployed_at) }) : t('misc.admin.overview.noDeploy')} tone={o.last_deploy && o.last_deploy.version !== APP_VERSION ? 'warn' : 'default'} />
        <Card title={t('misc.admin.overview.services')} value={p ? `${(p.containers ?? []).length - unhealthy}/${(p.containers ?? []).length}` : '—'} sub={unhealthy ? t('misc.admin.overview.unhealthy', { n: unhealthy }) : t('misc.admin.overview.allUp')} tone={unhealthy ? 'bad' : 'ok'} />
        <Card title={t('misc.admin.overview.database')} value={formatBytes(o.db_bytes)} sub={`PostgreSQL ${o.pg_version}`} />
        <Card title={t('misc.admin.overview.storage')} value={formatBytes(o.storage_bytes)} sub={t('misc.admin.overview.storageSub', { n: o.storage_objects, free: p ? formatBytes(p.disk.avail) : '—' })} tone={p && p.disk.pct >= 85 ? 'warn' : 'default'} />
        <Card title={t('misc.admin.overview.lastBackup')} value={p?.backup?.last_db_at ? ago(p.backup.last_db_at) : t('misc.admin.none')} sub={p?.backup?.last_db_at ? t('misc.admin.overview.backupSub', { db: formatBytes(p.backup.last_db_bytes), files: formatBytes(p.backup.last_storage_bytes) }) : t('misc.admin.overview.backupMissing')} tone={backupH > 24 ? 'bad' : 'ok'} />
        <Card title={t('misc.admin.overview.cert')} value={p?.cert?.not_after ? t('misc.admin.overview.days', { n: Math.round(certD) }) : '—'} sub={p?.cert?.issuer} tone={certD < 14 ? 'warn' : 'default'} />
        <Card title={t('misc.admin.overview.disk')} value={p ? t('misc.admin.percent', { n: p.disk.pct }) : '—'} sub={p ? `${formatBytes(p.disk.used)} / ${formatBytes(p.disk.total)}` : ''} tone={p && p.disk.pct >= 85 ? 'bad' : 'default'} />
        <Card title={t('misc.admin.overview.memory')} value={p ? t('misc.admin.overview.free', { size: formatBytes(p.mem.avail) }) : '—'} sub={p ? t('misc.admin.overview.load', { load: p.load.join(' · ') }) : ''} />
        <Card title={t('misc.admin.overview.users')} value={o.users} sub={t('misc.admin.overview.usersSub', { a7: o.active_users_7d, a30: o.active_users_30d })} />
        <Card title={t('misc.admin.overview.teamsLists')} value={`${o.teams} / ${o.lists}`} />
        <Card title={t('misc.admin.overview.tickets')} value={o.tickets} sub={t('misc.admin.overview.ticketsSub', { open: o.open_tickets, sub: o.subtasks })} />
        <Card title={t('misc.admin.overview.commentsFiles')} value={`${o.comments} / ${o.attachments}`} />
        <Card
          title={t('misc.admin.overview.pages')}
          value={o.pages ?? 0}
          sub={t('misc.admin.overview.pagesSub', { imported: o.pages_by_source?.onenote ?? 0, versions: o.page_versions ?? 0, trashed: o.pages_trashed ?? 0 })}
        />
        <Card
          title={t('misc.admin.overview.ai')}
          value={(o.ai_requests?.pending ?? 0) + (o.ai_requests?.processing ?? 0)}
          sub={t('misc.admin.overview.aiSub', { done: o.ai_requests?.done ?? 0, failed: o.ai_requests?.failed ?? 0, when: ago(o.last_ai_request) })}
          tone={(o.ai_requests?.failed ?? 0) > 0 ? 'warn' : 'default'}
        />
        <NetCard />
      </div>
      <Section title={t('misc.admin.overview.servicesSection')}>
        <Table head={[t('misc.admin.col.container'), t('misc.admin.col.status'), t('misc.admin.col.health'), t('misc.admin.col.image')]} rows={(p?.containers ?? []).map((c) => [c.name, <span className={/^Up/.test(c.status) ? 'text-success' : 'text-danger'}>{c.status}</span>, c.health, <span className="font-mono text-2xs">{c.image}</span>])} />
      </Section>
    </>
  )
}

/**
 * Pages, their versions and the trash (#87BB78EE). The panel knew tickets and
 * files but nothing about pages, so "what is where, what is at risk" could only
 * be answered with SQL.
 */
function PagesTab({ o }: { o?: Overview }) {
  const t = useT()
  const pages = useAdminPages()
  const d = pages.data
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card title={t('misc.admin.pages.live')} value={o?.pages ?? '—'} sub={t('misc.admin.pages.liveSub', { folders: o?.folders ?? 0, files: o?.page_files ?? 0, size: formatBytes(o?.page_bytes ?? 0) })} />
        <Card title={t('misc.admin.pages.versions')} value={o?.page_versions ?? '—'} sub={t('misc.admin.pages.versionsSub', { when: ago(o?.last_page_edit) })} />
        <Card
          title={t('misc.admin.pages.trash')}
          value={o?.pages_trashed ?? '—'}
          sub={t('misc.admin.pages.trashSub', { n: o?.pages_purge_due ?? 0 })}
          tone={(o?.pages_purge_due ?? 0) > 0 ? 'warn' : 'default'}
        />
        <Card title={t('misc.admin.pages.imported')} value={o?.pages_by_source?.onenote ?? 0} sub={t('misc.admin.pages.importedSub', { when: ago(o?.last_page_import) })} />
      </div>

      <Section title={t('misc.admin.pages.byTeam')}>
        {pages.error && <p className="text-sm text-danger">{(pages.error as Error).message}</p>}
        <Table
          loading={pages.isPending}
          head={[t('misc.admin.col.team'), t('misc.admin.pages.colPages'), t('misc.admin.pages.colImported'), t('misc.admin.pages.colVersions'), t('misc.admin.pages.colTrashed'), t('misc.admin.pages.colLastEdit')]}
          rows={(d?.by_team ?? []).map((r) => [r.team, r.pages, r.imported, r.versions, r.trashed, ago(r.last_edit)])}
        />
      </Section>

      <Section title={t('misc.admin.pages.trashSoon')} right={<Busy on={pages.isPending} />}>
        {d && d.trash_soon.length === 0
          ? <p className="text-sm text-fg-muted">{t('misc.admin.pages.trashSoonEmpty')}</p>
          : <Table loading={pages.isPending} head={[t('misc.admin.col.title'), t('misc.admin.col.team'), t('misc.admin.pages.colDeleted')]} rows={(d?.trash_soon ?? []).map((r) => [r.title || t('misc.admin.pages.untitled'), r.team, ago(r.archived_at)])} />}
      </Section>
    </>
  )
}

// ── Network & requests ───────────────────────────────────────────────────────
const rate = (bps?: number | null) => (bps == null ? '—' : `${formatBytes(bps)}/s`)
const statusTone = (s: number) => (s === 429 ? 'text-warning' : s >= 500 ? 'text-danger' : s >= 400 ? 'text-fg-muted' : 'text-success')

/** Overview card: Fira traffic right now + today, with the 429 count that matters most. */
function NetCard() {
  const t = useT()
  const net = useAdminNet()
  const n = net.data
  if (!n) return <Card title={t('misc.admin.net.card')} value="—" sub={t('misc.admin.net.noCollector')} />
  const lm = n.last_minute
  const fresh = lm && Date.now() - new Date(lm.minute).getTime() < 10 * 60000
  return (
    <Card
      title={t('misc.admin.net.card')}
      value={fresh && lm ? t('misc.admin.net.perMinute', { in: formatBytes(lm.bytes_in), out: formatBytes(lm.bytes_out) }) : t('misc.admin.net.stale')}
      sub={t('misc.admin.net.cardSub', { bytes: formatBytes(n.today.bytes_in + n.today.bytes_out), requests: n.today.requests, s429: n.hour.s429 })}
      tone={n.hour.s5xx > 0 ? 'bad' : n.hour.s429 > 0 ? 'warn' : 'default'}
    />
  )
}

function MiniBars({ points, pick, color, label }: { points: NetPoint[]; pick: (p: NetPoint) => number; color: string; label: (p: NetPoint) => string }) {
  const max = Math.max(1, ...points.map(pick))
  return (
    <div className="flex items-end gap-px h-20 w-full">
      {points.map((p) => (
        <div key={p.minute} title={`${new Date(p.minute).toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit' })} · ${label(p)}`} className="flex-1 min-w-[2px] rounded-t-md" style={{ height: `${Math.max(2, (pick(p) / max) * 100)}%`, background: color }} />
      ))}
    </div>
  )
}

function NetTab() {
  const t = useT()
  const [minutes, setMinutes] = useState(60)
  const [errHours, setErrHours] = useState(24)
  const [errStatus, setErrStatus] = useState<number | null>(null)
  const [recentStatus, setRecentStatus] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const summary = useAdminNet()
  const series = useAdminNetSeries(minutes)
  const errors = useAdminRequestErrors(errHours, errStatus)
  const recent = useAdminRequestRecent(300, recentStatus, q)
  const n: NetSummary | undefined = summary.data
  const pts = series.data ?? []
  const lm = n?.last_minute
  const sel = 'text-xs bg-field border border-line rounded-lg px-2 py-1.5 text-fg'
  const reqCols = [t('misc.admin.col.time'), 'IP', t('misc.admin.col.method'), t('misc.admin.col.path'), t('misc.admin.col.status'), t('misc.admin.col.duration'), t('misc.admin.col.out'), t('misc.admin.col.client')]
  const bucket = (b?: { requests: number; bytes_in: number; bytes_out: number; s429: number; s5xx: number }) =>
    b ? t('misc.admin.net.bucket', { bytes: formatBytes(b.bytes_in + b.bytes_out), requests: b.requests, s429: b.s429 }) + (b.s5xx ? t('misc.admin.net.bucket5xx', { n: b.s5xx }) : '') : '—'
  const rowOf = (r: RequestRow) => [
    dt(r.at), <span className="font-mono text-2xs">{r.ip ?? '—'}</span>, r.method ?? '—',
    <span className="font-mono text-2xs break-all">{r.path ?? '—'}</span>,
    <span className={`font-semibold ${statusTone(r.status)}`}>{r.status}</span>,
    r.ms != null ? `${r.ms} ms` : '—', r.bytes_out != null ? formatBytes(r.bytes_out) : '—',
    <span className="text-xs text-fg-faint truncate max-w-[16rem] inline-block" title={r.ua ?? ''}>{(r.ua ?? '').slice(0, 40)}</span>,
  ]
  if (!n) return <p className="text-sm text-fg-faint">{summary.isLoading ? t('common.loading') : t('misc.admin.net.noData')}</p>
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title={t('misc.admin.net.now')} value={lm ? `↓${formatBytes(lm.bytes_in)} ↑${formatBytes(lm.bytes_out)}` : '—'} sub={lm ? t('misc.admin.net.nowSub', { requests: lm.requests, avg: lm.avg_ms ?? '—', p95: lm.p95_ms ?? '—', when: ago(lm.minute) }) : t('misc.admin.net.noDataShort')} />
        <Card title={t('misc.admin.net.lastHour')} value={formatBytes(n.hour.bytes_in + n.hour.bytes_out)} sub={bucket(n.hour)} tone={n.hour.s5xx ? 'bad' : n.hour.s429 ? 'warn' : 'default'} />
        <Card title={t('misc.admin.net.today')} value={formatBytes(n.today.bytes_in + n.today.bytes_out)} sub={bucket(n.today)} />
        <Card title={t('misc.admin.net.thisMonth')} value={formatBytes(n.month.bytes_in + n.month.bytes_out)} sub={bucket(n.month)} />
        <Card title={t('misc.admin.net.nicNow')} value={lm ? `↓${rate(lm.nic_rx_rate)} ↑${rate(lm.nic_tx_rate)}` : '—'} sub={t('misc.admin.net.nicNowSub')} />
        <Card title={t('misc.admin.net.nicTotal')} value={lm && lm.nic_rx != null ? `↓${formatBytes(lm.nic_rx)} ↑${formatBytes(lm.nic_tx ?? 0)}` : '—'} sub={t('misc.admin.net.nicTotalSub')} />
        <Card title={t('misc.admin.net.errors24')} value={n.errors_24h} sub={t('misc.admin.net.errors24Sub')} tone={n.errors_24h ? 'warn' : 'ok'} />
        <Card title={t('misc.admin.net.topPath')} value={n.top_paths_hour[0]?.n ?? '—'} sub={<span className="font-mono text-2xs break-all">{n.top_paths_hour[0]?.path ?? '—'}</span>} />
      </div>

      <Section title={t('misc.admin.net.byMinute')} right={
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={sel}>
          <option value={60}>{t('misc.admin.net.range60')}</option><option value={180}>{t('misc.admin.net.range3h')}</option><option value={720}>{t('misc.admin.net.range12h')}</option><option value={1440}>{t('misc.admin.net.range24h')}</option>
        </select>}>
        <div className="grid md:grid-cols-3 gap-4">
          <div><p className="text-xs text-fg-faint mb-1">{t('misc.admin.net.reqPerMin')}</p><MiniBars points={pts} pick={(p) => p.requests} color="#3b82f6" label={(p) => t('misc.admin.net.requests', { n: p.requests })} /></div>
          <div><p className="text-xs text-fg-faint mb-1">{t('misc.admin.net.trafficPerMin')}</p><MiniBars points={pts} pick={(p) => p.bytes_in + p.bytes_out} color="#10b981" label={(p) => formatBytes(p.bytes_in + p.bytes_out)} /></div>
          <div><p className="text-xs text-fg-faint mb-1">{t('misc.admin.net.errPerMin')}</p>
            <div className="flex items-end gap-px h-20 w-full">
              {pts.map((p) => { const m = Math.max(1, ...pts.map((x) => x.s429 + x.s5xx)); return (
                <div key={p.minute} className="flex-1 min-w-[2px] flex flex-col justify-end" title={`${new Date(p.minute).toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit' })} · 429: ${p.s429} · 5xx: ${p.s5xx}`}>
                  <div style={{ height: `${(p.s5xx / m) * 80}px`, background: '#ef4444' }} />
                  <div style={{ height: `${(p.s429 / m) * 80}px`, background: '#f59e0b' }} />
                </div>) })}
            </div>
          </div>
        </div>
        {n.top_paths_hour.length > 0 && (
          <Table head={[t('misc.admin.net.colTopPath'), t('misc.admin.net.colRequests')]} rows={n.top_paths_hour.map((tp) => [<span className="font-mono text-2xs break-all">{tp.path}</span>, tp.n])} />
        )}
      </Section>

      <Section title={t('misc.admin.net.errorsSection', { n: errors.data?.length ?? 0 })} right={
        <span className="flex items-center gap-2">
          <select value={errHours} onChange={(e) => setErrHours(Number(e.target.value))} className={sel}><option value={1}>{t('misc.admin.net.hours1')}</option><option value={24}>{t('misc.admin.net.hours24')}</option><option value={168}>{t('misc.admin.net.days7')}</option></select>
          <select value={errStatus ?? ''} onChange={(e) => setErrStatus(e.target.value ? Number(e.target.value) : null)} className={sel}><option value="">429 + 5xx</option><option value={429}>{t('misc.admin.net.only429')}</option><option value={500}>500</option><option value={502}>502</option><option value={504}>504</option></select>
        </span>}>
        <Table loading={errors.isPending} head={reqCols} rows={(errors.data ?? []).slice(0, 200).map(rowOf)} />
      </Section>

      <Section title={t('misc.admin.net.recentSection')} right={
        <span className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('misc.admin.net.searchPlaceholder')} className={`${sel} w-44`} />
          <select value={recentStatus ?? ''} onChange={(e) => setRecentStatus(e.target.value ? Number(e.target.value) : null)} className={sel}><option value="">{t('misc.admin.net.allStatuses')}</option><option value={200}>200</option><option value={401}>401</option><option value={403}>403</option><option value={404}>404</option><option value={429}>429</option><option value={500}>500</option></select>
        </span>}>
        <Table loading={recent.isPending} head={reqCols} rows={(recent.data ?? []).map(rowOf)} />
      </Section>
    </>
  )
}

// ── Setup ────────────────────────────────────────────────────────────────────
function SetupTab({ o }: { o?: Overview }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  if (!o) return null
  const p = o.last_status?.payload
  const rows: [string, React.ReactNode][] = [
    [t('misc.admin.setup.domain'), `${window.location.origin} · ${window.location.origin}/api`],
    [t('misc.admin.setup.cert'), p ? t('misc.admin.setup.certValue', { issuer: p.cert.issuer, date: dt(p.cert.not_after) }) : '—'],
    [t('misc.admin.setup.appVersion'), `v${APP_VERSION} (bundle ${p?.app?.bundle ?? '—'})`],
    [t('misc.admin.setup.server'), p ? `${p.host} · ${p.versions.os} · Docker ${p.versions.docker} · nginx ${p.versions.nginx}` : '—'],
    ['PostgreSQL', o.pg_version],
    [t('misc.admin.setup.kong'), p ? t('misc.admin.setup.kongValue', { code: p.app.kong_health_http }) : '—'],
    [t('misc.admin.setup.realtime'), o.realtime_tables.join(', ')],
    [t('misc.admin.setup.buckets'), o.buckets.map((b) => `${b.id} (${b.public ? 'public' : 'private'}${b.file_size_limit ? `, ${formatBytes(b.file_size_limit)}` : ''})`).join(', ')],
    ['SMTP', t('misc.admin.setup.smtpValue')], [t('misc.admin.setup.sso'), t('misc.admin.setup.disabled')],
    [t('misc.admin.setup.backup'), p?.backup?.last_db_at ? t('misc.admin.setup.backupValue', { count: p.backup.count, size: formatBytes(p.backup.total_bytes) }) : t('misc.admin.none')],
    [t('misc.admin.setup.collector'), o.last_status ? t('misc.admin.setup.collectorValue', { date: dt(o.last_status.collected_at) }) : t('misc.admin.setup.collectorOff')],
  ]
  const report = () => {
    const txt = JSON.stringify({ app: APP_VERSION, origin: window.location.origin, overview: { ...o, settings: undefined }, at: new Date().toISOString() }, null, 2)
    navigator.clipboard.writeText(txt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }
  return (
    <Section title={t('misc.admin.setup.section')} right={<button className={btn} onClick={report}>{copied ? t('common.copied') : t('misc.admin.setup.copyReport')}</button>}>
      <Table head={[t('misc.admin.setup.colField'), t('misc.admin.setup.colValue')]} rows={rows.map(([k, v]) => [<span className="font-medium text-fg">{k}</span>, v])} />
      <p className="text-xs text-fg-faint">{t('misc.admin.setup.docsNote')}</p>
    </Section>
  )
}

// ── Metrics ──────────────────────────────────────────────────────────────────
function Bars({ data, keys, colors }: { data: Record<string, unknown>[]; keys: string[]; colors: string[] }) {
  const max = Math.max(1, ...data.flatMap((d) => keys.map((k) => Number(d[k]) || 0)))
  const w = 100 / Math.max(1, data.length)
  return (
    <svg viewBox="0 0 100 32" className="w-full h-28" preserveAspectRatio="none">
      {data.map((d, i) => keys.map((k, j) => {
        const v = Number(d[k]) || 0; const h = (v / max) * 28
        const bw = w / keys.length * 0.8
        return <rect key={k + i} x={i * w + j * (w / keys.length) + w * 0.1} y={30 - h} width={bw} height={h} fill={colors[j]} opacity={0.9}><title>{`${String(d.day)}: ${k} ${v}`}</title></rect>
      }))}
    </svg>
  )
}
function MetricsTab() {
  const t = useT()
  const [days, setDays] = useState(30)
  const { data: m, isLoading } = useAdminMetrics(days)
  if (isLoading || !m) return <p className="text-sm text-fg-faint">{t('common.loading')}</p>
  const csv = () => {
    const rows = [t('misc.admin.metrics.csvHeader'), ...m.series.map((s) => `${s.day},${s.created},${s.closed},${s.comments},${s.logins}`)].join('\r\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows], { type: 'text/csv' })); a.download = t('misc.admin.metrics.csvFile', { days }); a.click()
  }
  const sum = (k: keyof (typeof m.series)[number]) => m.series.reduce((a, s) => a + (Number(s[k]) || 0), 0)
  return (
    <>
      <div className="flex items-center gap-2">
        {/* 0 = bugün (yerel gece yarısından beri, 091). */}
        <button onClick={() => setDays(0)} className={`${btn} ${days === 0 ? 'bg-primary-600 text-white border-primary-600' : ''}`}>{t('misc.admin.metrics.today')}</button>
        {[7, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={`${btn} ${days === d ? 'bg-primary-600 text-white border-primary-600' : ''}`}>{t('misc.admin.metrics.days', { n: d })}</button>)}
        <button className={`${btn} ml-auto`} onClick={csv}>{t('misc.admin.metrics.downloadCsv')}</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title={t('misc.admin.metrics.created')} value={sum('created')} /><Card title={t('misc.admin.metrics.closed')} value={sum('closed')} /><Card title={t('misc.admin.metrics.comments')} value={sum('comments')} /><Card title={t('misc.admin.metrics.logins')} value={sum('logins')} />
        <Card title={t('misc.admin.metrics.avgClose')} value={t('misc.admin.metrics.hours', { n: m.avg_close_hours })} sub={t('misc.admin.metrics.avgCloseSub')} /><Card title={t('misc.admin.metrics.archived')} value={m.archived} />
      </div>
      <Section title={t('misc.admin.metrics.daily')}><Bars data={m.series} keys={['created', 'closed', 'comments']} colors={['#3b82f6', '#10b981', '#9ca3af']} /></Section>
      <div className="grid md:grid-cols-2 gap-4">
        <Section title={t('misc.admin.metrics.byCategory')}>
          <Table head={[t('misc.admin.metrics.colCategory'), t('misc.admin.col.ticket')]} rows={Object.entries(m.status_categories).map(([k, v]) => [k, v])} />
        </Section>
        <Section title={t('misc.admin.metrics.topUsers')}>
          <Table head={[t('misc.admin.col.person'), t('misc.admin.col.ticket'), t('misc.admin.col.comment')]} rows={m.top_users.map((u) => [u.name || u.email, u.tickets, u.comments])} />
        </Section>
      </div>
      <Section title={t('misc.admin.metrics.byList')}><Table head={[t('misc.admin.col.team'), t('misc.admin.col.list'), t('misc.admin.metrics.colOpen'), t('misc.admin.metrics.colTotal')]} rows={m.per_list.map((l) => [l.team, l.list, l.open, l.total])} /></Section>
    </>
  )
}

// ── Backup & storage ─────────────────────────────────────────────────────────
function BackupTab({ o }: { o?: Overview }) {
  const t = useT()
  const orphans = useAdminOrphans()
  const largest = useAdminLargest()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const p = o?.last_status?.payload
  const fileCols = [t('misc.admin.col.file'), t('misc.admin.col.size'), t('misc.admin.col.date')]
  /** Delete the listed orphans in slices: one request with thousands of paths is
   *  a body the storage API should not be handed (071). Repeat to clear the rest. */
  const removeOrphans = async () => {
    const list = orphans.data?.files ?? []
    if (!list.length) return
    setBusy(true)
    let done = 0
    let failed: string | null = null
    for (let i = 0; i < list.length && !failed; i += 100) {
      const chunk = list.slice(i, i + 100).map((f) => f.name)
      const { error } = await supabase.storage.from('ticket-attachments').remove(chunk)
      if (error) failed = error.message
      else done += chunk.length
    }
    setBusy(false)
    setMsg(failed ? t('misc.admin.backup.deleteFailed', { message: failed }) : t('misc.admin.backup.deleted', { n: done }))
    orphans.refetch()
  }
  // The server's own backup files, as the status report last saw them. Dates
   // alone made the list look empty (#F236F25C sonrası istek).
  const files = p?.backup?.files ?? []
  const dbFiles = files.filter((f) => f.kind === 'db')
  const stFiles = files.filter((f) => f.kind === 'storage')
  const sum = (list: typeof files) => list.reduce((n, f) => n + f.bytes, 0)
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title={t('misc.admin.backup.lastDb')} value={p?.backup?.last_db_at ? ago(p.backup.last_db_at) : t('misc.admin.none')} sub={p ? dt(p.backup.last_db_at) : ''} tone={p?.backup?.last_db_at && (Date.now() - new Date(p.backup.last_db_at).getTime()) < 26 * 3600000 ? 'ok' : 'bad'} />
        <Card title={t('misc.admin.backup.count')} value={p?.backup?.count ?? '—'} sub={p ? t('misc.admin.backup.countSub', { size: formatBytes(p.backup.total_bytes) }) : ''} />
        <Card title={t('misc.admin.overview.storage')} value={formatBytes(o?.storage_bytes ?? 0)} sub={t('misc.admin.backup.files', { n: o?.storage_objects ?? 0 })} />
        <Card title={t('misc.admin.backup.diskFree')} value={p ? formatBytes(p.disk.avail) : '—'} sub={p ? t('misc.admin.backup.diskFreeSub', { n: 100 - p.disk.pct }) : ''} tone={p && p.disk.pct >= 85 ? 'bad' : 'default'} />
      </div>
      <Section title={t('misc.admin.backup.section')} right={<span className="text-xs text-fg-faint">{p?.backup?.last_log}</span>}>
        <p className="text-xs text-fg-muted">{t('misc.admin.backup.note')}<b>{t('misc.admin.backup.noteLink')}</b>.</p>
        <p className="text-xs text-fg-2">
          {t('misc.admin.backup.summary', {
            days: p?.backup?.keep_days ?? 7,
            db: dbFiles.length,
            dbSize: formatBytes(sum(dbFiles)),
            st: stFiles.length,
            stSize: formatBytes(sum(stFiles)),
          })}
        </p>
        {p?.backup?.last_error && <p className="text-xs text-danger">{t('misc.admin.backup.lastError', { line: p.backup.last_error })}</p>}
        <Table
          loading={!p}
          head={[t('misc.admin.col.file'), t('misc.admin.backup.colKind'), t('misc.admin.col.size'), t('misc.admin.col.date'), t('misc.admin.backup.colAge'), '']}
          rows={files.map((f) => [
            <span className="font-mono text-2xs break-all">{f.name}</span>,
            f.kind === 'db' ? t('misc.admin.backup.kindDb') : t('misc.admin.backup.kindStorage'),
            formatBytes(f.bytes),
            dt(f.at),
            ago(f.at),
            <button
              className={btn}
              onClick={() => { void copyText(`scp ${p?.host ? p.host + ':' : ''}~/backups/${f.name} .`); setMsg(t('misc.admin.backup.copied', { name: f.name })) }}
            >
              {t('misc.admin.backup.copyScp')}
            </button>,
          ])}
        />
        <p className="text-xs text-fg-faint">{t('misc.admin.backup.downloadHint')}</p>
      </Section>
      <div className="grid md:grid-cols-2 gap-4">
        <Section title={t('misc.admin.backup.largest')} right={<Busy on={largest.isPending} />}><Table loading={largest.isPending} head={fileCols} rows={(largest.data ?? []).map((f) => [<span className="font-mono text-2xs break-all">{f.name}</span>, formatBytes(f.size), dt(f.created_at)])} /></Section>
        <Section
          title={t('misc.admin.backup.orphans', { n: orphans.data?.total ?? 0 })}
          right={<button className={btnDanger} disabled={busy || !(orphans.data?.files.length)} onClick={removeOrphans}>{t('misc.admin.backup.clean')}</button>}
        >
          <p className="text-xs text-fg-muted">{t('misc.admin.backup.orphansNote')}</p>
          {orphans.data && (
            <p className="text-xs text-fg-2">
              {t('misc.admin.backup.orphansSize', { size: formatBytes(orphans.data.total_bytes) })}
              {orphans.data.total > orphans.data.files.length && <> · {t('misc.admin.backup.orphansCapped', { shown: orphans.data.files.length, total: orphans.data.total })}</>}
            </p>
          )}
          {msg && <p className="text-xs text-fg-2">{msg}</p>}
          <Table loading={orphans.isPending} head={fileCols} rows={(orphans.data?.files ?? []).map((f) => [<span className="font-mono text-2xs break-all">{f.name}</span>, formatBytes(f.size), dt(f.created_at)])} />
        </Section>
      </div>
    </>
  )
}

// ── Users & teams ────────────────────────────────────────────────────────────
function UsersTab() {
  const t = useT()
  const users = useAdminUsers()
  const teams = useAdminTeams()
  const act = useAdminAction()
  const [confirm, setConfirm] = useState<string | null>(null)
  // Silme ayrı bir kutuda: `profiles`e bakan yabancı anahtarların çoğu CASCADE,
  // yani "sil" düğmesi yanlışlıkla bir kişinin bütün görevlerini götürebilir.
  // Önce ne bıraktığı gösteriliyor, içeriği varsa devir zorunlu (#7AB2D9F6).
  const [del, setDel] = useState<AdminUser | null>(null)
  const [reassign, setReassign] = useState('')
  const footprint = useUserFootprint(del?.id ?? null)
  const [q, setQ] = useState('')
  const [onlyImported, setOnlyImported] = useState(false)
  const all = users.data ?? []
  const importedCount = all.filter((u) => u.source === 'import').length
  const norm = (s: string) => s.toLocaleLowerCase('tr-TR')
  const rows = all.filter((u) =>
    (!onlyImported || u.source === 'import') &&
    (!q.trim() || [u.email, u.full_name, u.id, u.external_id].some((v) => v && norm(v).includes(norm(q.trim())))))
  const ban = (id: string, on: boolean) => act.mutate({ fn: 'admin_ban_user', args: { p_user: id, p_until: on ? '2999-01-01T00:00:00Z' : null } })
  return (
    <>
      {act.error && <p className="text-sm text-danger">{(act.error as Error).message}</p>}
      <Section
        title={rows.length !== all.length ? t('misc.admin.users.sectionFiltered', { n: rows.length, total: all.length }) : t('misc.admin.users.section', { n: all.length })}
        right={
          <span className="flex items-center gap-2">
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t('misc.admin.users.searchPlaceholder')}
              className="text-xs bg-field border border-line rounded-lg px-2 py-1.5 text-fg w-56"
            />
            <label className="flex items-center gap-1.5 text-xs text-fg-2" title={t('misc.admin.users.importedHint')}>
              <input type="checkbox" checked={onlyImported} onChange={(e) => setOnlyImported(e.target.checked)} />
              {t('misc.admin.users.onlyImported', { n: importedCount })}
            </label>
          </span>
        }
      >
        <Table loading={users.isPending} head={[t('misc.admin.col.person'), t('misc.admin.users.colLastSignIn'), t('misc.admin.users.colTeams'), t('misc.admin.col.admin'), t('misc.admin.col.action')]} rows={rows.map((u) => {
          const banned = !!u.banned_until && new Date(u.banned_until).getTime() > Date.now()
          return [
            <span>
              <span className="font-medium text-fg">{u.full_name || u.email || '—'}</span>
              {u.source === 'import' && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-raised border border-dashed border-fg-faint text-2xs text-fg-muted" title={t('misc.admin.users.importTitle', { source: u.imported_from ?? t('misc.admin.users.importBadge') }) + (u.external_id ? t('misc.admin.users.importTitleExternal', { id: u.external_id }) : '')}>
                  {t('misc.admin.users.importBadge')}
                </span>
              )}
              <br />
              <span className="text-fg-faint">
                {u.email ?? t('misc.admin.users.noEmail')}
                {banned && <span className="ml-1 text-danger">{t('misc.admin.users.banned')}</span>}
                {u.assigned > 0 && <span className="ml-1">{t('misc.admin.users.assigned', { n: u.assigned })}</span>}
              </span>
            </span>,
            u.source === 'import'
              ? <span className="text-fg-faint" title={u.imported_from ?? undefined}>{t('misc.admin.users.noSignIn')}</span>
              : <span title={dt(u.last_sign_in_at)}>{ago(u.last_sign_in_at)}</span>,
            u.teams.map((tm) => `${tm.name} (${tm.role})`).join(', ') || '—',
            <input type="checkbox" checked={u.is_admin} onChange={(e) => act.mutate({ fn: 'admin_set_admin', args: { p_user: u.id, p_admin: e.target.checked } })} />,
            u.source === 'import' ? (
              <span className="flex gap-1 flex-wrap items-center">
                <span className="text-fg-faint">{t('misc.admin.users.takeover')}</span>
                <button className={btn} onClick={() => { setDel(u); setReassign('') }}>{t('misc.admin.users.delete')}</button>
              </span>
            ) : (
            <span className="flex gap-1 flex-wrap">
              {confirm === u.id ? (
                <><button className={btnDanger} onClick={() => { ban(u.id, !banned); setConfirm(null) }}>{banned ? t('misc.admin.users.enable') : t('misc.admin.users.disableConfirm')}</button><button className={btn} onClick={() => setConfirm(null)}>{t('common.giveUp')}</button></>
              ) : (
                <><button className={btn} onClick={() => setConfirm(u.id)}>{banned ? t('misc.admin.users.enable') : t('misc.admin.users.disable')}</button><button className={btn} onClick={() => act.mutate({ fn: 'admin_revoke_sessions', args: { p_user: u.id } })} title={t('misc.admin.users.revokeTitle')}>{t('misc.admin.users.revoke')}</button><button className={btn} disabled={u.is_admin} title={u.is_admin ? t('misc.admin.users.deleteAdminHint') : t('misc.admin.users.deleteTitle')} onClick={() => { setDel(u); setReassign('') }}>{t('misc.admin.users.delete')}</button></>
              )}
            </span>
            ),
          ]
        })} />
        {del && (
          <div className="rounded-xl border border-danger/40 bg-danger/5 p-3 space-y-2">
            <p className="text-sm font-semibold text-fg">{t('misc.admin.users.deleteTitleName', { name: del.full_name || del.email || del.id })}</p>
            {footprint.isPending && <LoadingLine text={t('common.loading')} />}
            {footprint.data && (
              <>
                <p className="text-xs text-fg-2">
                  {t('misc.admin.users.footprint', {
                    tickets: footprint.data.tickets, comments: footprint.data.comments,
                    projects: footprint.data.projects, pages: footprint.data.pages, teams: footprint.data.teams,
                  })}
                </p>
                {footprint.data.owner_of.length > 0 && (
                  <p className="text-xs text-warning">{t('misc.admin.users.ownerOf', { teams: footprint.data.owner_of.join(', ') })}</p>
                )}
                {footprint.data.content > 0 ? (
                  <label className="flex flex-wrap items-center gap-2 text-xs text-fg-2">
                    {t('misc.admin.users.reassignTo')}
                    <select value={reassign} onChange={(e) => setReassign(e.target.value)} className="text-xs bg-field border border-line rounded-lg px-2 py-1.5 text-fg">
                      <option value="">{t('misc.admin.users.reassignPick')}</option>
                      {all.filter((x) => x.id !== del.id && x.source === 'account').map((x) => (
                        <option key={x.id} value={x.id}>{x.full_name || x.email}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="text-xs text-fg-muted">{t('misc.admin.users.noContent')}</p>
                )}
                <div className="flex gap-2">
                  <button
                    className={btnDanger}
                    disabled={act.isPending || (footprint.data.content > 0 && !reassign)}
                    onClick={() => {
                      act.mutate(
                        { fn: 'admin_delete_user', args: { p_user: del.id, p_reassign_to: reassign || null } },
                        { onSuccess: () => { setDel(null); setReassign('') } },
                      )
                    }}
                  >
                    {t('misc.admin.users.deleteConfirm')}
                  </button>
                  <button className={btn} onClick={() => { setDel(null); setReassign('') }}>{t('common.giveUp')}</button>
                </div>
                <p className="text-xs text-fg-faint">{t('misc.admin.users.deleteNote')}</p>
              </>
            )}
            {footprint.error && <p className="text-xs text-danger">{(footprint.error as Error).message}</p>}
          </div>
        )}
        {importedCount > 0 && (
          <p className="text-xs text-fg-faint">{t('misc.admin.users.importedNote', { n: importedCount })}</p>
        )}
        <p className="text-xs text-fg-faint">{t('misc.admin.users.passwordNote')}</p>
      </Section>
      <Section title={t('misc.admin.teams.section', { n: teams.data?.length ?? 0 })}>
        <Table loading={teams.isPending} head={[t('misc.admin.col.team'), t('misc.admin.teams.colOwner'), t('misc.admin.teams.colMembers'), t('misc.admin.col.list'), t('misc.admin.col.ticket'), t('misc.admin.teams.colPending'), t('misc.admin.teams.colCreated')]} rows={(teams.data ?? []).map((tm) => [<span className={!tm.owner ? 'text-danger' : ''}>{tm.name}{!tm.owner && t('misc.admin.teams.noOwner')}</span>, tm.owner ?? '—', tm.members, tm.lists, tm.tickets, tm.pending_invites, dt(tm.created_at)])} />
      </Section>
    </>
  )
}

// ── Özellik kullanımı (ısı haritası) ─────────────────────────────────────────
/**
 * "Hangi özellik ne kadar kullanılıyor, hangisine hiç dokunulmuyor?" (#7AB2D9F6)
 *
 * Fira'da ayrı bir kullanım telemetrisi yok; ısı haritası her özelliğin kendi
 * tablosundaki **yazma** izinden çıkıyor (091). Bu yüzden yalnız okunan şeyler
 * (pano açmak, arama yapmak) burada görünmez — tabloda da böyle yazıyor.
 */
function UsageTab() {
  const t = useT()
  const [days, setDays] = useState(30)
  const { data, isPending } = useAdminFeatureUsage(days)
  const label = (k: string) => t(`misc.admin.usage.f.${k}` as TranslationKey)
  const groupLabel = (g: string) => t(`misc.admin.usage.g.${g}` as TranslationKey)
  if (isPending || !data) return <p className="text-sm"><LoadingLine text={t('common.loading')} /></p>

  const peak = Math.max(1, ...data.features.flatMap((f) => f.counts))
  // Ölçek **satır bazlı**: görev açma ile kayıtlı görünüm aynı ölçeğe konunca
  // küçük olan hep bembeyaz kalıyor ve "kullanılmıyor" gibi okunuyordu. Her
  // satır kendi en yoğun gününe göre boyanıyor, mutlak sayı ipucunda duruyor.
  const cell = (n: number, rowPeak: number) => {
    if (n === 0) return 'bg-raised'
    const r = n / Math.max(1, rowPeak)
    if (r > 0.66) return 'bg-primary-600'
    if (r > 0.33) return 'bg-primary-500/70'
    if (r > 0.12) return 'bg-primary-500/45'
    return 'bg-primary-500/25'
  }
  const groups = [...new Set(data.features.map((f) => f.group))]
  const unused = data.features.filter((f) => f.total === 0)
  const cold = data.features.filter((f) => f.total > 0 && f.window_total === 0)

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {[7, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={`${btn} ${days === d ? 'bg-primary-600 text-white border-primary-600' : ''}`}>{t('misc.admin.metrics.days', { n: d })}</button>)}
        <span className="text-xs text-fg-faint ml-auto">{t('misc.admin.usage.note')}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card title={t('misc.admin.usage.cardTracked')} value={data.features.length} />
        <Card title={t('misc.admin.usage.cardUnused')} value={unused.length} sub={unused.map((f) => label(f.key)).join(', ') || '—'} tone={unused.length ? 'warn' : 'ok'} />
        <Card title={t('misc.admin.usage.cardCold')} value={cold.length} sub={cold.map((f) => label(f.key)).join(', ') || '—'} />
      </div>

      <Section title={t('misc.admin.usage.heatmap', { n: data.days })}>
        <div className="overflow-x-auto">
          <table className="text-xs border-separate" style={{ borderSpacing: '2px' }}>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g}>
                  <tr><td className="pt-2 pb-0.5 text-xs font-semibold uppercase tracking-wider text-fg-faint" colSpan={data.dates.length + 3}>{groupLabel(g)}</td></tr>
                  {data.features.filter((f) => f.group === g).map((f) => {
                    const rowPeak = Math.max(...f.counts, 1)
                    return (
                    <tr key={f.key}>
                      <th scope="row" className="text-left font-medium text-fg-2 pr-2 whitespace-nowrap">{label(f.key)}</th>
                      {f.counts.map((n, i) => (
                        <td key={i}>
                          <span
                            className={`block w-3.5 h-3.5 rounded-md ${cell(n, rowPeak)}`}
                            title={`${label(f.key)} · ${data.dates[i]} · ${n}`}
                          />
                        </td>
                      ))}
                      <td className="pl-2 tabular-nums text-fg-muted whitespace-nowrap">{f.window_total}</td>
                      <td className={`pl-2 tabular-nums whitespace-nowrap ${f.total === 0 ? 'text-warning' : 'text-fg-faint'}`}>
                        {f.total === 0 ? t('misc.admin.usage.never') : t('misc.admin.usage.lastUse', { when: ago(f.last_at) })}
                      </td>
                    </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-fg-faint">{t('misc.admin.usage.legend', { peak })}</p>
      </Section>

      <Section title={t('misc.admin.usage.table')}>
        <Table
          head={[t('misc.admin.usage.colFeature'), t('misc.admin.usage.colWindow', { n: data.days }), t('misc.admin.usage.colTotal'), t('misc.admin.usage.colLast')]}
          rows={[...data.features].sort((a, b) => b.total - a.total).map((f) => [
            label(f.key),
            f.window_total,
            f.total,
            f.total === 0 ? <span className="text-warning">{t('misc.admin.usage.never')}</span> : ago(f.last_at),
          ])}
        />
      </Section>
    </>
  )
}

// ── Tools ────────────────────────────────────────────────────────────────────
function ToolsTab({ o }: { o?: Overview }) {
  const t = useT()
  const settings = useSystemSettings()
  const act = useAdminAction()
  const s = settings.data
  const [text, setText] = useState(s?.announcement?.text ?? '')
  const [level, setLevel] = useState<'info' | 'warning'>(s?.announcement?.level ?? 'info')
  const [until, setUntil] = useState(s?.announcement?.until?.slice(0, 16) ?? '')
  const [mMsg, setMMsg] = useState(s?.maintenance?.message ?? '')
  const [purgeDays, setPurgeDays] = useState(90)
  const [result, setResult] = useState<string | null>(null)
  const { replay: replayRelease } = useReleaseNote()
  const maintenanceOn = !!s?.maintenance?.on
  const setSetting = (key: string, value: unknown) => act.mutate({ fn: 'admin_set_setting', args: { p_key: key, p_value: value } })
  const broadcastReload = async () => {
    const ch = supabase.channel('fira-app')
    await new Promise<void>((resolve) => ch.subscribe((st) => { if (st === 'SUBSCRIBED') resolve() }))
    await ch.send({ type: 'broadcast', event: 'reload', payload: { at: Date.now() } })
    await supabase.removeChannel(ch)
    setResult(t('misc.admin.tools.reloadSent'))
  }
  return (
    <>
      {act.error && <p className="text-sm text-danger">{(act.error as Error).message}</p>}
      {result && <p className="text-sm text-fg-2">{result}</p>}
      <Section title={t('misc.admin.tools.announcement')}>
        <div className="flex flex-wrap gap-2 items-center">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('misc.admin.tools.announcementPlaceholder')} className="flex-1 min-w-[240px] text-sm bg-field border border-line rounded-lg px-3 py-2 text-fg" />
          <select value={level} onChange={(e) => setLevel(e.target.value as 'info' | 'warning')} className="text-sm bg-field border border-line rounded-lg px-2 py-2 text-fg"><option value="info">{t('misc.admin.tools.levelInfo')}</option><option value="warning">{t('misc.admin.tools.levelWarning')}</option></select>
          <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className="text-sm bg-field border border-line rounded-lg px-2 py-2 text-fg" title={t('misc.admin.tools.untilTitle')} />
          <button className={btn} onClick={() => setSetting('announcement', { text, level, until: until ? new Date(until).toISOString() : null })} disabled={!text.trim()}>{t('misc.admin.tools.publish')}</button>
          <button className={btn} onClick={() => { setText(''); setSetting('announcement', {}) }}>{t('common.remove')}</button>
        </div>
        {s?.announcement?.text && <p className="text-xs text-fg-muted">{t('misc.admin.tools.live', { text: s.announcement.text })}{s.announcement.until ? t('misc.admin.tools.liveUntil', { date: dt(s.announcement.until) }) : ''}</p>}
      </Section>
      <Section title={t('misc.admin.tools.maintenance')} right={<span className={`text-xs font-semibold ${maintenanceOn ? 'text-danger' : 'text-success'}`}>{maintenanceOn ? t('misc.admin.tools.on') : t('misc.admin.tools.off')}</span>}>
        <p className="text-xs text-fg-muted">{t('misc.admin.tools.maintenanceNote')}</p>
        <div className="flex flex-wrap gap-2 items-center">
          <input value={mMsg} onChange={(e) => setMMsg(e.target.value)} placeholder={t('misc.admin.tools.messagePlaceholder')} className="flex-1 min-w-[240px] text-sm bg-field border border-line rounded-lg px-3 py-2 text-fg" />
          <button className={maintenanceOn ? btn : btnDanger} onClick={() => setSetting('maintenance', { on: !maintenanceOn, message: mMsg })}>{maintenanceOn ? t('misc.admin.tools.maintenanceOff') : t('misc.admin.tools.maintenanceOn')}</button>
        </div>
      </Section>
      <Section title={t('misc.admin.tools.clients')}>
        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={broadcastReload}>{t('misc.admin.tools.broadcastReload')}</button>
          <button className={btn} onClick={() => { void import('../changelog').then((m) => { replayRelease(m.CHANGELOG[1]?.version ?? '0'); setResult(t('misc.admin.tools.replayDone')) }) }}>{t('misc.admin.tools.replayChangelog')}</button>
        </div>
      </Section>
      <Section title={t('misc.admin.tools.data')}>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm text-fg-2">{t('misc.admin.tools.purgePrefix')}</span>
          <input type="number" min={1} value={purgeDays} onChange={(e) => setPurgeDays(Number(e.target.value))} className="w-20 text-sm bg-field border border-line rounded-lg px-2 py-1.5 text-fg" />
          <span className="text-sm text-fg-2">{t('misc.admin.tools.purgeSuffix')}</span>
          <button className={btnDanger} onClick={async () => { const n = await act.mutateAsync({ fn: 'admin_purge_archived', args: { p_days: purgeDays } }); setResult(t('misc.admin.tools.purged', { n: String(n) })) }}>{t('common.delete')}</button>
        </div>
        <p className="text-xs text-fg-faint">{t('misc.admin.tools.orphanNote', { keys: Object.keys(o?.settings ?? {}).join(', ') || '—' })}</p>
      </Section>
      <Section title={t('misc.admin.tools.thresholds')}>
        <AlertThresholds current={s?.alerts} onSave={(v) => setSetting('alerts', v)} />
      </Section>
    </>
  )
}
function AlertThresholds({ current, onSave }: { current?: { disk_pct?: number; backup_hours?: number; cert_days?: number; status_minutes?: number }; onSave: (v: unknown) => void }) {
  const t = useT()
  const [v, setV] = useState({ disk_pct: current?.disk_pct ?? 85, backup_hours: current?.backup_hours ?? 24, cert_days: current?.cert_days ?? 14, status_minutes: current?.status_minutes ?? 15 })
  const f = (k: keyof typeof v, label: string) => (
    <label className="flex items-center gap-2 text-sm text-fg-2">{label}<input type="number" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} className="w-20 text-sm bg-field border border-line rounded-lg px-2 py-1 text-fg" /></label>
  )
  return (
    <div className="flex flex-wrap gap-4 items-center">
      {f('disk_pct', t('misc.admin.tools.thDisk'))}{f('backup_hours', t('misc.admin.tools.thBackup'))}{f('cert_days', t('misc.admin.tools.thCert'))}{f('status_minutes', t('misc.admin.tools.thStatus'))}
      <button className={btn} onClick={() => onSave(v)}>{t('common.save')}</button>
    </div>
  )
}

// ── Logs ─────────────────────────────────────────────────────────────────────
function LogsTab() {
  const t = useT()
  const auth = useAdminAuthLog()
  const audit = useAdminAuditLog()
  const history = useAdminStatusHistory(24)
  const [q, setQ] = useState('')
  const filt = <T,>(rows: T[], f: (r: T) => string) => (q ? rows.filter((r) => f(r).toLowerCase().includes(q.toLowerCase())) : rows)
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('misc.admin.logs.filterPlaceholder')} className="w-full max-w-md text-sm bg-field border border-line rounded-lg px-3 py-2 text-fg" />
      <Section title={t('misc.admin.logs.auth')}>
        <Table loading={auth.isPending} head={[t('misc.admin.col.time'), t('misc.admin.col.action'), t('misc.admin.col.person'), 'IP']} rows={filt(auth.data ?? [], (r) => `${r.action} ${r.actor ?? ''}`).slice(0, 100).map((r) => [dt(r.at), r.action, r.actor ?? '—', r.ip ?? '—'])} />
      </Section>
      <Section title={t('misc.admin.logs.audit')}>
        <Table loading={audit.isPending} head={[t('misc.admin.col.time'), t('misc.admin.col.admin'), t('misc.admin.col.action'), t('misc.admin.col.target'), t('misc.admin.col.detail')]} rows={filt(audit.data ?? [], (r) => `${r.action} ${r.actor ?? ''} ${r.target ?? ''}`).map((r) => [dt(r.at), r.actor ?? '—', r.action, r.target ?? '—', <span className="font-mono text-2xs">{r.details ? JSON.stringify(r.details) : ''}</span>])} />
      </Section>
      <Section title={t('misc.admin.logs.status')}>
        <Table loading={history.isPending} head={[t('misc.admin.col.time'), t('misc.admin.col.disk'), t('misc.admin.logs.colMemFree'), t('misc.admin.logs.colLoad'), t('misc.admin.logs.colBadContainers')]} rows={(history.data ?? []).slice().reverse().slice(0, 48).map((h) => [dt(h.collected_at), t('misc.admin.percent', { n: h.payload.disk?.pct ?? 0 }), formatBytes(h.payload.mem?.avail ?? 0), (h.payload.load ?? []).join(' '), (h.payload.containers ?? []).filter((c) => !/^Up/.test(c.status) || c.health === 'unhealthy').map((c) => c.name).join(', ') || '—'])} />
      </Section>
    </>
  )
}

// ── Deploy ───────────────────────────────────────────────────────────────────
function DeployTab({ o }: { o?: Overview }) {
  const t = useT()
  const deploys = useAdminDeploys()
  const p: ServerStatus | undefined = o?.last_status?.payload
  const running = [...document.scripts].map((s) => s.src).find((s) => s.includes('/assets/index-'))?.replace(/.*index-([^.]+)\.js.*/, '$1')
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card title={t('misc.admin.deploy.running')} value={`v${APP_VERSION}`} sub={t('misc.admin.deploy.bundle', { hash: running ?? '—' })} />
        <Card title={t('misc.admin.deploy.serverBundle')} value={p?.app?.bundle ?? '—'} sub={o?.last_deploy ? t('misc.admin.deploy.versionWhen', { version: o.last_deploy.version, when: ago(o.last_deploy.deployed_at) }) : t('misc.admin.deploy.noRecord')} tone={p?.app?.bundle && running && p.app.bundle !== running ? 'warn' : 'ok'} />
        <Card title={t('misc.admin.deploy.repo')} value="github.com/glosaCarbon/fira" sub={t('misc.admin.deploy.repoSub')} />
      </div>
      <Section title={t('misc.admin.deploy.history')}>
        <Table loading={deploys.isPending} head={[t('misc.admin.col.time'), t('misc.admin.col.version'), 'Bundle', t('misc.admin.col.note')]} rows={(deploys.data ?? []).map((d) => [dt(d.deployed_at), d.version ?? '—', <span className="font-mono text-2xs">{d.bundle ?? '—'}</span>, d.note ?? ''])} />
        <p className="text-xs text-fg-faint">{t('misc.admin.deploy.rollback')}</p>
      </Section>
    </>
  )
}
