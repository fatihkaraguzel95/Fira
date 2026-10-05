import './excalidrawAssets'
import '@excalidraw/excalidraw/index.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Excalidraw, MainMenu, WelcomeScreen, CaptureUpdateAction, THEME,
  reconcileElements, restoreElements, hashElementsVersion,
} from '@excalidraw/excalidraw'
import type { AppState, BinaryFileData, BinaryFiles, Collaborator, DataURL, ExcalidrawImperativeAPI, SocketId } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement, FileId, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile'
import { CanvasSession, fetchScene, type SceneFile } from '../../../lib/canvas/session'
import { dataUrlToBlob, fetchAsDataUrl, uploadCanvasFile } from '../../../lib/canvas/files'
import { markHandled } from '../../../lib/keys'
import { emitError } from '../../../lib/errorToast'
import { friendlyError } from '../../../lib/errorMessage'
import { useTheme } from '../../../hooks/useTheme'
import { useLang, useT } from '../../../i18n'
import { CanvasLoading } from '../CanvasView'
import type { CanvasProps } from '../types'

const LANG_CODE = { tr: 'tr-TR', en: 'en', de: 'de-DE' } as const
const DEFAULT_BG = '#ffffff'

/**
 * The drawing (096, beta): Excalidraw itself (MIT), with Fira as its backend.
 *
 * - Load: the stored scene; images come from storage and are handed to
 *   Excalidraw as data URLs.
 * - Save: `onChange` fires on every pointer move, so changes are found by
 *   version — an element whose version is above the last one seen is new or
 *   changed here, and goes to the session (broadcast + save).
 * - Remote: elements from others are merged with Excalidraw's own
 *   `reconcileElements` and applied without entering this user's undo stack.
 */
export default function DrawingCanvas(p: CanvasProps) {
  const t = useT()
  const lang = useLang()
  const { isDark } = useTheme()
  const [initial, setInitial] = useState<{ elements: OrderedExcalidrawElement[]; bg: string; files: Record<string, SceneFile> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [others, setOthers] = useState(0)

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const sessionRef = useRef<CanvasSession<ExcalidrawElement> | null>(null)
  const propsRef = useRef(p); propsRef.current = p
  /** Last version seen per element (here or from others): anything above it is a local change. */
  const known = useRef(new Map<string, number>())
  const lastHash = useRef<number | null>(null)
  const lastBg = useRef<string | null>(null)
  /** Files that are in storage (id → address), and those being uploaded now. */
  const stored = useRef(new Map<string, SceneFile>())
  const uploading = useRef(new Set<string>())
  const loadedFiles = useRef(new Set<string>())
  const queuedRemote = useRef<ExcalidrawElement[]>([])
  const collaborators = useRef(new Map<SocketId, Collaborator>())
  const collabFrame = useRef(0)

  // ── Applying what others did ─────────────────────────────────────────────
  const applyRemote = useCallback((remote: ExcalidrawElement[]) => {
    const api = apiRef.current
    if (!api) { queuedRemote.current.push(...remote); return }
    const incoming = restoreElements(remote, null, { refreshDimensions: false, repairBindings: false }) as unknown as RemoteExcalidrawElement[]
    const merged = reconcileElements(api.getSceneElementsIncludingDeleted(), incoming, api.getAppState())
    for (const el of incoming) {
      const k = known.current.get(el.id)
      if (k === undefined || el.version > k) known.current.set(el.id, el.version)
    }
    api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER })
  }, [])

  const loadFiles = useCallback(async (files: Record<string, SceneFile>) => {
    const api = apiRef.current
    if (!api) return
    const todo = Object.values(files).filter((f) => f && f.url && !loadedFiles.current.has(f.id))
    for (const f of todo) { stored.current.set(f.id, f); loadedFiles.current.add(f.id) }
    const results = await Promise.all(todo.map(async (f): Promise<BinaryFileData | null> => {
      try {
        return { id: f.id as FileId, mimeType: f.mimeType as BinaryFileData['mimeType'], dataURL: (await fetchAsDataUrl(f.url)) as DataURL, created: f.created ?? Date.now() }
      } catch { loadedFiles.current.delete(f.id); return null }
    }))
    const ok = results.filter((r): r is BinaryFileData => !!r)
    if (ok.length) apiRef.current?.addFiles(ok)
  }, [])

  const pushCollaborators = useCallback(() => {
    if (collabFrame.current) return
    collabFrame.current = requestAnimationFrame(() => {
      collabFrame.current = 0
      apiRef.current?.updateScene({ collaborators: new Map(collaborators.current) })
    })
  }, [])

  /** Pull the stored scene again and merge it in (after a drop, a restore, a big paste by someone). */
  const resync = useCallback(async () => {
    try {
      const scene = await fetchScene(propsRef.current.pageId)
      applyRemote(scene.elements as ExcalidrawElement[])
      const bg = scene.settings.bg
      if (typeof bg === 'string' && bg !== lastBg.current && apiRef.current) {
        lastBg.current = bg
        apiRef.current.updateScene({ appState: { viewBackgroundColor: bg }, captureUpdate: CaptureUpdateAction.NEVER })
      }
      void loadFiles(scene.files)
    } catch { /* the next event or reconnect tries again */ }
  }, [applyRemote, loadFiles])

  // ── Session ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const session = new CanvasSession<ExcalidrawElement>(p.pageId, p.me, {
      onElements: (els) => applyRemote(els),
      onFiles: (files) => void loadFiles(files),
      onSettings: (patch) => {
        const bg = patch.bg
        if (typeof bg === 'string' && apiRef.current) {
          lastBg.current = bg
          apiRef.current.updateScene({ appState: { viewBackgroundColor: bg }, captureUpdate: CaptureUpdateAction.NEVER })
        }
      },
      onPeers: (peers) => {
        propsRef.current.onPeers(peers)
        setOthers(peers.filter((x) => !x.self).length)
        let changed = false
        for (const key of [...collaborators.current.keys()]) {
          if (!peers.some((x) => x.key === key)) { collaborators.current.delete(key); changed = true }
        }
        if (changed) pushCollaborators()
      },
      onCursor: (key, c) => {
        if (!c) collaborators.current.delete(key as SocketId)
        else collaborators.current.set(key as SocketId, {
          username: c.name,
          color: { background: c.color, stroke: c.color },
          pointer: { x: c.x, y: c.y, tool: c.tool === 'laser' ? 'laser' : 'pointer' },
          button: c.button === 'down' ? 'down' : 'up',
          id: c.uid,
          socketId: key as SocketId,
        })
        pushCollaborators()
      },
      onReload: (name) => { propsRef.current.onRemoteRestore(name); void resync() },
      onResync: () => void resync(),
      onSaveState: (s) => propsRef.current.onSaveState(s),
      onLive: (v) => propsRef.current.onLive(v),
    })
    sessionRef.current = session
    void session.connect()
    const onHide = () => session.flushOnUnload()
    const onVisibility = () => { if (document.visibilityState === 'hidden') void session.flush() }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      cancelAnimationFrame(collabFrame.current)
      session.dispose()
      sessionRef.current = null
    }
    // The session lives as long as the canvas; name / permission changes go through updateMe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pageId])
  useEffect(() => { sessionRef.current?.updateMe(p.me) }, [p.me])

  // ── First load ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setError(null)
    void (async () => {
      try {
        const scene = await fetchScene(p.pageId)
        if (cancelled) return
        const elements = restoreElements(scene.elements as ExcalidrawElement[], null, { refreshDimensions: false, repairBindings: true })
        known.current = new Map(elements.map((e) => [e.id, e.version]))
        for (const f of Object.values(scene.files)) stored.current.set(f.id, f)
        const bg = typeof scene.settings.bg === 'string' ? scene.settings.bg : DEFAULT_BG
        lastBg.current = bg
        propsRef.current.onEmptyChange(!elements.some((e) => !e.isDeleted))
        setInitial({ elements, bg, files: scene.files })
      } catch (e) {
        if (!cancelled) setError(friendlyError(e).title)
      }
    })()
    return () => { cancelled = true }
  }, [p.pageId, attempt])

  // This user restored a version: take it, then tell the others.
  useEffect(() => {
    if (!p.reloadToken) return
    void resync().then(() => sessionRef.current?.announceReload())
  }, [p.reloadToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const onApi = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api
    if (initial) void loadFiles(initial.files)
    if (queuedRemote.current.length) { const q = queuedRemote.current; queuedRemote.current = []; applyRemote(q) }
    sessionRef.current?.markReady()
  }, [initial, loadFiles, applyRemote])

  const upload = useCallback(async (f: BinaryFileData) => {
    uploading.current.add(f.id)
    try {
      const url = await uploadCanvasFile(propsRef.current.pageId, dataUrlToBlob(f.dataURL))
      const meta: SceneFile = { id: f.id, mimeType: f.mimeType, url, created: f.created }
      stored.current.set(f.id, meta)
      loadedFiles.current.add(f.id)
      sessionRef.current?.pushFiles({ [f.id]: meta })
    } catch (e) {
      emitError(e)
    } finally {
      uploading.current.delete(f.id)
    }
  }, [])

  const onChange = useCallback((elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    const session = sessionRef.current
    const canWrite = propsRef.current.canWrite
    const hash = hashElementsVersion(elements)
    if (hash !== lastHash.current) {
      lastHash.current = hash
      const changed: ExcalidrawElement[] = []
      for (const el of elements) {
        const k = known.current.get(el.id)
        if (k === undefined || el.version > k) { known.current.set(el.id, el.version); changed.push(el) }
      }
      if (changed.length && canWrite) session?.push(changed)
      propsRef.current.onEmptyChange(!elements.some((e) => !e.isDeleted))
    }
    if (!canWrite) return
    for (const [id, f] of Object.entries(files)) {
      if (!stored.current.has(id) && !uploading.current.has(id) && f.dataURL) void upload(f)
    }
    if (appState.viewBackgroundColor !== lastBg.current) {
      lastBg.current = appState.viewBackgroundColor
      session?.pushSettings({ bg: appState.viewBackgroundColor })
    }
  }, [upload])

  const onPointerUpdate = useCallback((payload: { pointer: { x: number; y: number; tool: 'pointer' | 'laser' }; button: 'down' | 'up' }) => {
    sessionRef.current?.moveCursor(payload.pointer.x, payload.pointer.y, { tool: payload.pointer.tool, button: payload.button })
  }, [])

  const initialData = useMemo(() => (initial ? {
    elements: initial.elements,
    appState: { viewBackgroundColor: initial.bg },
    scrollToContent: true,
  } : null), [initial])

  if (error) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
        <p className="text-sm text-fg-2">{t('canvas.loadFailed')}</p>
        <p className="text-xs text-fg-faint max-w-sm">{error}</p>
        <button onClick={() => setAttempt((n) => n + 1)} className="px-3 py-1.5 rounded-lg text-sm border border-line text-fg-2 hover:bg-raised">{t('canvas.retry')}</button>
      </div>
    )
  }
  if (!initialData) return <CanvasLoading />

  return (
    // Tuval odaktayken tuşlar Fira'nın tek harfli kısayollarına gitmesin (n = yeni görev!).
    <div className="absolute inset-0 fira-excalidraw" onKeyDownCapture={(e) => markHandled(e.nativeEvent)} data-drawing-canvas>
      <Excalidraw
        excalidrawAPI={onApi}
        initialData={initialData}
        onChange={onChange}
        onPointerUpdate={onPointerUpdate}
        isCollaborating={others > 0}
        viewModeEnabled={!p.canWrite}
        theme={isDark ? THEME.DARK : THEME.LIGHT}
        langCode={LANG_CODE[lang]}
        name={p.title}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: p.canWrite,
            clearCanvas: p.canWrite,
            export: { saveFileToDisk: true },
            loadScene: p.canWrite,
            saveToActiveFile: false,
            toggleTheme: null,
            saveAsImage: true,
          },
          tools: { image: p.canWrite },
        }}
      >
        <MainMenu>
          {p.canWrite && <MainMenu.DefaultItems.LoadScene />}
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.Help />
          {p.canWrite && <MainMenu.DefaultItems.ClearCanvas />}
          {p.canWrite && <MainMenu.Separator />}
          {p.canWrite && <MainMenu.DefaultItems.ChangeCanvasBackground />}
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Hints.MenuHint />
          <WelcomeScreen.Hints.ToolbarHint />
          <WelcomeScreen.Hints.HelpHint />
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Heading>{t('canvas.draw.welcome')}</WelcomeScreen.Center.Heading>
            <WelcomeScreen.Center.Menu>
              {p.canWrite && <WelcomeScreen.Center.MenuItemLoadScene />}
              <WelcomeScreen.Center.MenuItemHelp />
            </WelcomeScreen.Center.Menu>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </Excalidraw>
    </div>
  )
}
