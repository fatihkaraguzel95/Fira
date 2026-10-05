import { useUploads, formatProgress, type UploadProgress } from '../../lib/uploads'
import { useT } from '../../i18n'

/** A small progress ring (0–100). */
export function ProgressRing({ pct, size = 28 }: { pct: number; size?: number }) {
  const r = (size - 4) / 2, c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} className="stroke-line" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} strokeLinecap="round" className="stroke-primary-500 transition-[stroke-dashoffset] duration-200"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
    </svg>
  )
}

const pctOf = (u: UploadProgress) => (u.total ? Math.round((u.loaded / u.total) * 100) : 0)

/**
 * Files still going up for a ticket, shown in the Files panel as placeholders
 * of the files themselves with a progress ring (#FB541A31) — in the same grid
 * or list the finished files use, so each one turns into its tile in place.
 */
export function PendingUploads({ ticketId, view }: { ticketId: string; view: 'grid' | 'list' }) {
  const t = useT()
  const list = useUploads(ticketId)
  if (!list.length) return null
  if (view === 'grid') {
    return (
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pr-1" role="status" aria-live="polite">
        {list.map((u) => (
          <div key={u.id} className="rounded-xl border border-dashed border-line bg-field/60" title={t('ticketExtra.attachment.uploadingName', { name: u.name })}>
            <div className="w-full aspect-[4/3] rounded-t-xl bg-raised flex flex-col items-center justify-center gap-1.5">
              <ProgressRing pct={pctOf(u)} size={36} />
              <span className="text-2xs font-semibold text-fg-2 tabular-nums">%{pctOf(u)}</span>
            </div>
            <div className="px-2.5 py-2">
              <p className="text-xs font-medium text-fg truncate">{u.name}</p>
              <p className="text-2xs text-fg-faint tabular-nums">{formatProgress(u)}</p>
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="mt-3 border border-dashed border-line rounded-xl divide-y divide-line-soft" role="status" aria-live="polite">
      {list.map((u) => (
        <div key={u.id} className="flex items-center gap-3 px-3 py-2">
          <span className="w-10 h-10 flex items-center justify-center rounded-md bg-raised flex-shrink-0"><ProgressRing pct={pctOf(u)} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-fg truncate">{u.name}</p>
            <p className="text-2xs text-fg-faint tabular-nums">{t('ticketExtra.attachment.uploading')} {formatProgress(u)} · %{pctOf(u)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
