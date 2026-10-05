/**
 * The app's one spinner: a ring with a gap, turning. Used wherever something is
 * on its way and there is nothing to show yet (#85DBD130 — listings that take
 * seconds looked empty, as if there were no records).
 *
 * `label` is read by screen readers; leave it out for a spinner that sits next
 * to its own text.
 */
export function Spinner({ size = 'sm', className = '', label }: { size?: 'sm' | 'md'; className?: string; label?: string }) {
  const box = size === 'md' ? 'w-5 h-5 border-2' : 'w-3.5 h-3.5 border-2'
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`${box} inline-block rounded-full border-current border-t-transparent animate-spin flex-shrink-0 ${className}`}
    />
  )
}

/** Spinner + text, for an empty list that is still loading. */
export function LoadingLine({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-fg-muted ${className}`} role="status">
      <Spinner />
      {text}
    </span>
  )
}
