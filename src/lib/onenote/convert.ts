/**
 * OneNote section (.one) → HTML pages + assets, in the browser.
 *
 * The engine is Joplin's OneNote converter (Rust → WebAssembly, MPL-2.0),
 * vendored with Fira patches in tools/onenote-converter and built into ./pkg.
 * Upstream reads and writes with Node's fs; our build routes those calls to
 * parser-utils/fira_fs.js, an in-memory filesystem the caller fills and reads.
 * Rebuild: see tools/onenote-converter/FIRA.md.
 *
 * The converter runs in a Web Worker (convert.worker.ts), so a long import does
 * not freeze the page (#684A9085). If a worker cannot start, it runs here.
 */
import ConvertWorker from './convert.worker?worker'
import type { ConvertRequest, ConvertResponse } from './convert.worker'

interface Vfs {
  inputs: Map<string, Uint8Array>
  outputs: Map<string, Uint8Array>
  dirs: Set<string>
}
declare global {
  // eslint-disable-next-line no-var
  var __firaOneNoteFs: Vfs | undefined
}

export interface SectionOutput {
  /** Table of contents: page order and indent level. */
  toc: string | null
  /** page file name → HTML */
  pages: Map<string, string>
  /** Older states per page, by the page's position in the table of contents
   *  (Fira converter patch: __fira_rev__<order>__<k>.html, k = 0 newest). */
  history: Map<number, string[]>
  /** asset file name → bytes (images, embedded files) */
  assets: Map<string, Uint8Array>
  /** The converter reports failed pages after writing the rest; kept, not thrown. */
  error: string | null
  /** Pages the converter could not read (counted from its error report). */
  failedPages: number
  /** …of which are stored as OneNote version history (object type 0x20046) — a
   *  section re-saved by a recent OneNote. The converter cannot read those. */
  versionHistoryPages: number
}

const decoder = new TextDecoder()

// ── worker ──────────────────────────────────────────────────────────────────
let worker: Worker | null = null
let workerBroken = false
let nextId = 1
const waiting = new Map<number, (r: ConvertResponse) => void>()

function getWorker(): Worker | null {
  if (worker || workerBroken) return worker
  try {
    worker = new ConvertWorker()
    worker.onmessage = (e: MessageEvent<ConvertResponse>) => { waiting.get(e.data.id)?.(e.data); waiting.delete(e.data.id) }
    worker.onerror = () => {
      // A worker that cannot load (old browser, CSP): the rest of this session converts on the main thread.
      workerBroken = true; worker?.terminate(); worker = null
      for (const [id, done] of waiting) done({ id, outputs: [], error: null, fatal: 'worker' })
      waiting.clear()
    }
  } catch {
    workerBroken = true
  }
  return worker
}

async function convertInWorker(file: File): Promise<{ outputs: [string, Uint8Array][]; error: string | null } | null> {
  const w = getWorker()
  if (!w) return null
  const bytes = await file.arrayBuffer()
  const id = nextId++
  const res = await new Promise<ConvertResponse>((resolve) => {
    waiting.set(id, resolve)
    w.postMessage({ id, fileName: file.name, bytes } satisfies ConvertRequest, [bytes])
  })
  if (res.fatal) { workerBroken = true; return null }
  return { outputs: res.outputs, error: res.error }
}

// ── main-thread fallback ────────────────────────────────────────────────────
let ready: Promise<{ convert: (input: string, out: string, base: string) => void }> | null = null
const loadHere = () => (ready ??= (async () => {
  const [{ default: init, oneNoteConverter }, { default: wasmUrl }] = await Promise.all([import('./pkg/renderer.js'), import('./pkg/renderer_bg.wasm?url')])
  await init({ module_or_path: wasmUrl })
  return { convert: oneNoteConverter }
})())

async function convertHere(file: File): Promise<{ outputs: [string, Uint8Array][]; error: string | null }> {
  const { convert } = await loadHere()
  const input = `/in/${file.name}`
  const vfs: Vfs = { inputs: new Map(), outputs: new Map(), dirs: new Set(['/in', '/out']) }
  vfs.inputs.set(input, new Uint8Array(await file.arrayBuffer()))
  globalThis.__firaOneNoteFs = vfs
  let error: string | null = null
  try {
    convert(input, '/out', '/in')
  } catch (e) {
    error = String((e as Error)?.message ?? e).split('\n')[0]
  } finally {
    globalThis.__firaOneNoteFs = undefined
  }
  return { outputs: [...vfs.outputs.entries()], error }
}

/** Converts one section. One at a time: the worker (and the fallback's filesystem) is a single instance. */
export async function convertSection(file: File): Promise<SectionOutput> {
  const res = (await convertInWorker(file)) ?? (await convertHere(file))
  const name = file.name.replace(/\.one$/i, '')
  const out: SectionOutput = { toc: null, pages: new Map(), history: new Map(), assets: new Map(), error: res.error, failedPages: 0, versionHistoryPages: 0 }
  const dir = `/out/${name}/`
  for (const [path, bytes] of res.outputs) {
    if (/\/Errors\.html$/.test(path)) {
      const report = decoder.decode(bytes)
      out.failedPages = (report.match(/Failed to parse page/g) ?? []).length
      out.versionHistoryPages = (report.match(/unexpected object type: 0x20046/g) ?? []).length
    } else if (path === `/out/${name}.html`) out.toc = decoder.decode(bytes)
    else if (path.startsWith(dir)) {
      const base = path.slice(dir.length)
      if (base.includes('/')) continue
      const rev = /^__fira_rev__(\d+)__(\d+)\.html$/.exec(base)
      if (rev) {
        const list = out.history.get(Number(rev[1])) ?? []
        list[Number(rev[2])] = decoder.decode(bytes)
        out.history.set(Number(rev[1]), list)
      } else if (base.endsWith('.html')) out.pages.set(base, decoder.decode(bytes))
      else out.assets.set(base, bytes)
    }
  }
  return out
}
