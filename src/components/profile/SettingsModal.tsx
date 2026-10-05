import { useEffect, useMemo, useState, useRef } from 'react'
import { Icon, type IconName } from '../ui/Icon'
import { useQuery } from '@tanstack/react-query'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import type { Profile } from '../../types'
import { ProfileSettings } from './ProfileSettings'
import { NotificationSettings } from './NotificationSettings'
import { ThemeSettings } from './ThemeSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { BetaSettings } from './BetaSettings'
import { LanguageSettings } from './LanguageSettings'
import { ShortcutSettings } from './ShortcutSettings'
import { AgentSettings } from './AgentSettings'
import { useAgents } from '../../hooks/useAgents'
import { currentUser } from '../../lib/session'
import { supabase } from '../../lib/supabase'
import { markHandled } from '../../lib/keys'
import { useT, type TranslationKey } from '../../i18n'

// QA: the "create your agent" form is only ever seen by a person without an agent; the QA account is one.
const previewCreate = () => typeof window !== 'undefined' && (window as unknown as { __firaAgentCreatePreview?: boolean }).__firaAgentCreatePreview === true

export type SettingsTab = 'profile' | 'notifications' | 'theme' | 'appearance' | 'language' | 'shortcuts' | 'beta' | 'agent'

const TABS: { id: SettingsTab; labelKey: TranslationKey; icon: IconName }[] = [
  { id: 'profile', labelKey: 'settings.tab.profile', icon: 'settings' },
  { id: 'notifications', labelKey: 'settings.tab.notifications', icon: 'bell' },
  { id: 'theme', labelKey: 'settings.tab.theme', icon: 'palette' },
  // Temalar yalnız renkler (#118f5c53): yazı boyutu, yoğunluk ve davranış burada.
  { id: 'appearance', labelKey: 'settings.tab.appearance', icon: 'sliders' },
  { id: 'language', labelKey: 'settings.tab.language', icon: 'language' },
  { id: 'shortcuts', labelKey: 'settings.tab.shortcuts', icon: 'keyboard' },
  { id: 'beta', labelKey: 'settings.beta.title', icon: 'beaker' },
]
/** "Claude'um" (100, 105): the person's agent — or, for someone who has none yet, where they create it. */
const AGENT_TAB: { id: SettingsTab; labelKey: TranslationKey; icon: IconName } =
  { id: 'agent', labelKey: 'settings.tab.agent', icon: 'sparkle' }

/**
 * One window for everything personal — profile, notifications, themes, appearance —
 * reached from the avatar menu, so the header does not have to carry a button
 * for each of them.
 */
export function SettingsModal({ tab, onTabChange, onClose, onProfileUpdated }: {
  tab: SettingsTab
  onTabChange: (t: SettingsTab) => void
  onClose: () => void
  onProfileUpdated: (p: Profile) => void
}) {
  const t = useT()
  const [mounted, setMounted] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  useDialogFocus(shellRef)
  useEffect(() => { setMounted(true) }, [])
  // Telefonda sekmeler yatay kayar: komut paletinden ya da menüden açılan sekme görünür olsun.
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    navRef.current?.querySelector(`[data-settings-tab="${tab}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tab])

  const { data: userId = null } = useQuery({ queryKey: ['session-user-id'], queryFn: async () => (await currentUser())?.id ?? null, staleTime: 60_000 })
  const { data: agents = [], isFetched: agentsKnown } = useAgents()
  const myAgents = useMemo(() => agents.filter((a) => !!userId && (a.owner_id === userId || a.profile_id === userId)), [agents, userId])
  // Whose screen this is: an agent account cannot have an agent of its own, a person without one may create it.
  const { data: me = null } = useQuery({
    queryKey: ['profile-brief', userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('full_name, is_ai').eq('id', userId!).maybeSingle()
      return (data ?? null) as { full_name: string | null; is_ai: boolean } | null
    },
  })
  const canCreate = agentsKnown && !!me && !me.is_ai && !agents.some((a) => a.owner_id === userId)
  const tabs = [...TABS, AGENT_TAB]

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { markHandled(e); onClose() } }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Sabit yükseklik (#118f5c53): sekme değişince pencere ve sekme listesi yerinden oynamasın. */}
      <div ref={shellRef} role="dialog" aria-modal="true" aria-label={t('settings.window')} className={`bg-surface border border-line rounded-xl shadow-2xl w-full max-w-3xl h-[46rem] max-h-[88vh] flex flex-col md:flex-row overflow-hidden outline-none ${mounted ? 'animate-fade-in' : ''}`}>
        {/* Nav — sidebar on desktop, tabs on mobile */}
        <nav ref={navRef} className="md:w-52 flex-shrink-0 border-b md:border-b-0 md:border-r border-line-soft p-2 md:p-3 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto scrollbar-none">
          {tabs.map((tabDef) => (
            <button
              key={tabDef.id}
              data-settings-tab={tabDef.id}
              onClick={() => onTabChange(tabDef.id)}
              aria-current={tab === tabDef.id ? 'page' : undefined}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                tab === tabDef.id ? 'bg-raised text-fg' : 'text-fg-muted hover:bg-raised hover:text-fg-2'
              }`}
            >
              <Icon name={tabDef.icon} />
              {t(tabDef.labelKey)}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center justify-between px-5 py-3 border-b border-line-soft flex-shrink-0">
            <h2 className="text-base font-semibold text-fg">{t(tabs.find((x) => x.id === tab)?.labelKey ?? 'settings.window')}</h2>
            <button onClick={onClose} className="text-fg-faint hover:text-fg-2 text-lg leading-none px-1" aria-label={t('common.close')}>×</button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin p-5">
            {tab === 'profile' && <ProfileSettings onUpdated={onProfileUpdated} />}
            {tab === 'notifications' && <NotificationSettings onClose={onClose} />}
            {tab === 'theme' && <ThemeSettings />}
            {tab === 'appearance' && <AppearanceSettings />}
            {tab === 'beta' && <BetaSettings />}
            {tab === 'language' && <LanguageSettings />}
            {tab === 'shortcuts' && <ShortcutSettings />}
            {tab === 'agent' && <AgentSettings agents={myAgents} userId={userId} ownerName={me?.full_name ?? null} canCreate={canCreate || previewCreate()} onClose={onClose} />}
          </div>
        </div>
      </div>
    </div>
  )
}
