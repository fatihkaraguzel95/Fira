import { useEffect, useState } from 'react'

interface Props {
  value: string | null | undefined // 'YYYY-MM-DD'
  onChange: (value: string | null) => void
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

/**
 * Controlled <input type="date"> that does not fight the user while typing.
 *
 * Native date inputs emit intermediate values while the year is being typed
 * ("0002-11-11" → "0020-11-11" → "0202-11-11" → "2022-11-11"). Committing those
 * to the server re-rendered the input with the half-typed value and reset the
 * browser's typing state, so a year like 2022 could never be entered.
 * We keep local state and commit only when the value is complete (4-digit year)
 * or when the field is left.
 */
export function DateInput({ value, onChange, className, disabled, ...rest }: Props) {
  const [local, setLocal] = useState(value ?? '')
  useEffect(() => { setLocal(value ?? '') }, [value])

  const isComplete = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 1000
  const commit = (v: string) => {
    const next = v || null
    if (next !== (value ?? null)) onChange(next)
  }

  return (
    <input
      type="date"
      value={local}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value
        setLocal(v)
        if (v === '' || isComplete(v)) commit(v)
      }}
      onBlur={() => {
        if (local === '' || isComplete(local)) commit(local)
        else setLocal(value ?? '') // half-typed → revert
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      className={className}
      {...rest}
    />
  )
}
