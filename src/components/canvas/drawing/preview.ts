import './excalidrawAssets'
import { exportToSvg, restoreElements } from '@excalidraw/excalidraw'
import type { BinaryFileData, BinaryFiles, DataURL } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement, FileId } from '@excalidraw/excalidraw/element/types'
import type { SceneFile } from '../../../lib/canvas/session'
import { fetchAsDataUrl } from '../../../lib/canvas/files'

/** A stored drawing as SVG markup — the version list's preview. */
export async function drawingPreviewSvg(elements: unknown[], files: Record<string, SceneFile>, settings: Record<string, unknown>): Promise<string> {
  const els = restoreElements(elements as ExcalidrawElement[], null, { refreshDimensions: false, repairBindings: false }).filter((e) => !e.isDeleted)
  const used = new Set(els.map((e) => (e as { fileId?: string | null }).fileId).filter(Boolean) as string[])
  const binary: BinaryFiles = {}
  await Promise.all(Object.values(files).filter((f) => used.has(f.id)).slice(0, 24).map(async (f) => {
    try {
      binary[f.id] = { id: f.id as FileId, mimeType: f.mimeType as BinaryFileData['mimeType'], dataURL: (await fetchAsDataUrl(f.url)) as DataURL, created: f.created ?? 0 }
    } catch { /* a missing picture shows as a placeholder */ }
  }))
  const svg = await exportToSvg({
    elements: els,
    appState: { viewBackgroundColor: typeof settings.bg === 'string' ? settings.bg : '#ffffff', exportBackground: true, exportWithDarkMode: false },
    files: binary,
    exportPadding: 24,
  })
  return svg.outerHTML
}
