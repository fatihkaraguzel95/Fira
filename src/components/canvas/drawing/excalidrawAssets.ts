/**
 * Excalidraw loads its fonts from `window.EXCALIDRAW_ASSET_PATH`, with a public
 * CDN (esm.sh) as the second source of every font. The fonts are served from
 * this site (vite.config: excalidrawFonts copies them to `/excalidraw-assets/`),
 * so the CDN is never needed — but Chrome checks every `src` of a FontFace
 * against the CSP (font-src 'self') when the face is created and logged a
 * blocked-font error for each of the hundreds of faces, although the first
 * source loaded fine. The CDN source is dropped before the face is made.
 *
 * Imported by the canvas frame (CanvasView), one chunk before Excalidraw's own:
 * the package reads the path when its chunk runs.
 */
const w = window as unknown as { EXCALIDRAW_ASSET_PATH?: string; FontFace: typeof FontFace & { firaNoCdn?: boolean } }
w.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/'

if (!w.FontFace.firaNoCdn) {
  const Native = w.FontFace
  const Patched = function (family: string, source: string | BufferSource, descriptors?: FontFaceDescriptors) {
    const src = typeof source === 'string' && source.includes('esm.sh/')
      ? source.split(/,\s*(?=url\()/).filter((part) => !part.includes('esm.sh/')).join(', ') || source
      : source
    return new Native(family, src, descriptors)
  } as unknown as typeof FontFace & { firaNoCdn?: boolean }
  Patched.prototype = Native.prototype
  Patched.firaNoCdn = true
  w.FontFace = Patched
}

export {}
