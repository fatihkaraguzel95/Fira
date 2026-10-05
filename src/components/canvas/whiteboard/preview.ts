import { sanitize, readSettings, type WbElement } from './model'
import { renderBoardSvg } from './io'

/** A stored whiteboard state as SVG markup — the version list's preview. Pictures inlined. */
export async function whiteboardPreviewSvg(elements: unknown[], settings: Record<string, unknown>): Promise<string> {
  const items = elements.map(sanitize).filter((e): e is WbElement => !!e && !e.isDeleted)
  const { svg } = await renderBoardSvg(items, readSettings(settings), { inline: true, padding: 24 })
  return svg
}
