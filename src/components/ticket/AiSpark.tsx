import { Icon } from '../ui/Icon'

/** The mark of AI work: the hand-off button, the people picker, the agent's settings. */
export function Spark({ className = '' }: { className?: string }) {
  // Callers used to size it with w-*/h-* classes; the icon has one size now, so those are dropped.
  return <Icon name="sparkle" className={className.replace(/(^|\s)[wh]-[\d.]+/g, ' ').trim()} />
}
