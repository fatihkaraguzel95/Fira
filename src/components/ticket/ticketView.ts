/**
 * The user's chosen way of opening a ticket. Both views are built from the same
 * fragments (see TicketProperties, TicketTimeline, …); this preference only
 * decides the frame around them — a full-screen takeover or a centered popup.
 * Stored in the user's global prefs (`ticketView`); default full-screen.
 */
export type TicketViewMode = 'fullscreen' | 'popup'
export const DEFAULT_TICKET_VIEW: TicketViewMode = 'fullscreen'

export function readTicketView(prefs: unknown): TicketViewMode {
  return (prefs as { ticketView?: string } | null)?.ticketView === 'popup' ? 'popup' : 'fullscreen'
}

/**
 * Açılır pencerede dışına tıklamak görevi kapatsın mı (#3a5b8d93). Kişisel tercih
 * (`ticketPopupKeepOpen`); yazılmamışsa eskisi gibi kapatır. Açıkken pencere yalnız
 * ✕, Esc ya da tarayıcının Geri tuşuyla kapanır.
 */
export function readPopupKeepOpen(prefs: unknown): boolean {
  return (prefs as { ticketPopupKeepOpen?: boolean } | null)?.ticketPopupKeepOpen === true
}
