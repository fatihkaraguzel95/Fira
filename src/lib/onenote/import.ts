/**
 * OneNote notebook → Fira pages (#AAC9D463).
 *
 * Mapping (#684A9085, with nested folders 068): section group → folder (a
 * nested group → a subfolder), section → a folder inside it, OneNote page →
 * a page in that folder, OneNote subpage → its child page. Imports made
 * before this had the section as a page; re-importing turns it into the
 * folder (its pages move in, the empty section page goes). Every page is tagged source='onenote' with its OneNote
 * GUID, so importing the same notebook again updates instead of duplicating,
 * and pages that did not change are skipped (no second upload of their files).
 *
 * Writes go through supabaseBulk (CLAUDE.md: bulk writes) in chunks small
 * enough for nginx's 2 MB body limit on /api/rest; files larger than the
 * 25 MB storage limit are left out and reported, with a note in the page.
 */
import { supabase, supabaseBulk } from '../supabase'
import { currentUser } from '../session'
import { convertSection } from './convert'
import { readSection, ASSET_TOKEN_RE, type OneNotePage } from './parse'

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const BUCKET = 'ticket-attachments'
const REST_CHUNK_BYTES = 1_200_000
const UPLOAD_CONCURRENCY = 3

export interface ScannedSection {
  /** Path inside the notebook, e.g. "Müşteriler/REWE.one". */
  relPath: string
  /** Section group (folder) name; null = notebook root. */
  group: string | null
  /** The nested section groups, outermost first ([] = notebook root). */
  groupPath: string[]
  name: string
  file: File
  pages: number
  images: number
  ocrImages: number
  files: number
  bytes: number
  tooBig: { name: string; bytes: number }[]
  error: string | null
  /** Pages the converter could not read; versionHistory = stored as OneNote version history. */
  failedPages: number
  versionHistoryPages: number
  /** Earlier states found in the file (they go to the pages' version history). */
  revisions: number
}

export interface ScanResult {
  notebook: string
  sections: ScannedSection[]
}

export type Progress =
  | { phase: 'scan'; done: number; total: number; current: string }
  | { phase: 'import'; section: number; sections: number; current: string; pagesDone: number; pagesTotal: number; bytesDone: number; bytesTotal: number }

export interface ImportReport {
  created: number
  updated: number
  unchanged: number
  folders: number
  uploaded: number
  uploadedBytes: number
  skippedFiles: { page: string; name: string; bytes: number }[]
  /** Sections where the converter could not read some pages (the rest came in). */
  unreadable: { section: string; pages: number; versionHistory: number }[]
  /** Pages edited in Fira since they were imported: left as they are, OneNote's
   *  new state went to their version history instead. */
  kept: string[]
  /** Earlier states added to version histories (from the file, or kept pages). */
  versions: number
  errors: string[]
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i

/** The notebook's .one files from a folder pick (webkitRelativePath) or a plain multi-file pick. */
export function notebookFiles(files: File[]): { notebook: string; items: { file: File; relPath: string; group: string | null; groupPath: string[] }[] } {
  const ones = files.filter((f) => /\.one$/i.test(f.name) && !/OneNote_RecycleBin/i.test(f.webkitRelativePath))
  const withPath = ones.map((f) => ({ f, parts: (f.webkitRelativePath || f.name).split('/') }))
  const notebook = withPath[0]?.parts.length > 1 ? withPath[0].parts[0] : ''
  const items = withPath.map(({ f, parts }) => {
    const inside = notebook ? parts.slice(1) : parts
    const groups = inside.slice(0, -1)
    return { file: f, relPath: inside.join('/'), group: groups.length ? groups.join(' / ') : null, groupPath: groups }
  })
  items.sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '', 'tr') || a.file.name.localeCompare(b.file.name, 'tr'))
  return { notebook, items }
}

/** Converts every section once to show what an import would bring (nothing is written). */
export async function scanNotebook(files: File[], onProgress: (p: Progress) => void): Promise<ScanResult> {
  const { notebook, items } = notebookFiles(files)
  const sections: ScannedSection[] = []
  for (let i = 0; i < items.length; i++) {
    const { file, relPath, group, groupPath } = items[i]
    onProgress({ phase: 'scan', done: i, total: items.length, current: relPath })
    await tick()
    const out = await convertSection(file)
    const pages = readSection(out)
    let images = 0, files = 0, bytes = 0, ocrImages = 0
    const tooBig: ScannedSection['tooBig'] = []
    const counted = new Set<string>()
    let revisions = 0
    for (const p of pages) {
      ocrImages += p.ocrImages
      revisions += p.history.length
      for (const a of [...p.assets, ...p.history.flatMap((r) => r.assets)]) {
        if (counted.has(a.name)) continue
        counted.add(a.name)
        if (IMAGE_EXT.test(a.name)) images++; else files++
        bytes += a.bytes.length
        if (a.bytes.length > MAX_UPLOAD_BYTES) tooBig.push({ name: a.name, bytes: a.bytes.length })
      }
    }
    sections.push({ relPath, group, groupPath, name: file.name.replace(/\.one$/i, ''), file, pages: pages.length, images, ocrImages, files, bytes, tooBig, error: out.error,
      failedPages: out.failedPages, versionHistoryPages: out.versionHistoryPages, revisions })
  }
  onProgress({ phase: 'scan', done: items.length, total: items.length, current: '' })
  return { notebook, sections }
}

interface ExistingPage { id: string; source_ref: string; source_hash: string | null; title: string; content: string; parent_page_id: string | null; folder_id: string | null; order_index: number }

interface VersionRow { page_id: string; team_id: string; title: string; content: string; author_name: string | null; saved_at: string; source: 'onenote'; source_ref: string }

interface Row {
  id: string
  team_id: string
  folder_id: string | null
  parent_page_id: string | null
  title: string
  content: string
  order_index: number
  created_by: string
  created_at: string
  updated_at: string
  source: string
  source_ref: string
  /** Hash of what was imported; a later import compares it to spot edits made in Fira. */
  source_hash: string
}

/** One line of the import's running log (#684A9085): what is happening, and how long each step took. */
export interface ImportLogLine {
  /** ms since the import started */
  at: number
  kind: 'step' | 'ok' | 'upload' | 'write' | 'warn' | 'error'
  /** Key + values: translated when shown, so the log follows the language. */
  key: ImportLogKey
  values?: Record<string, string | number>
  /** Already-translated line (sheet imports report text, not keys); wins over `key`. */
  text?: string
  /** How long the step took, ms. */
  ms?: number
}
export type ImportLogKey =
  | 'start' | 'sectionStart' | 'converted' | 'folder' | 'upload' | 'wrotePages' | 'updatedPages' | 'versions'
  | 'sectionDone' | 'sectionFailed' | 'unreadable' | 'stopped' | 'finished'
  | 'sheetStep'

/** Thrown between steps when the user stops the import; the section in hand is rolled back like a failure. */
class ImportStopped extends Error {}

export async function runOneNoteImport(opts: {
  teamId: string
  sections: ScannedSection[]
  onProgress: (p: Progress) => void
  onLog?: (line: ImportLogLine) => void
  /** Checked between pages and sections: true = stop after cleaning up the section in hand. */
  shouldStop?: () => boolean
}): Promise<ImportReport & { stopped: boolean }> {
  const { teamId, sections, onProgress } = opts
  const t0 = performance.now()
  const log = (kind: ImportLogLine['kind'], key: ImportLogKey, values?: ImportLogLine['values'], ms?: number) =>
    opts.onLog?.({ at: Math.round(performance.now() - t0), kind, key, values, ms: ms === undefined ? undefined : Math.round(ms) })
  const stopCheck = () => { if (opts.shouldStop?.()) throw new ImportStopped() }
  let stopped = false
  const user = await currentUser()
  if (!user) throw new Error('Oturum bulunamadı')
  const report: ImportReport = { created: 0, updated: 0, unchanged: 0, folders: 0, uploaded: 0, uploadedBytes: 0, skippedFiles: [], unreadable: [], kept: [], versions: 0, errors: [] }

  // What a previous import already brought in.
  const existing = new Map<string, ExistingPage>()
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from('pages').select('id, source_ref, source_hash, title, content, parent_page_id, folder_id, order_index')
      .eq('team_id', teamId).eq('source', 'onenote').range(from, from + 499)
    if (error) throw error
    for (const r of (data ?? []) as ExistingPage[]) existing.set(r.source_ref, r)
    if (!data || data.length < 500) break
  }
  const existingById = new Map([...existing.values()].map((r) => [r.id, r]))
  /** The section page an imported page hangs under (walks up parent links). */
  const sectionOf = (row: ExistingPage): string | null => {
    let cur: ExistingPage | undefined = row
    for (let hops = 0; cur && hops < 20; hops++) {
      if (cur.source_ref.startsWith('section:')) return cur.source_ref
      cur = cur.parent_page_id ? existingById.get(cur.parent_page_id) : undefined
    }
    return null
  }
  const { data: folderRows, error: fErr } = await supabase.from('team_folders').select('id, name, parent_id, order_index').eq('team_id', teamId)
  if (fErr) throw fErr
  const folderList = (folderRows ?? []) as { id: string; name: string; parent_id: string | null; order_index: number }[]
  /** The folder for a path of names (section groups, then the section), created where missing. */
  const ensureFolder = async (path: string[]): Promise<string> => {
    let parent: string | null = null
    for (const name of path) {
      let f = folderList.find((x) => x.name === name && x.parent_id === parent)
      if (!f) {
        const order = Math.max(-1, ...folderList.filter((x) => x.parent_id === parent).map((x) => x.order_index)) + 1
        const ins: { data: unknown; error: Error | null } = await supabase.from('team_folders')
          .insert({ team_id: teamId, parent_id: parent, name, created_by: user.id, order_index: order }).select('id').single()
        if (ins.error) throw ins.error
        f = { id: (ins.data as { id: string }).id, name, parent_id: parent, order_index: order }
        folderList.push(f)
        report.folders++
        log('ok', 'folder', { path: path.slice(0, path.indexOf(name) + 1).join(' › ') })
      }
      parent = f.id
    }
    return parent!
  }

  const bytesTotal = sections.reduce((n, s) => n + s.bytes, 0)
  const pagesTotal = sections.reduce((n, s) => n + s.pages, 0)
  let bytesDone = 0, pagesDone = 0
  log('step', 'start', { sections: sections.length, pages: pagesTotal, bytes: bytesTotal })
  /** Bytes of the sections finished so far: progress inside a section never runs past its own share. */
  let bytesSectionsDone = 0
  const report$ = (i: number, current: string) =>
    onProgress({ phase: 'import', section: i, sections: sections.length, current, pagesDone, pagesTotal, bytesDone, bytesTotal })

  // Files already in storage: what existing pages show, plus what this run sent.
  // Older versions show mostly the same files as the page, so without this every
  // version sent every file again (rejected as a duplicate, but transferred first).
  const present = new Set<string>()
  for (const r of existing.values()) for (const path of storagePathsIn(r.content)) present.add(path)
  for (let si = 0; si < sections.length; si++) {
    const s = sections[si]
    report$(si, s.relPath)
    if (opts.shouldStop?.()) { stopped = true; log('warn', 'stopped', { done: si, total: sections.length }); break }
    const tSection = performance.now()
    log('step', 'sectionStart', { section: s.relPath, n: si + 1, total: sections.length })
    // Files this run put into storage for this section, and whether any row made it:
    // if nothing was written, the files would be orphans — take them back out.
    const uploadedPaths: string[] = []
    const bytesBefore = report.uploadedBytes
    let wroteRows = false
    try {
      // 1) the section's folder, inside its section group(s)
      const folderId = await ensureFolder([...(s.groupPath ?? []), s.name])

      const tConvert = performance.now()
      const out = await convertSection(s.file)
      const pages = readSection(out)
      log('ok', 'converted', { section: s.relPath, pages: pages.length }, performance.now() - tConvert)
      if (out.failedPages) {
        report.unreadable.push({ section: s.relPath, pages: out.failedPages, versionHistory: out.versionHistoryPages })
        log('warn', 'unreadable', { section: s.relPath, n: out.failedPages })
      }
      else if (out.error) report.errors.push(`${s.relPath}: ${out.error}`)
      const inserts: Row[] = []
      const updates: Row[] = []
      /** Rows that only need their bookkeeping columns fixed (ref format, missing hash). */
      const metaFixes = new Map<string, { source_ref?: string; source_hash?: string; parent_page_id?: string | null; folder_id?: string | null; order_index?: number }>()
      /** Older states to add to version histories, with the files they show. */
      const versionRows: { row: VersionRow; files: PlacedFile[] }[] = []
      const now = new Date().toISOString()

      // 2) an earlier import made the section a page: its pages move into the folder (below)
      const secRef = `section:${s.relPath}`
      const secOld = existing.get(secRef)

      const upload = async (list: PlacedFile[], title: string) => {
        const skipped = await uploadAll(list, (b) => { bytesDone = Math.min(bytesDone + b, bytesSectionsDone + s.bytes); report$(si, `${s.relPath} › ${title}`) }, report, uploadedPaths, present,
          (f, ms) => log('upload', 'upload', { name: f.name, bytes: f.bytes.length }, ms))
        for (const f of skipped) report.skippedFiles.push({ page: title, name: f.name, bytes: f.bytes.length })
      }

      // 3) pages, parents from the indent levels; level 1 sits in the section's folder
      const ROOT = ''
      const stack: string[] = [ROOT]
      const siblings = new Map<string, number>()
      for (const p of pages) {
        stopCheck()
        // A page's GUID is only unique inside its section: sections made from the
        // same OneNote template share page GUIDs. The first imports used the bare
        // GUID — such a row is adopted when it hangs under this very section.
        const ref = `${s.relPath}::${p.ref}`
        let oldRow = existing.get(ref)
        if (!oldRow) {
          const legacy = existing.get(p.ref)
          if (legacy && sectionOf(legacy) === secRef) { oldRow = legacy; metaFixes.set(legacy.id, { ...metaFixes.get(legacy.id), source_ref: ref }) }
        }
        const id = oldRow?.id ?? crypto.randomUUID()
        const level = Math.max(1, Math.min(p.level, stack.length))
        const parent = stack[level - 1]
        stack.length = level
        stack.push(id)
        const order = siblings.get(parent) ?? 0
        siblings.set(parent, order + 1)
        // A page hangs either in the folder (level 1) or under its parent page.
        const parentPage = parent === ROOT ? null : parent
        const pageFolder = parent === ROOT ? folderId : null
        const placed = (r: { parent_page_id: string | null; folder_id: string | null }) => r.parent_page_id === parentPage && r.folder_id === pageFolder

        const { markdown, files } = await placeAssets(p, user.id, id)
        const hash = await sha256(new TextEncoder().encode(`${p.title}\n${markdown}`))
        const row: Row = { id, team_id: teamId, folder_id: pageFolder, parent_page_id: parentPage, title: p.title, content: markdown, order_index: order,
          created_by: user.id, created_at: p.createdAt ?? now, updated_at: p.updatedAt ?? p.createdAt ?? now, source: 'onenote', source_ref: ref, source_hash: hash }
        // A version is identified by its content; a page that returned to an
        // earlier text (A → B → A) gets the later copy keyed by its time too
        // (one row per page and ref — page_versions_source_ref_uq).
        const seenStates = new Set<string>()
        const asVersion = (title: string, content: string, author: string | null, at: string | null, h: string): VersionRow | null => {
          let key = `${ref}@${h.slice(0, 16)}`
          if (seenStates.has(key)) key += `@${at ?? now}`
          if (seenStates.has(key)) return null // same text at the same time: nothing new
          seenStates.add(key)
          return { page_id: id, team_id: teamId, title, content, author_name: author, saved_at: at ?? now, source: 'onenote', source_ref: key }
        }

        // Edited in Fira since the last import (its text no longer matches the
        // imported hash): never overwrite. OneNote's newer state goes to history.
        const editedInFira = !!oldRow?.source_hash && (await sha256(new TextEncoder().encode(`${oldRow.title}\n${oldRow.content}`))) !== oldRow.source_hash
        if (oldRow && editedInFira) {
          // The text is theirs to keep; where the page sits in OneNote is not.
          if (!placed(oldRow) || oldRow.order_index !== order) metaFixes.set(id, { ...metaFixes.get(id), parent_page_id: parentPage, folder_id: pageFolder, order_index: order })
          if (hash !== oldRow.source_hash) {
            const v = asVersion(p.title, markdown, p.author, p.updatedAt, hash)
            if (v) versionRows.push({ row: v, files })
            report.kept.push(`${s.relPath} › ${p.title}`)
          } else report.unchanged++
        } else if (oldRow && oldRow.title === row.title && oldRow.content === row.content && placed(oldRow)) {
          report.unchanged++
          bytesDone = Math.min(bytesDone + files.reduce((n, f) => n + f.bytes.length, 0), bytesSectionsDone + s.bytes)
          if (!oldRow.source_hash) metaFixes.set(id, { ...metaFixes.get(id), source_hash: hash })
          if (oldRow.order_index !== order) metaFixes.set(id, { ...metaFixes.get(id), order_index: order })
        } else {
          // (an update keeps the replaced text as a version — the page trigger does that)
          await upload(files, p.title)
          ;(oldRow ? updates : inserts).push(row)
        }

        // The page's earlier states from the file → version history (lossless import).
        for (const rev of p.history) {
          const placed = await placeAssets(rev, user.id, id)
          const h = await sha256(new TextEncoder().encode(`${rev.title}\n${placed.markdown}`))
          const v = asVersion(rev.title, placed.markdown, rev.author, rev.updatedAt ?? rev.createdAt, h)
          if (v) versionRows.push({ row: v, files: placed.files })
        }
        pagesDone++
        report$(si, `${s.relPath} › ${p.title}`)
      }

      // 4) write: new rows in chunks (parents come before children in this order), then changed rows
      stopCheck()
      const tWrite = performance.now()
      for (const chunk of chunkRows(inserts)) {
        const { error } = await supabaseBulk.from('pages').insert(chunk)
        if (error) throw error
        wroteRows = true
        report.created += chunk.length
      }
      for (const r of updates) {
        const { error } = await supabaseBulk.from('pages')
          .update({ title: r.title, content: r.content, parent_page_id: r.parent_page_id, folder_id: r.folder_id, order_index: r.order_index, source_ref: r.source_ref, source_hash: r.source_hash || null })
          .eq('id', r.id)
        if (error) throw error
        wroteRows = true
        report.updated++
      }
      if (inserts.length) log('write', 'wrotePages', { n: inserts.length }, performance.now() - tWrite)
      if (updates.length) log('write', 'updatedPages', { n: updates.length })
      // Adopted / unchanged rows still get the new ref and the import hash.
      const updatedIds = new Set(updates.map((r) => r.id))
      for (const [id, fix] of metaFixes) {
        if (updatedIds.has(id)) continue
        const { error } = await supabaseBulk.from('pages').update(fix).eq('id', id)
        if (error) throw error
      }
      // The old section page (imports before folders): anything still under it
      // (pages removed from OneNote but kept here) moves into the folder too;
      // then an empty section page goes, one with text of its own stays in the folder.
      if (secOld) {
        const { error: mvErr } = await supabaseBulk.from('pages').update({ parent_page_id: null, folder_id: folderId }).eq('parent_page_id', secOld.id)
        if (mvErr) throw mvErr
        if (!secOld.content.trim()) {
          const { error: delErr } = await supabaseBulk.from('pages').delete().eq('id', secOld.id)
          if (delErr) throw delErr
        } else {
          const { error: upErr } = await supabaseBulk.from('pages').update({ parent_page_id: null, folder_id: folderId, source_ref: `${secRef}#kept` }).eq('id', secOld.id)
          if (upErr) throw upErr
        }
        wroteRows = true
      }
      // Version history: skip states a previous import already added.
      const have = new Set<string>()
      const pageIds = [...new Set(versionRows.map((v) => v.row.page_id))]
      for (let i = 0; i < pageIds.length; i += 60) {
        const { data, error } = await supabase.from('page_versions').select('page_id, source_ref').in('page_id', pageIds.slice(i, i + 60)).eq('source', 'onenote')
        if (error) throw error
        for (const v of data ?? []) have.add(`${v.page_id}|${v.source_ref}`)
      }
      const fresh = versionRows.filter((v) => !have.has(`${v.row.page_id}|${v.row.source_ref}`))
      for (const v of fresh) await upload(v.files, v.row.title)
      const tVersions = performance.now()
      for (const chunk of chunkRows(fresh.map((v) => v.row))) {
        const { error } = await supabaseBulk.from('page_versions').insert(chunk)
        if (error) throw error
        report.versions += chunk.length
      }
      if (fresh.length) log('write', 'versions', { n: fresh.length }, performance.now() - tVersions)
      log('ok', 'sectionDone', { section: s.relPath }, performance.now() - tSection)
    } catch (e) {
      if (e instanceof ImportStopped) stopped = true
      else {
        report.errors.push(`${s.relPath}: ${(e as Error)?.message ?? String(e)}`)
        log('error', 'sectionFailed', { section: s.relPath, error: (e as Error)?.message ?? String(e) })
      }
      if (!wroteRows && uploadedPaths.length) {
        for (let i = 0; i < uploadedPaths.length; i += 100) await supabase.storage.from(BUCKET).remove(uploadedPaths.slice(i, i + 100))
        report.uploaded -= uploadedPaths.length
        report.uploadedBytes = bytesBefore
        for (const path of uploadedPaths) present.delete(path)
      }
    }
    if (stopped) { log('warn', 'stopped', { done: si, total: sections.length }); break }
    bytesSectionsDone += s.bytes
    bytesDone = bytesSectionsDone
    report$(si + 1, '')
  }
  if (!stopped) log('ok', 'finished', { created: report.created, updated: report.updated, unchanged: report.unchanged }, performance.now() - t0)
  return { ...report, stopped }
}

// ── assets ──────────────────────────────────────────────────────────────────

interface PlacedFile { name: string; bytes: Uint8Array; path: string; url: string; image: boolean }

/** Storage keys allow a narrow character set; OneNote names carry Turkish letters and emoji. */
const storageSafe = (name: string) => {
  const ext = /\.[a-z0-9]{1,5}$/i.exec(name)?.[0] ?? ''
  const stem = name.slice(0, name.length - ext.length).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `${stem || 'dosya'}${ext.toLowerCase()}`
}

/**
 * Decides where each file goes and puts the URLs into the markdown. The path is
 * the page id plus a hash of the bytes: the same file always lands on the same
 * path (a re-import uploads nothing), and a different file never reuses a path
 * (an index-based name could point at the previous revision's picture).
 */
async function placeAssets(p: Pick<OneNotePage, 'markdown' | 'assets'>, userId: string, pageId: string): Promise<{ markdown: string; files: PlacedFile[] }> {
  const hashes = await Promise.all(p.assets.map((a) => sha256(a.bytes)))
  const files: PlacedFile[] = p.assets.map((a, i) => {
    const path = `${userId}/${pageId}/${hashes[i].slice(0, 16)}-${storageSafe(a.name)}`
    const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    return { name: a.name, bytes: a.bytes, path, url, image: IMAGE_EXT.test(a.name) || sniff(a.bytes).startsWith('image/') }
  })
  const markdown = p.markdown.replace(ASSET_TOKEN_RE, (_m, n) => {
    const f = files[Number(n)]
    if (!f) return ''
    return f.bytes.length > MAX_UPLOAD_BYTES ? '#' : encodeURI(f.url)
  })
  // Say so in the page when a file could not come along.
  const missing = files.filter((f) => f.bytes.length > MAX_UPLOAD_BYTES)
  const note = missing.map((f) => `> ⚠ ${f.name} (${(f.bytes.length / 1048576).toFixed(1)} MB) aktarılmadı: dosya 25 MB sınırını aşıyor.`).join('\n')
  return { markdown: note ? `${markdown}\n\n${note}` : markdown, files }
}

/** Uploads with a few parallel requests; retries rate limits. Returns the files that were too big. */
async function uploadAll(files: PlacedFile[], onBytes: (b: number) => void, report: ImportReport, uploaded: string[], present: Set<string>,
  onFile?: (f: PlacedFile, ms: number) => void): Promise<PlacedFile[]> {
  const skipped = files.filter((f) => f.bytes.length > MAX_UPLOAD_BYTES)
  // Each path goes up once per run, and never when it is already there.
  const queue = files.filter((f) => f.bytes.length <= MAX_UPLOAD_BYTES && !present.has(f.path))
  queue.forEach((f) => present.add(f.path))
  skipped.forEach((f) => onBytes(f.bytes.length))
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const t = performance.now()
      await uploadOne(f)
      onFile?.(f, performance.now() - t)
      uploaded.push(f.path)
      report.uploaded++
      report.uploadedBytes += f.bytes.length
      onBytes(f.bytes.length)
    }
  }
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker))
  return skipped
}

async function uploadOne(f: PlacedFile) {
  const body = new Blob([f.bytes as BlobPart], { type: sniff(f.bytes, f.name) })
  for (let attempt = 0; ; attempt++) {
    const { error } = await supabase.storage.from(BUCKET).upload(f.path, body, { contentType: body.type, upsert: false })
    if (!error) return
    const msg = `${(error as { statusCode?: string }).statusCode ?? ''} ${error.message}`
    if (/Duplicate|already exists|409/i.test(msg)) return // an earlier, interrupted run put it there
    if (attempt < 4 && /429|Too Many|5\d\d|fetch/i.test(msg)) { await sleep(1500 * 2 ** attempt); continue }
    throw new Error(`${f.name}: ${error.message}`)
  }
}

/** Content type from the bytes (OneNote often drops the extension), then the name. */
function sniff(b: Uint8Array, name = ''): string {
  const h = (i: number) => b[i]
  if (h(0) === 0x89 && h(1) === 0x50 && h(2) === 0x4e && h(3) === 0x47) return 'image/png'
  if (h(0) === 0xff && h(1) === 0xd8) return 'image/jpeg'
  if (h(0) === 0x47 && h(1) === 0x49 && h(2) === 0x46) return 'image/gif'
  if (h(0) === 0x25 && h(1) === 0x50 && h(2) === 0x44 && h(3) === 0x46) return 'application/pdf'
  if (h(0) === 0x3c && (h(1) === 0x73 || h(1) === 0x3f)) return 'image/svg+xml'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const byExt: Record<string, string> = {
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', csv: 'text/csv', txt: 'text/plain',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    doc: 'application/msword', xls: 'application/vnd.ms-excel', emf: 'image/emf', mp4: 'video/mp4', zip: 'application/zip',
  }
  return byExt[ext] ?? 'application/octet-stream'
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}


function chunkRows<T>(rows: T[]): T[][] {
  const out: T[][] = []
  let cur: T[] = [], size = 0
  for (const r of rows) {
    const s = JSON.stringify(r).length
    if (cur.length && size + s > REST_CHUNK_BYTES) { out.push(cur); cur = []; size = 0 }
    cur.push(r); size += s
  }
  if (cur.length) out.push(cur)
  return out
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Lets the progress bar paint between sections (conversion blocks the thread). */
const tick = () => new Promise((r) => setTimeout(r, 0))

/** Storage paths (bucket-relative) of the files a page's markdown links to. */
function storagePathsIn(markdown: string): string[] {
  const out: string[] = []
  for (const m of markdown.matchAll(new RegExp(`/object/public/${BUCKET}/([^)\s"'<>]+)`, 'g'))) {
    try { out.push(decodeURI(m[1])) } catch { /* not a path we wrote */ }
  }
  return out
}
