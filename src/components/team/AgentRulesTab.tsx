import { useMemo, useState } from 'react'
import { go } from '../../lib/nav'
import { useNavigate } from 'react-router-dom'
import type { Page, Team } from '../../types'
import { useAgentRules, useAddAgentRule, useRemoveAgentRule, useSetAgentRuleRequired, type AgentRulePage } from '../../hooks/useAgentRules'
import { useCreatePage, useTeamPages } from '../../hooks/usePages'
import { useProjects } from '../../hooks/useProjects'
import { useListPolicies, useSetListPolicy } from '../../hooks/useAiPolicy'
import { useTeamPassive, useSetTeamPassive } from '../../hooks/usePassive'
import { DEPLOY_POLICIES, asDeployPolicy, type DeployPolicy } from '../../lib/agents'
import { PageIcon } from '../page/PageTree'
import { displayTime, exactTime, useDateFormat } from '../../lib/time'
import { useT } from '../../i18n'
import { LoadingLine } from '../ui/Spinner'
import { Switch } from '../ui/Switch'

/** One group of rule pages (the team's, or one list's) with the way to add to it. */
function RuleGroup({ team, projectId, rules, pages, canManage, onOpen }: {
  team: Team
  /** null = the team's own rules. */
  projectId: string | null
  rules: AgentRulePage[]
  /** Every text page of the team: what can be made a rule. */
  pages: Page[]
  canManage: boolean
  onOpen: (pageId: string) => void
}) {
  const t = useT()
  const add = useAddAgentRule(team.id)
  const remove = useRemoveAgentRule(team.id)
  const setRequired = useSetAgentRuleRequired(team.id)
  const create = useCreatePage()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)

  const taken = new Set(rules.map((r) => r.page_id))
  const nextOrder = rules.reduce((n, r) => Math.max(n, r.order_index), -1) + 1
  const q = query.trim().toLocaleLowerCase('tr')
  const matches = pages.filter((p) => !taken.has(p.id) && (!q || p.title.toLocaleLowerCase('tr').includes(q))).slice(0, 8)

  const addPage = (pageId: string) => {
    add.mutate({ pageId, projectId, orderIndex: nextOrder }, { onSuccess: () => { setQuery(''); setAdding(false) } })
  }
  // A fresh page in the place the rule is for (the team's root, or the list), marked as a rule, opened to be written.
  const createPage = async () => {
    try {
      const page = await create.mutateAsync({ teamId: team.id, parent: projectId ? { kind: 'list', id: projectId } : { kind: 'team' }, title: t('team.rules.newPageTitle') })
      await add.mutateAsync({ pageId: page.id, projectId, orderIndex: nextOrder })
      onOpen(page.id)
    } catch { /* the failed step has already said so (MutationCache → toast) */ }
  }

  return (
    <div className="space-y-2" data-rule-group={projectId ?? 'team'}>
      {rules.length === 0 ? (
        <p className="text-sm text-fg-faint">{t('team.rules.empty')}</p>
      ) : (
        <ul className="divide-y divide-line-soft border border-line-soft rounded-xl overflow-hidden">
          {rules.map((r) => {
            const title = r.page?.title.trim() || t('page.untitled')
            return (
              <li key={r.id} data-rule={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <PageIcon className="text-fg-faint" />
                <div className="flex-1 min-w-[10rem]">
                  <button type="button" onClick={() => onOpen(r.page_id)} title={t('team.rules.open')} className="block max-w-full truncate rounded-md text-left text-sm font-medium text-fg hover:underline cursor-pointer">{title}</button>
                  <p className="text-xs text-fg-faint" title={r.page ? exactTime(r.page.updated_at) : undefined}>
                    {r.page?.archived_at ? t('team.rules.trashed') : r.page ? t('team.rules.updated', { time: displayTime(r.page.updated_at) }) : ''}
                  </p>
                </div>
                {canManage ? (
                  <label className="inline-flex items-center gap-1.5 text-xs text-fg-2 cursor-pointer" title={t('team.rules.requiredHint')}>
                    <input type="checkbox" checked={r.required} onChange={(e) => setRequired.mutate({ id: r.id, required: e.target.checked })} className="accent-primary-600" />
                    {t('team.rules.required')}
                  </label>
                ) : r.required ? (
                  <span className="text-2xs font-semibold px-1.5 py-0.5 rounded-md bg-primary-500/10 text-primary-700 dark:text-primary-300" title={t('team.rules.requiredHint')}>{t('team.rules.required')}</span>
                ) : null}
                {canManage && (
                  <button type="button" onClick={() => remove.mutate(r.id)} disabled={remove.isPending} aria-label={t('team.rules.removeAria', { name: title })}
                    className="px-2.5 py-1.5 text-xs font-medium rounded-lg text-fg-muted hover:text-danger hover:bg-danger/10 disabled:opacity-50 cursor-pointer">{t('team.rules.remove')}</button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canManage && (adding ? (
        <div className="rounded-xl border border-line-soft p-3 space-y-2" data-rule-picker>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); setQuery('') } }}
            placeholder={t('team.rules.search')}
            aria-label={t('team.rules.search')}
            autoFocus
            className="w-full bg-field border border-line rounded-lg px-3 py-1.5 text-sm text-fg placeholder:text-fg-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
          {matches.length === 0 ? (
            <p className="text-xs text-fg-faint px-1">{t('team.rules.noMatch')}</p>
          ) : (
            <ul className="max-h-48 overflow-y-auto scrollbar-thin">
              {matches.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => addPage(p.id)} disabled={add.isPending} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm text-fg-2 hover:bg-raised hover:text-fg disabled:opacity-50 cursor-pointer">
                    <PageIcon className="text-fg-faint" />
                    <span className="flex-1 min-w-0 truncate">{p.title.trim() || t('page.untitled')}</span>
                    <span className="text-xs font-medium text-primary-700 dark:text-primary-300 flex-shrink-0">{t('team.rules.addThis')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={() => void createPage()} disabled={create.isPending || add.isPending} data-rule-new className="px-3 py-1.5 text-xs font-medium rounded-lg border border-line text-fg-2 hover:bg-raised disabled:opacity-50 cursor-pointer">{t('team.rules.new')}</button>
            <button type="button" onClick={() => { setAdding(false); setQuery('') }} className="px-2 py-1.5 text-xs text-fg-muted hover:text-fg cursor-pointer">{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} data-rule-add className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 cursor-pointer">{t('team.rules.add')}</button>
      ))}
    </div>
  )
}

/**
 * Team settings › Ajan kuralları (107, #f10b0cf7): which pages the team's
 * agents read before they start a job — the team's rules, then the rules of the
 * job's list. The pages themselves are edited like any page; here they are only
 * chosen, marked required, or taken off the list.
 */
export function AgentRulesTab({ team, canManage, onClose }: { team: Team; canManage: boolean; onClose: () => void }) {
  const t = useT()
  useDateFormat()
  const navigate = useNavigate()
  const { data: rules = [], isLoading } = useAgentRules(team.id)
  const { data: allPages = [] } = useTeamPages(team.id)
  const { data: lists = [] } = useProjects(team.id)
  const [listId, setListId] = useState<string | null>(null)
  const { data: policies = {} } = useListPolicies(team.id)
  const setPolicy = useSetListPolicy(team.id)
  const { data: passive = { image_text: false, translate: false } } = useTeamPassive(team.id)
  const setPassive = useSetTeamPassive(team.id)
  // A canvas has no text to be a rule.
  const pages = useMemo(() => allPages.filter((p) => (p.kind ?? 'page') === 'page'), [allPages])
  const list = lists.find((l) => l.id === listId) ?? lists[0] ?? null
  const open = (pageId: string) => { onClose(); go(navigate, `/page/${pageId}`) }
  const countOf = (id: string) => rules.filter((r) => r.project_id === id).length

  return (
    <div className="space-y-6" data-agent-rules>
      <p className="text-xs text-fg-muted leading-relaxed">{t('team.rules.intro')}</p>
      {isLoading && <p className="text-sm"><LoadingLine text={t('common.loading')} /></p>}

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">{t('team.rules.team')}</h3>
          <p className="text-xs text-fg-muted">{t('team.rules.teamHint')}</p>
        </div>
        <RuleGroup team={team} projectId={null} rules={rules.filter((r) => !r.project_id)} pages={pages} canManage={canManage} onOpen={open} />
      </section>

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">{t('team.rules.list')}</h3>
          <p className="text-xs text-fg-muted">{t('team.rules.listHint')}</p>
        </div>
        {!list ? (
          <p className="text-sm text-fg-faint">{t('team.rules.noLists')}</p>
        ) : (
          <>
            <select
              aria-label={t('team.rules.pickList')}
              value={list.id}
              onChange={(e) => setListId(e.target.value)}
              data-rule-list
              className="max-w-full text-sm bg-field border border-line rounded-lg px-2 py-1.5 text-fg"
            >
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}{countOf(l.id) ? ` (${countOf(l.id)})` : ''}</option>)}
            </select>
            <RuleGroup key={list.id} team={team} projectId={list.id} rules={rules.filter((r) => r.project_id === list.id)} pages={pages} canManage={canManage} onOpen={open} />
            {/* Going live is the one rule a tool can hold the agent to (109): a setting, not a page. */}
            <div className="flex items-start gap-3 pt-2" data-rule-deploy>
              <select
                aria-label={t('team.rules.deploy')}
                value={asDeployPolicy(policies[list.id])}
                disabled={!canManage || setPolicy.isPending}
                onChange={(e) => setPolicy.mutate({ projectId: list.id, deploy: e.target.value as DeployPolicy })}
                className="text-sm bg-field border border-line rounded-lg px-2 py-1.5 text-fg disabled:opacity-60 flex-shrink-0"
              >
                {DEPLOY_POLICIES.map((p) => <option key={p} value={p}>{t(`settings.agent.deploy.${p}`)}</option>)}
              </select>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg">{t('team.rules.deploy')}</p>
                <p className="text-xs text-fg-muted">{t('team.rules.deployHint')}</p>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Passive jobs (110): a team's content goes to a model for them only when the team says so. */}
      <section className="space-y-2" data-rule-passive>
        <div>
          <h3 className="text-sm font-semibold text-fg">{t('team.rules.passive')}</h3>
          <p className="text-xs text-fg-muted">{t('team.rules.passiveHint')}</p>
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-line-soft p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-fg">{t('team.rules.imageText')}</p>
            <p className="text-xs text-fg-muted">{t('team.rules.imageTextHint')}</p>
          </div>
          <Switch
            on={passive.image_text}
            label={t('team.rules.imageText')}
            disabled={!canManage || setPassive.isPending}
            onToggle={() => setPassive.mutate({ image_text: !passive.image_text })}
            data-passive-image-text
          />
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-line-soft p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-fg">{t('team.rules.translate')}</p>
            <p className="text-xs text-fg-muted">{t('team.rules.translateHint')}</p>
          </div>
          <Switch
            on={passive.translate}
            label={t('team.rules.translate')}
            disabled={!canManage || setPassive.isPending}
            onToggle={() => setPassive.mutate({ translate: !passive.translate })}
            data-passive-translate
          />
        </div>
      </section>

      {!canManage && <p className="text-xs text-fg-muted">{t('team.rules.adminOnly')}</p>}
    </div>
  )
}
