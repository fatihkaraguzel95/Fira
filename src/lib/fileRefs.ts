import { storagePathFromUrl } from './storage'

/** A file of ours that a markdown text shows (`![alt](url)`) or links (`[text](url)`). */
export interface FileRef { url: string; name: string }

// ![alt](url "title") and [text](url): alt/text may hold escaped brackets, url may be <wrapped>.
const REF_RE = /!?\[((?:\\.|[^\]\\])*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g

/** The file's own name from its storage path: `<user>/<ticket>/<timestamp>-<name>`. */
export function fileNameFromUrl(url: string): string {
  const path = storagePathFromUrl(url) ?? url.split(/[?#]/)[0]
  const base = path.split('/').pop() ?? path
  return base.replace(/^\d{10,}-/, '').replace(/^[0-9a-f]{16}-/, '') || base
}

/** The storage files a text refers to, in text order, each once. */
export function fileRefs(md: string | null | undefined): FileRef[] {
  const out: FileRef[] = []
  const seen = new Set<string>()
  for (const m of (md ?? '').matchAll(REF_RE)) {
    const url = m[2]
    if (seen.has(url) || !storagePathFromUrl(url)) continue
    seen.add(url)
    const label = m[1].replace(/\\(.)/g, '$1').trim()
    out.push({ url, name: label || fileNameFromUrl(url) })
  }
  return out
}

/** Files `before` referred to that `after` no longer does. */
export function droppedFileUrls(before: string | null | undefined, after: string | null | undefined): string[] {
  const kept = new Set(fileRefs(after).map((r) => r.url))
  return fileRefs(before).map((r) => r.url).filter((u) => !kept.has(u))
}
