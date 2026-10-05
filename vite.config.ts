import { defineConfig, type Plugin } from 'vite'
import type { OutputChunk } from 'rollup'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { cpSync, existsSync, readdirSync, createReadStream, statSync, readFileSync } from 'node:fs'
import { resolve, join, normalize } from 'node:path'

/**
 * Excalidraw's fonts (#cf0c7678). The package loads them from
 * `window.EXCALIDRAW_ASSET_PATH`, else from a public CDN that the CSP blocks
 * (font-src 'self'). So they are served from this site: copied into
 * `dist/excalidraw-assets/fonts` at build time, and from node_modules in dev.
 * Xiaolai (CJK, 13 MB in 209 files) stays out: it is only fetched for Chinese /
 * Japanese text, and then the system font takes over.
 */
const EXCALIDRAW_FONTS = resolve(process.cwd(), 'node_modules/@excalidraw/excalidraw/dist/prod/fonts')
const SKIP_FONTS = new Set(['Xiaolai'])
function excalidrawFonts(): Plugin {
  return {
    name: 'fira-excalidraw-fonts',
    configureServer(server) {
      server.middlewares.use('/excalidraw-assets/fonts/', (req, res, next) => {
        const file = normalize(join(EXCALIDRAW_FONTS, decodeURIComponent((req.url ?? '').split('?')[0])))
        if (!file.startsWith(EXCALIDRAW_FONTS) || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', 'font/woff2')
        createReadStream(file).pipe(res)
      })
    },
    writeBundle(options) {
      if (!existsSync(EXCALIDRAW_FONTS)) return
      const out = resolve(options.dir ?? 'dist', 'excalidraw-assets/fonts')
      for (const family of readdirSync(EXCALIDRAW_FONTS)) {
        if (!SKIP_FONTS.has(family)) cpSync(join(EXCALIDRAW_FONTS, family), join(out, family), { recursive: true })
      }
    },
  }
}

/**
 * Chunks that only a canvas (drawing / whiteboard, beta) reaches: Excalidraw
 * with its mermaid, katex, cytoscape … and the whiteboard. Found by walking the
 * import graph from the app entry without entering a canvas; whatever is left
 * is kept out of the service worker's precache, so the app update stays the
 * size it was for people who never open a canvas. They are cached on first use
 * (runtimeCaching below).
 */
const canvasOnly = new Set<string>()
const CANVAS_ROOT = /[\\/]components[\\/]canvas[\\/](drawing|whiteboard)[\\/]/
function canvasChunks(): Plugin {
  return {
    name: 'fira-canvas-chunks',
    apply: 'build',
    generateBundle(_options, bundle) {
      canvasOnly.clear()
      const chunks = Object.values(bundle).filter((c): c is OutputChunk => c.type === 'chunk')
      const byFile = new Map(chunks.map((c) => [c.fileName, c]))
      const reach = new Set<string>()
      const walk = (c: OutputChunk | undefined) => {
        if (!c || reach.has(c.fileName) || CANVAS_ROOT.test(c.facadeModuleId ?? '')) return
        reach.add(c.fileName)
        for (const f of [...c.imports, ...c.dynamicImports]) walk(byFile.get(f))
      }
      for (const c of chunks) if (c.isEntry) walk(c)
      for (const c of chunks) {
        if (reach.has(c.fileName)) continue
        canvasOnly.add(c.fileName)
        for (const css of (c as OutputChunk & { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata?.importedCss ?? []) canvasOnly.add(css)
      }
    },
  }
}

/** Sürüm package.json'dan (#74d303e2): APP_VERSION için bütün sürüm notlarının ana pakete girmesi gerekmesin. */
const APP_VERSION = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [
    react(),
    excalidrawFonts(),
    canvasChunks(),
    VitePWA({
      registerType: 'prompt', // UpdateBanner shows "Yeni sürüm hazır → Yenile"
      includeAssets: ['brand/fira-mark.png', 'brand/fira-wordmark.png', 'icons/favicon-16.png', 'icons/favicon-32.png', 'icons/favicon-48.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'fira — Ticket Yönetim',
        short_name: 'fira',
        description: 'Takımlar, listeler ve ticketlar: work · track · deliver',
        lang: 'tr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // Yüklü pencerede başlık çubuğunu uygulama çizsin (#0DD02686): üst çubuk
        // doğrudan o satıra oturur, pencere düğmeleri sağında kalır. Desteklemeyen
        // tarayıcı listedeki bir sonrakine ("standalone") düşer.
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        // Window/title-bar colour = the rail/top bar grey, so the strip behind
        // the window buttons matches Fira's own bar; the dark variant is applied
        // at runtime via <meta name="theme-color"> (useTheme, from --c-nav).
        background_color: '#ffffff',
        theme_color: '#edf1f6',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. The Supabase API (/api/*) is never cached or served offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Drawing / whiteboard (beta): fetched on first use, then served from the runtime cache.
        globIgnores: ['**/excalidraw-assets/**'],
        manifestTransforms: [async (entries) => ({ manifest: entries.filter((e) => !canvasOnly.has(e.url)), warnings: [] })],
        runtimeCaching: [
          {
            // Hashed build files never change under the same name.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/excalidraw-assets/')),
            handler: 'CacheFirst',
            options: { cacheName: 'fira-lazy', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 60 } },
          },
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // A worker told to skip waiting takes the open pages over at once, so the
        // banner's reload lands on the new build (#5A06299B).
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
})
