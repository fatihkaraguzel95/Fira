import { SHORTCUTS, SHORTCUT_GROUPS, FIXED_SHORTCUTS, formatCombo, type Bindings, type ShortcutAction } from '../../lib/shortcuts'
import { fold } from '../../lib/fuzzy'
import { t } from '../../i18n'

export interface ShortcutRow {
  key: string
  label: string
  hint?: string
  combo: string
  /** Set for remappable rows (the registry); fixed and editor keys have none. */
  action?: ShortcutAction
}
export interface ShortcutSection { id: string; label: string; rows: ShortcutRow[] }

/**
 * The shortcut list by section — the same order and text in the dialog and in
 * Settings › Shortcuts. Translated at call time (the registry only holds keys).
 * `withUnbound`: the settings tab lists actions without a key too (to assign one).
 */
export function shortcutSections(bindings: Bindings, opts: { withUnbound: boolean; isAdmin: boolean; query: string }): ShortcutSection[] {
  const q = fold(opts.query.trim())
  const matches = (r: ShortcutRow) => !q || fold(r.label).includes(q) || fold(formatCombo(r.combo)).includes(q) || (!!r.hint && fold(r.hint).includes(q))
  const sections: ShortcutSection[] = [
    ...SHORTCUT_GROUPS.map((g) => ({
      id: g.id,
      label: t(g.labelKey),
      rows: SHORTCUTS
        .filter((s) => s.group === g.id && (s.id !== 'admin' || opts.isAdmin) && (opts.withUnbound || !!bindings[s.id]))
        .map((s) => ({ key: s.id, label: t(s.labelKey), hint: s.hintKey ? t(s.hintKey) : undefined, combo: bindings[s.id], action: s.id })),
    })),
    ...FIXED_SHORTCUTS.map((f) => ({
      id: f.group,
      label: t(f.labelKey),
      rows: f.items.map((i) => ({ key: `${f.group}:${i.keys}:${i.labelKey}`, label: t(i.labelKey), hint: i.whereKey ? t(i.whereKey) : undefined, combo: i.keys })),
    })),
  ]
  return sections.map((s) => ({ ...s, rows: s.rows.filter(matches) })).filter((s) => s.rows.length > 0)
}
