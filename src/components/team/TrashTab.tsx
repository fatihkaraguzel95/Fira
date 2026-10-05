import { useState } from 'react'
import type { Team } from '../../types'
import { useTrashedPages, useRestorePage, useDeletePage } from '../../hooks/usePages'
import { useTeamRole } from '../../hooks/useTeams'
import { PageIcon } from '../page/PageTree'
import { displayTime, exactTime, useDateFormat } from '../../lib/time'
import { emitError } from '../../lib/errorToast'
import { useT } from '../../i18n'
import { LoadingLine } from '../ui/Spinner'

const DAY = 86_400_000

/** Team settings › Trash (067): pages deleted in the last 60 days. */
export function TrashTab({ team }: { team: Team }) {
  const t = useT()
  useDateFormat()
  const { perms } = useTeamRole(team.id)
  const { data, isLoading } = useTrashedPages(team.id)
  const restore = useRestorePage()
  const del = useDeletePage()
  const [confirm, setConfirm] = useState<string | null>(null)
  const roots = data?.roots ?? []

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted leading-relaxed">{t('page.trash.intro')}</p>
      {isLoading && <p className="text-sm"><LoadingLine text={t('common.loading')} /></p>}
      {!isLoading && roots.length === 0 && <p className="text-sm text-fg-faint">{t('page.trash.empty')}</p>}
      <ul className="divide-y divide-line-soft border border-line-soft rounded-xl overflow-hidden">
        {roots.map((p) => {
          const below = data?.below.get(p.id) ?? 0
          const left = Math.max(0, 60 - Math.floor(Math.max(0, Date.now() - new Date(p.archived_at!).getTime()) / DAY)) // (a client clock behind the server gave 61)
          const who = p.archiver?.full_name || p.archiver?.email || t('page.versions.unknownAuthor')
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <PageIcon className="text-fg-faint" />
              <div className="flex-1 min-w-[10rem]">
                <p className="text-sm text-fg-2 truncate">{p.title.trim() || t('page.untitled')}{below > 0 && <span className="text-fg-faint text-xs"> {t('page.trash.withChildren', { n: below })}</span>}</p>
                <p className="text-xs text-fg-faint" title={exactTime(p.archived_at!)}>{t('page.trash.row', { name: who, time: displayTime(p.archived_at!) })} · {t('page.trash.daysLeft', { n: left })}</p>
              </div>
              {perms.canWrite && (
                <button onClick={() => void restore.mutateAsync({ id: p.id }).catch(emitError)} disabled={restore.isPending}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">{t('page.trash.restore')}</button>
              )}
              {perms.canDelete(p.created_by) && (confirm === p.id ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs text-danger">{t('page.trash.confirmForever')}</span>
                  <button onClick={() => { setConfirm(null); void del.mutateAsync({ id: p.id }).catch(emitError) }} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-danger text-white">{t('page.trash.deleteForever')}</button>
                  <button onClick={() => setConfirm(null)} className="px-2 py-1.5 text-xs text-fg-muted hover:text-fg">{t('common.cancel')}</button>
                </span>
              ) : (
                <button onClick={() => setConfirm(p.id)} className="px-3 py-1.5 text-xs font-medium rounded-lg text-danger hover:bg-danger/10">{t('page.trash.deleteForever')}</button>
              ))}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
