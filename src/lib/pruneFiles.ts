import type { QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { fileRefs } from './fileRefs'
import { removeStorageUrls, storagePathFromUrl } from './storage'

/**
 * A file taken out of a ticket's text goes from Files too (#0E2B2AB8 — the
 * user reversed the earlier "keep it" decision): after a description save, a
 * comment deletion or a comment sent without a file pasted into its draft.
 *
 * Only files no longer referenced anywhere on the ticket go — the description,
 * every comment and the cover are checked against the server's current state,
 * so the same image in a comment keeps the file. Best effort, never throws:
 * RLS may refuse someone else's attachment (it stays in Files), storage may
 * refuse someone else's file (the admin's orphan cleanup finds it).
 * Pages are not pruned: their old versions still show their files.
 */
export async function pruneDroppedFiles(qc: QueryClient, ticketId: string, urls: string[]): Promise<void> {
  if (!urls.length) return
  try {
    const [tk, cm] = await Promise.all([
      supabase.from('tickets').select('description, cover_url').eq('id', ticketId).maybeSingle(),
      supabase.from('ticket_comments').select('content').eq('ticket_id', ticketId),
    ])
    if (tk.error || cm.error || !tk.data) return // cannot tell what is still shown: keep everything
    const still = new Set<string>([tk.data.cover_url as string | null].filter((u): u is string => !!u))
    for (const text of [tk.data.description as string | null, ...(cm.data ?? []).map((c) => c.content as string)]) {
      for (const r of fileRefs(text)) still.add(r.url)
    }
    const gone = [...new Set(urls)].filter((u) => !still.has(u))
    if (!gone.length) return
    const { data: rows } = await supabase.from('ticket_attachments').delete()
      .eq('ticket_id', ticketId).in('file_url', gone).select('file_url')
    // The stored file itself only when no other text shows it (text copied to another ticket or a page).
    const deleted = (rows ?? []).map((r) => r.file_url as string)
    const unused = await Promise.all(deleted.map(async (url) => {
      const path = storagePathFromUrl(url)
      if (!path) return null
      const like = `%${path.replace(/[%_]/g, (c) => `\\${c}`)}%`
      const hits = await Promise.all([
        supabase.from('tickets').select('id', { head: true, count: 'exact' }).ilike('description', like),
        supabase.from('ticket_comments').select('id', { head: true, count: 'exact' }).ilike('content', like),
        supabase.from('pages').select('id', { head: true, count: 'exact' }).ilike('content', like),
      ])
      return hits.every((h) => !h.error && !h.count) ? url : null
    }))
    await removeStorageUrls(unused)
    if (rows?.length) {
      qc.invalidateQueries({ queryKey: ['attachments', ticketId] })
      qc.invalidateQueries({ queryKey: ['tickets'] })
    }
  } catch {
    /* ignore — see above */
  }
}
