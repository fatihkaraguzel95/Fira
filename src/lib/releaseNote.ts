/**
 * "Fira was updated" as an inbox entry (#2aa4f068).
 *
 * The release notes used to open as a dialog on the first load of every new
 * version — several times a day, in the middle of whatever was being done.
 * Now the new version is one row in the inbox: unread until it is opened, and
 * a row that was not opened yet keeps collecting the versions that follow, so
 * a week away is still one row.
 *
 * What the account has been told lives in the global preferences (`release`),
 * so reading it on one device reads it everywhere. No field is ever null: the
 * preferences merge treats null as "delete the key".
 */
export interface ReleaseState {
  /** The newest version this account has been told about. */
  version: string
  /** The version the notes start after; equal to `version` = nothing to show. */
  from: string
  /** When `version` first loaded for this account — the row's place in the list. */
  at: string
  read: boolean
}

/** The inbox row's id; it is not a `user_notifications` row and never goes to the server. */
export const RELEASE_ID = 'release'

/** Before the inbox row, the dialog remembered the last version it showed per browser. */
export const legacySeenKey = (userId: string) => `fira_whats_new_seen_${userId}`

/** Numeric, part by part: 0.9.0 < 0.10.0. A malformed part counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.'), pb = b.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (parseInt(pa[i] ?? '0', 10) || 0) - (parseInt(pb[i] ?? '0', 10) || 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/**
 * What to store when this build loads; null = leave it as it is.
 *
 *  - Nothing stored yet: start from what the old dialog had shown in this
 *    browser; an account with no trace at all (new user, new device) starts
 *    at the current version with nothing to read.
 *  - A newer build: unread again. Notes that were not read yet stay in range.
 *  - The same or an older build (a tab that has not updated): nothing.
 */
export function nextReleaseState(cur: ReleaseState | undefined, app: string, legacySeen: string | null, now: string): ReleaseState | null {
  if (!cur || !cur.version) {
    if (legacySeen && compareVersions(app, legacySeen) > 0) return { version: app, from: legacySeen, at: now, read: false }
    return { version: app, from: app, at: now, read: true }
  }
  if (compareVersions(app, cur.version) <= 0) return null
  return { version: app, from: cur.read ? cur.version : (cur.from || cur.version), at: now, read: false }
}

/** Is there a row to show in this build? (An older tab has no notes for a range that starts at or after it.) */
export function releaseVisible(state: ReleaseState | undefined, app: string): state is ReleaseState {
  return !!state && !!state.version && !!state.from && compareVersions(state.version, state.from) > 0 && compareVersions(app, state.from) > 0
}

/** The releases a row covers, newest first: after `from`, up to `version`. */
export function releasesInRange<T extends { version: string }>(log: T[], state: Pick<ReleaseState, 'version' | 'from'>): T[] {
  return log.filter((r) => compareVersions(r.version, state.from) > 0 && compareVersions(r.version, state.version) <= 0)
}
