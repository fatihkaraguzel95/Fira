/**
 * Runs the OneNote converter (WebAssembly) off the main thread (#684A9085: a
 * long import froze the page for seconds at a time, so nothing else could be
 * done while it ran). Input: one section's bytes; output: every file the
 * converter wrote, as [path, bytes] pairs (bytes are transferred, not copied).
 */
import init, { oneNoteConverter } from './pkg/renderer.js'
import wasmUrl from './pkg/renderer_bg.wasm?url'

interface Vfs { inputs: Map<string, Uint8Array>; outputs: Map<string, Uint8Array>; dirs: Set<string> }
export interface ConvertRequest { id: number; fileName: string; bytes: ArrayBuffer }
export interface ConvertResponse { id: number; outputs: [string, Uint8Array][]; error: string | null; fatal?: string }

let ready: Promise<unknown> | null = null
const scope = self as unknown as { __firaOneNoteFs?: Vfs; postMessage: (m: unknown, transfer: Transferable[]) => void; onmessage: ((e: MessageEvent<ConvertRequest>) => void) | null }

scope.onmessage = async (e) => {
  const { id, fileName, bytes } = e.data
  try {
    await (ready ??= init({ module_or_path: wasmUrl }))
    const input = `/in/${fileName}`
    const vfs: Vfs = { inputs: new Map([[input, new Uint8Array(bytes)]]), outputs: new Map(), dirs: new Set(['/in', '/out']) }
    scope.__firaOneNoteFs = vfs
    let error: string | null = null
    try {
      oneNoteConverter(input, '/out', '/in')
    } catch (err) {
      error = String((err as Error)?.message ?? err).split('\n')[0]
    } finally {
      scope.__firaOneNoteFs = undefined
    }
    // Each file on its own buffer (a view could share one, or sit on wasm memory), then handed over.
    const outputs = [...vfs.outputs.entries()].map(([p, b]) => [p, b.slice()] as [string, Uint8Array])
    scope.postMessage({ id, outputs, error } satisfies ConvertResponse, outputs.map(([, b]) => b.buffer as ArrayBuffer))
  } catch (err) {
    scope.postMessage({ id, outputs: [], error: null, fatal: String((err as Error)?.message ?? err) } satisfies ConvertResponse, [])
  }
}
