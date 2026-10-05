import { useEffect, useState } from 'react'
import type { Agent } from '../../types'
import { useUpdateAgentSettings } from '../../hooks/useAgents'
import { setUnsaved } from '../../lib/unsaved'
import { useT } from '../../i18n'

/** Longer than this is a document, and belongs on a rule page. */
export const PREFS_MAX = 4000

/**
 * The owner's own preferences for their agent (#f10b0cf7): read by the agent
 * after the team's and the list's rule pages, so they shape how THIS person's
 * Claude works without changing the team's rules. Kept in `agents.settings`.
 */
export function AgentPrefs({ agent, short, canEdit }: { agent: Agent; short: string; canEdit: boolean }) {
  const t = useT()
  const update = useUpdateAgentSettings()
  const saved = typeof agent.settings?.preferences === 'string' ? agent.settings.preferences : ''
  const [text, setText] = useState(saved)
  const [justSaved, setJustSaved] = useState(false)
  // Follow the server when nothing is being typed here (another device, the first load).
  useEffect(() => { setText(saved) }, [saved])
  const dirty = text !== saved
  useEffect(() => { setUnsaved(`agent-prefs:${agent.id}`, dirty); return () => setUnsaved(`agent-prefs:${agent.id}`, false) }, [agent.id, dirty])

  const save = () => {
    update.mutate({ agentId: agent.id, patch: { settings: { preferences: text.trim() } } }, {
      onSuccess: () => { setJustSaved(true); window.setTimeout(() => setJustSaved(false), 2500) },
    })
  }

  return (
    <div className="px-4 py-3 border-t border-line-soft space-y-2" data-agent-prefs>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{t('settings.agent.prefs')}</p>
        <p className="text-xs text-fg-muted mt-0.5">{t('settings.agent.prefsHint', { name: short })}</p>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, PREFS_MAX))}
        disabled={!canEdit}
        rows={4}
        aria-label={t('settings.agent.prefs')}
        placeholder={canEdit ? t('settings.agent.prefsPlaceholder') : undefined}
        className="w-full resize-y bg-field border border-line rounded-lg px-3 py-2 text-sm text-fg placeholder:text-fg-faint disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      />
      {canEdit && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={!dirty || update.isPending} data-agent-prefs-save className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 cursor-pointer disabled:cursor-default">{t('common.save')}</button>
          <span className="text-xs text-fg-muted" role="status">{justSaved && !dirty ? t('settings.agent.prefsSaved') : dirty ? `${text.length} / ${PREFS_MAX}` : ''}</span>
        </div>
      )}
    </div>
  )
}
