/**
 * "Show me this notification" (#F6EBA5AD): a toast or a system notification
 * opens the inbox with that notification picked — not the ticket behind it.
 * The board listens (desktop: the inbox drawer; phone: the /inbox page).
 */
export interface InboxTarget { ticketId?: string; nonce: number }

type Listener = (t: InboxTarget) => void
const listeners = new Set<Listener>()

export function openInbox(target: { ticketId?: string } = {}) {
  const t = { ...target, nonce: Date.now() }
  listeners.forEach((l) => l(t))
}

export function onOpenInbox(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
