import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { usePrefs, GLOBAL_SCOPE } from './usePrefs'
import { useTeamPassive } from './usePassive'
import { NO_READING, normalizeReading, sha256Hex, type Reading, type TranslationRow } from '../lib/reading'

/**
 * The languages this person reads and the one the rest is translated into (113, #fa4b05e9).
 * Kept with the account (`user_preferences` global `reading`), not in the browser: the server
 * prepares translations from it.
 */
export function useReading() {
  const { prefs, loaded, patch } = usePrefs(GLOBAL_SCOPE)
  const reading = useMemo(() => normalizeReading(prefs.reading), [prefs.reading])
  // The whole value is written each time: the list is replaced, not merged. Nothing read = the key is removed.
  const set = useCallback((next: Reading) => patch({ reading: next.to && next.read.length ? { read: next.read, to: next.to } : null }), [patch])
  return { reading: loaded ? reading : NO_READING, loaded, set }
}

/**
 * The finished translations of one ticket's texts into this reader's language, by what they
 * translate: 'description' or a comment's id. Asked only when the reader wants translations and the
 * team turned the job on; nothing else is fetched for everybody else.
 */
export function useTicketTranslations(ticketId: string | null, teamId: string | null) {
  const { reading } = useReading()
  const { data: passive } = useTeamPassive(teamId)
  const on = !!ticketId && !!reading.to && passive?.translate === true
  const { data } = useQuery({
    // A key of its own: everything under ['ticket', id] is patched as a ticket by the optimistic updates.
    queryKey: ['translations', ticketId, reading.to],
    enabled: on,
    staleTime: 60_000,
    queryFn: async (): Promise<TranslationRow[]> => {
      const { data, error } = await supabase.from('content_translations')
        .select('comment_id, source_hash, source_lang, status, text')
        .eq('ticket_id', ticketId!).eq('target_lang', reading.to!).eq('status', 'done')
      if (error) throw error
      return (data ?? []) as TranslationRow[]
    },
  })
  const byKey = useMemo(() => {
    const m = new Map<string, TranslationRow>()
    if (on) for (const r of data ?? []) m.set(r.comment_id ?? 'description', r)
    return m
  }, [data, on])
  return { byKey, reading }
}

/** The hash of a text, computed off the render; null until it is there (and for an empty text). */
export function useTextHash(text: string | null | undefined, enabled = true): string | null {
  const [state, setState] = useState<{ text: string; hash: string } | null>(null)
  useEffect(() => {
    if (!enabled || !text) return
    let live = true
    void sha256Hex(text).then((hash) => { if (live) setState({ text, hash }) }).catch(() => {})
    return () => { live = false }
  }, [text, enabled])
  return enabled && text && state?.text === text ? state.hash : null
}
