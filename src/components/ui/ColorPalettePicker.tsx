import { useState } from 'react'
import { Icon } from './Icon'
import { useTeamColors, useCreateTeamColor, COLOR_SWATCHES } from '../../hooks/useTeamColors'
import { useT } from '../../i18n'

/**
 * "Add a colour to the palette" — shared by both pickers below, so a colour
 * created while editing a tag is the same colour the lists and statuses see.
 */
function PaletteCreate({ teamId, onCreated, onCancel }: { teamId: string; onCreated: (hex: string, id: string) => void; onCancel: () => void }) {
  const t = useT()
  const createColor = useCreateTeamColor()
  const [newHex, setNewHex] = useState(COLOR_SWATCHES[10].hex)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    const name = newName.trim() || ((() => { const s = COLOR_SWATCHES.find((x) => x.hex === newHex); return s ? t(s.nameKey) : t('team.palette.fallbackName') })())
    setError(null)
    try {
      const c = await createColor.mutateAsync({ teamId, name, hex: newHex })
      onCreated(c.hex, c.id)
      setNewName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('team.palette.createFailed'))
    }
  }

  return (
    <div className="rounded-xl border border-line bg-raised/60 p-3 space-y-2.5">
      <p className="text-xs font-semibold text-fg-muted uppercase tracking-wider">{t('team.palette.add')}</p>
      <div className="grid grid-cols-10 gap-1.5">
        {COLOR_SWATCHES.map((s) => (
          <button
            key={s.hex}
            type="button"
            title={t(s.nameKey)}
            onClick={() => { setNewHex(s.hex); if (!newName) setNewName(t(s.nameKey)) }}
            className={`w-6 h-6 rounded-md transition-transform hover:scale-110 ${newHex === s.hex ? 'ring-2 ring-offset-2 ring-offset-surface ring-fg' : ''}`}
            style={{ backgroundColor: s.hex }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-md flex-shrink-0" style={{ backgroundColor: newHex }} />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); handleCreate() } if (e.key === 'Escape') onCancel() }}
          placeholder={t('team.colors.namePlaceholder')}
          className="flex-1 min-w-0 text-sm px-2.5 py-1.5 rounded-lg border border-line bg-field text-fg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button type="button" onClick={handleCreate} disabled={createColor.isPending} className="text-xs px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">{t('common.add')}</button>
        <button type="button" onClick={onCancel} className="text-xs px-2 py-1.5 rounded-lg text-fg-muted hover:bg-raised">{t('common.cancel')}</button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}

interface Props {
  teamId: string
  value: string | null           // team_colors.id
  onChange: (colorId: string | null) => void
  canCreate: boolean             // owner/admin
}

/**
 * Pick a colour from the TEAM palette (named colours the team defined).
 * No free hex input: new colours are created from curated swatches + a name,
 * then become available everywhere in the team.
 */
export function ColorPalettePicker({ teamId, value, onChange, canCreate }: Props) {
  const t = useT()
  const { data: colors = [] } = useTeamColors(teamId)
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 items-center">
        <button
          type="button"
          title={t('team.palette.noColor')}
          onClick={() => onChange(null)}
          className={`w-7 h-7 rounded-lg border flex items-center justify-center text-fg-faint transition-all ${
            value === null ? 'border-primary-500 ring-2 ring-primary-500/30' : 'border-line hover:border-fg-faint'
          }`}
        >
          <Icon name="ban" />
        </button>
        {colors.map((c) => (
          <button
            key={c.id}
            type="button"
            title={c.name}
            onClick={() => onChange(c.id)}
            className={`w-7 h-7 rounded-lg transition-all hover:scale-105 ${value === c.id ? 'ring-2 ring-offset-2 ring-offset-surface' : ''}`}
            style={{ backgroundColor: c.hex, ['--tw-ring-color' as string]: c.hex }}
          />
        ))}
        {canCreate && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="h-7 px-2 rounded-lg border border-dashed border-line text-xs text-fg-muted hover:text-primary-600 hover:border-primary-400 transition-colors"
          >
            + {t('team.colors.new')}
          </button>
        )}
      </div>
      {colors.length === 0 && !creating && (
        <p className="text-xs text-fg-faint">
          {canCreate ? t('team.palette.emptyCanCreate', { action: t('team.colors.new') }) : t('team.palette.empty')}
        </p>
      )}
      {creating && (
        <PaletteCreate teamId={teamId} onCreated={(_hex, id) => { onChange(id); setCreating(false) }} onCancel={() => setCreating(false)} />
      )}
    </div>
  )
}

/**
 * The same team palette for things that store a plain hex (status and tag
 * colours). The value stays a hex so nothing in the data model moves; the
 * choice is simply limited to the team's named colours. A colour picked before
 * the palette existed is still shown — as the first swatch, marked "eski" —
 * so an edit never silently changes it.
 */
export function TeamHexPicker({ teamId, value, onChange, canCreate, size = 'sm' }: {
  teamId: string | null
  value: string
  onChange: (hex: string) => void
  canCreate: boolean
  size?: 'sm' | 'md'
}) {
  const t = useT()
  const { data: colors = [] } = useTeamColors(teamId)
  const [creating, setCreating] = useState(false)
  const dim = size === 'md' ? 'w-6 h-6 rounded-md' : 'w-5 h-5 rounded-full'
  const current = value.toLowerCase()
  const inPalette = colors.some((c) => c.hex.toLowerCase() === current)

  const swatch = (hex: string, title: string, legacy = false) => (
    <button
      key={hex}
      type="button"
      title={title}
      onClick={() => onChange(hex)}
      className={`${dim} flex-shrink-0 transition-transform hover:scale-110 ${legacy ? 'opacity-70 ring-1 ring-dashed ring-line' : ''}`}
      style={{
        backgroundColor: hex,
        outline: hex.toLowerCase() === current ? `2px solid ${hex}` : undefined,
        outlineOffset: 2,
        boxShadow: hex.toLowerCase() === current ? '0 0 0 1px white inset' : undefined,
      }}
    />
  )

  if (!teamId) return null

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 flex-wrap items-center">
        {!inPalette && value && swatch(value, t('team.palette.legacyColor'), true)}
        {colors.map((c) => swatch(c.hex, c.name))}
        {canCreate && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="h-5 px-1.5 rounded-md border border-dashed border-line text-xs text-fg-muted hover:text-primary-600 hover:border-primary-400 transition-colors"
          >
            + {t('team.palette.newShort')}
          </button>
        )}
      </div>
      {colors.length === 0 && !creating && (
        <p className="text-xs text-fg-faint">
          {canCreate ? t('team.palette.emptyCanCreate', { action: t('team.palette.newShort') }) : t('team.palette.emptyAdminCanAdd')}
        </p>
      )}
      {creating && (
        <PaletteCreate teamId={teamId} onCreated={(hex) => { onChange(hex); setCreating(false) }} onCancel={() => setCreating(false)} />
      )}
    </div>
  )
}
