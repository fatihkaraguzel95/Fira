import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { CanvasSession, fetchScene, preferRemote, randomNonce, type InkDelta, type RemoteCursor } from '../../../lib/canvas/session'
import { uploadCanvasFile, imageSize } from '../../../lib/canvas/files'
import { markHandled } from '../../../lib/keys'
import { emitError, emitToast } from '../../../lib/errorToast'
import { friendlyError } from '../../../lib/errorMessage'
import { snapshotScene } from '../../../hooks/useCanvas'
import { useT } from '../../../i18n'
import { CanvasLoading } from '../CanvasView'
import type { CanvasProps } from '../types'
import {
  DEFAULT_SETTINGS, FILL_COLORS, HIGHLIGHTER_COLORS, INK_COLORS, NOTE_COLORS, SHAPE_COLORS, SHAPE_KINDS, STAMPS, BG_COLORS,
  bottomZ, make, ordered, readSettings, sanitize, topZ,
  type ImageEl, type InkEl, type LineEl, type NoteEl, type PenKind, type ShapeEl, type ShapeKind, type StampEl, type TextEl, type WbElement, type WbSettings, type GridKind,
} from './model'
import { bounds, boxContains, boxFromPoints, boxesIntersect, center, hitTest, inLasso, inkTouchesSegment, localBox, rotate, unionBounds, type Box, type Pt } from './geometry'
import { roundPts, thinPoints } from './ink'
import { LINE_HEIGHT, NOTE_PAD, noteLayout, shapeTextLayout, textBlockSize, fontCss } from './text'
import { ElementView, GridPattern, InkView, WbDefs, shapePath } from './render'
import { History, type HistoryEntry } from './history'
import { buildTemplate, TEMPLATES, type TemplateId } from './templates'
import { Icon, MenuItem, PenGlyph, Popover, SectionLabel, Swatches, ToolButton } from './ui'
import { exportBoard, placeBundle, readImportFile, boardAsBundle, type ImportBundle } from './io'
import { BoardPicker } from './BoardPicker'
import { TimerPill, TimerStart } from './TimerWidget'
import { startTimer, type WbTimer } from './timer'
import { serverNow, syncServerClock } from '../../../lib/serverClock'
import { usePrefs, GLOBAL_SCOPE } from '../../../hooks/usePrefs'

type Tool = 'select' | 'lasso' | 'hand' | 'pen' | 'highlighter' | 'eraser' | 'note' | 'text' | 'shape' | 'stamp'
type ShapeTool = Exclude<ShapeKind, 'path'> | 'line' | 'arrowLine'
type PopoverId = 'pen' | 'highlighter' | 'eraser' | 'shape' | 'stamp' | 'template' | 'menu' | 'timer' | null
interface PenSlot { color: string; size: number; kind: PenKind }

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'ink'; el: InkEl; pts: number[]; sent: number }
  | { kind: 'move'; start: Pt; originals: WbElement[]; moved: boolean }
  | { kind: 'resize'; corner: number; originals: WbElement[]; single: WbElement | null; box0: Box; anchor: Pt; c0: Pt; angle: number }
  | { kind: 'rotate'; el0: WbElement; c: Pt; a0: number }
  | { kind: 'line-end'; el0: LineEl; end: 'start' | 'end' }
  | { kind: 'create'; shape: ShapeTool; start: Pt }
  | { kind: 'marquee'; start: Pt; additive: boolean; base: Set<string> }
  | { kind: 'lasso'; pts: Pt[] }
  | { kind: 'erase'; last: Pt; erased: Set<string> }

const MIN_ZOOM = 0.05
const MAX_ZOOM = 8
const HANDLE = 9
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
const isBoxType = (el: WbElement) => el.type === 'note' || el.type === 'text' || el.type === 'shape' || el.type === 'image' || el.type === 'stamp'
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const

/** Between boards in this tab: copy here, paste on another whiteboard. */
let clipboard: WbElement[] = []

export default function WhiteboardCanvas(p: CanvasProps) {
  const t = useT()
  const propsRef = useRef(p); propsRef.current = p
  const canWrite = p.canWrite

  // ── Document ─────────────────────────────────────────────────────────────
  const els = useRef(new Map<string, WbElement>())
  const [rev, setRev] = useState(0)
  const bumpRev = useCallback(() => setRev((r) => r + 1), [])
  const [settings, setSettings] = useState<WbSettings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const history = useRef(new History())
  const [, setHistoryTick] = useState(0)

  // ── View ─────────────────────────────────────────────────────────────────
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const viewRef = useRef(view); viewRef.current = view
  const [size, setSize] = useState({ w: 800, h: 600 })

  // ── Tools ────────────────────────────────────────────────────────────────
  const [tool, setToolState] = useState<Tool>('select')
  const toolRef = useRef(tool); toolRef.current = tool
  const [pens, setPens] = useState<PenSlot[]>([
    { color: INK_COLORS[0], size: 4, kind: 'plain' },
    { color: INK_COLORS[1], size: 4, kind: 'plain' },
    { color: INK_COLORS[2], size: 4, kind: 'plain' },
    { color: INK_COLORS[3], size: 5, kind: 'rainbow' },
  ])
  const [activePen, setActivePen] = useState(0)
  const [highlighter, setHighlighter] = useState({ color: HIGHLIGHTER_COLORS[0], size: 22 })
  const [shapeTool, setShapeTool] = useState<ShapeTool>('rect')
  const [stamp, setStamp] = useState(STAMPS[0])
  const [popover, setPopover] = useState<PopoverId>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const selectedRef = useRef(selected); selectedRef.current = selected
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftText, setDraftText] = useState('')
  const [showCursors, setShowCursors] = useState(true)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const importInput = useRef<HTMLInputElement>(null)

  // ── Interaction ──────────────────────────────────────────────────────────
  const drag = useRef<Drag | null>(null)
  /** Mirrors `drag` for rendering: the selection bar hides while something is being dragged. */
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<Map<string, WbElement> | null>(null)
  const [draft, setDraft] = useState<WbElement | null>(null)
  const [liveInk, setLiveInk] = useState<InkEl | null>(null)
  const [marquee, setMarquee] = useState<Box | null>(null)
  const [lasso, setLasso] = useState<Pt[] | null>(null)
  const [erasing, setErasing] = useState<Set<string>>(new Set())
  const [pointer, setPointer] = useState<Pt | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d0: number; mid0: Pt; view0: { x: number; y: number; zoom: number } } | null>(null)
  const inkFrame = useRef(0)

  // ── Collaboration ────────────────────────────────────────────────────────
  const session = useRef<CanvasSession<WbElement> | null>(null)
  // The timer counts against the server's clock; whether its sound plays is this person's own choice.
  useEffect(() => { void syncServerClock() }, [])
  const { prefs, patch: patchPrefs } = usePrefs(GLOBAL_SCOPE)
  const timerMuted = prefs.wbTimerMuted === true
  const [cursors, setCursors] = useState<Map<string, RemoteCursor>>(new Map())
  const [remoteInk, setRemoteInk] = useState<Map<string, InkEl>>(new Map())

  const setTool = useCallback((next: Tool) => {
    setToolState(next)
    setPopover(null)
    if (next !== 'select' && next !== 'lasso') setSelected(new Set())
  }, [])

  // ── Coordinates ──────────────────────────────────────────────────────────
  const toScene = useCallback((clientX: number, clientY: number): Pt => {
    const r = svgRef.current?.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - (r?.left ?? 0) - v.x) / v.zoom, y: (clientY - (r?.top ?? 0) - v.y) / v.zoom }
  }, [])
  const toScreen = useCallback((pt: Pt): Pt => {
    const v = viewRef.current
    return { x: pt.x * v.zoom + v.x, y: pt.y * v.zoom + v.y }
  }, [])

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const fitTo = useCallback((box: Box | null, maxZoom = 1) => {
    const el = wrapRef.current
    const w = el?.clientWidth ?? 800, h = el?.clientHeight ?? 600
    if (!box) { setView({ x: w / 2, y: h / 2, zoom: 1 }); return }
    const pad = 64
    const zoom = clampZoom(Math.min((w - pad * 2) / Math.max(1, box.w), (h - pad * 2) / Math.max(1, box.h), maxZoom))
    setView({ x: w / 2 - (box.x + box.w / 2) * zoom, y: h / 2 - (box.y + box.h / 2) * zoom, zoom })
  }, [])

  const zoomAt = useCallback((factor: number, sx?: number, sy?: number) => {
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor)
      const cx = sx ?? (wrapRef.current?.clientWidth ?? 0) / 2
      const cy = sy ?? (wrapRef.current?.clientHeight ?? 0) / 2
      return { zoom, x: cx - ((cx - v.x) * zoom) / v.zoom, y: cy - ((cy - v.y) * zoom) / v.zoom }
    })
  }, [])

  // ── Commit (local changes) ───────────────────────────────────────────────
  /** Store changed elements as new versions, send them, and (usually) make them undoable. */
  const commit = useCallback((changes: WbElement[], opts: { record?: boolean } = {}) => {
    if (!changes.length) return
    const entry: HistoryEntry = { before: new Map(), after: new Map() }
    const out: WbElement[] = []
    for (const ch of changes) {
      const prev = els.current.get(ch.id) ?? null
      const next = { ...ch, version: Math.max(ch.version ?? 0, prev?.version ?? 0) + 1, versionNonce: randomNonce(), updated: Date.now() } as WbElement
      if (!entry.before.has(ch.id)) entry.before.set(ch.id, prev)
      entry.after.set(ch.id, next)
      els.current.set(ch.id, next)
      out.push(next)
    }
    if (opts.record !== false) { history.current.record(entry); setHistoryTick((n) => n + 1) }
    session.current?.push(out)
    bumpRev()
  }, [bumpRev])

  const applyEntry = useCallback((entry: HistoryEntry, side: 'before' | 'after') => {
    const states = entry[side]
    const changes: WbElement[] = []
    for (const [id, state] of states) {
      const cur = els.current.get(id)
      if (state === null) { if (cur && !cur.isDeleted) changes.push({ ...cur, isDeleted: true }) }
      else changes.push({ ...state, version: Math.max(state.version, cur?.version ?? 0), isDeleted: state.isDeleted })
    }
    commit(changes, { record: false })
  }, [commit])

  const undo = useCallback(() => { const e = history.current.undo(); if (e) { applyEntry(e, 'before'); setHistoryTick((n) => n + 1); setSelected(new Set()) } }, [applyEntry])
  const redo = useCallback(() => { const e = history.current.redo(); if (e) { applyEntry(e, 'after'); setHistoryTick((n) => n + 1) } }, [applyEntry])

  // ── Remote ───────────────────────────────────────────────────────────────
  const applyRemote = useCallback((remote: WbElement[]) => {
    let changed = false
    const arrived: string[] = []
    for (const raw of remote) {
      const el = sanitize(raw)
      if (!el) continue
      if (preferRemote(els.current.get(el.id), el)) { els.current.set(el.id, el); changed = true; arrived.push(el.id) }
    }
    if (!changed) return
    // A finished stroke replaces its live preview.
    setRemoteInk((m) => {
      if (!m.size) return m
      const next = new Map(m)
      for (const [k, v] of m) if (arrived.includes(v.id)) next.delete(k)
      return next.size === m.size ? m : next
    })
    // Someone deleted what I had selected (or was editing).
    setSelected((s) => {
      const keep = [...s].filter((id) => els.current.get(id) && !els.current.get(id)!.isDeleted)
      return keep.length === s.size ? s : new Set(keep)
    })
    bumpRev()
  }, [bumpRev])

  const reloadFromServer = useCallback(async (replace: boolean) => {
    const scene = await fetchScene(propsRef.current.pageId)
    const list = (scene.elements as unknown[]).map(sanitize).filter((e): e is WbElement => !!e)
    if (replace) {
      for (const el of list) els.current.set(el.id, el)
      bumpRev()
    } else applyRemote(list)
    setSettings(readSettings(scene.settings))
  }, [applyRemote, bumpRev])

  useEffect(() => {
    const s = new CanvasSession<WbElement>(p.pageId, p.me, {
      onElements: (list) => applyRemote(list),
      onFiles: () => {},
      onSettings: (patch) => setSettings((cur) => readSettings({ ...(cur as unknown as Record<string, unknown>), ...patch })),
      onPeers: (peers) => {
        propsRef.current.onPeers(peers)
        setCursors((m) => {
          const keys = new Set(peers.map((x) => x.key))
          const next = new Map([...m].filter(([k]) => keys.has(k)))
          return next.size === m.size ? m : next
        })
      },
      onCursor: (key, c) => setCursors((m) => { const next = new Map(m); if (c) next.set(key, c); else next.delete(key); return next }),
      onInk: (key, d: InkDelta) => setRemoteInk((m) => {
        const next = new Map(m)
        const k = `${key}:${d.id}`
        if (d.done) { next.delete(k); return next }
        const cur = next.get(k)
        const style = (d.style ?? {}) as Partial<InkEl>
        const base: InkEl = cur ?? { id: d.id, type: 'ink', x: Number(style.x ?? 0), y: Number(style.y ?? 0), z: 0, pts: [], color: String(style.color ?? '#1f1f1f'), size: Number(style.size ?? 4), pen: (style.pen as InkEl['pen']) ?? 'plain', pressure: !!style.pressure, version: 0, versionNonce: 0 }
        const have = base.pts.length / 3
        const pts = d.from === have ? [...base.pts, ...d.pts] : d.from === 0 ? [...d.pts] : base.pts
        next.set(k, { ...base, pts })
        return next
      }),
      onReload: (name) => { propsRef.current.onRemoteRestore(name); void reloadFromServer(false) },
      onResync: () => void reloadFromServer(false),
      onSaveState: (st) => propsRef.current.onSaveState(st),
      onLive: (v) => propsRef.current.onLive(v),
    })
    session.current = s
    void s.connect()
    const onHide = () => s.flushOnUnload()
    const onVis = () => { if (document.visibilityState === 'hidden') void s.flush() }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVis)
      s.dispose()
      session.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pageId])
  useEffect(() => { session.current?.updateMe(p.me) }, [p.me])

  // First load.
  useEffect(() => {
    let cancelled = false
    setError(null)
    void (async () => {
      try {
        const scene = await fetchScene(p.pageId)
        if (cancelled) return
        const map = new Map<string, WbElement>()
        for (const raw of scene.elements) { const el = sanitize(raw); if (el) map.set(el.id, el) }
        els.current = map
        setSettings(readSettings(scene.settings))
        fitTo(unionBounds(map.values()), 1)
        setLoaded(true)
        bumpRev()
        session.current?.markReady()
      } catch (e) {
        if (!cancelled) setError(friendlyError(e).title)
      }
    })()
    return () => { cancelled = true }
  }, [p.pageId, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  // This user restored a version: take the server's copy, then tell the others.
  useEffect(() => {
    if (!p.reloadToken) return
    void reloadFromServer(true).then(() => session.current?.announceReload())
  }, [p.reloadToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => ordered(els.current.values()), [rev]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { propsRef.current.onEmptyChange(list.length === 0) }, [list.length])

  /** Only what is on screen is drawn once the board gets big. */
  const visible = useMemo(() => {
    if (list.length < 400) return list
    const v = view
    const pad = 200 / v.zoom
    const vb: Box = { x: -v.x / v.zoom - pad, y: -v.y / v.zoom - pad, w: size.w / v.zoom + pad * 2, h: size.h / v.zoom + pad * 2 }
    return list.filter((el) => boxesIntersect(bounds(el), vb) || selected.has(el.id))
  }, [list, view, size, selected])

  const byId = (id: string) => { const el = els.current.get(id); return el && !el.isDeleted ? el : null }
  const selectedEls = useMemo(() => [...selected].map((id) => preview?.get(id) ?? byId(id)).filter((e): e is WbElement => !!e), [selected, preview, rev]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Element helpers ──────────────────────────────────────────────────────
  const translate = (el: WbElement, dx: number, dy: number): WbElement => ({ ...el, x: el.x + dx, y: el.y + dy })

  const scaleAround = (el: WbElement, a: Pt, s: number): WbElement => {
    if (el.type === 'ink') {
      return { ...el, x: a.x + (el.x - a.x) * s, y: a.y + (el.y - a.y) * s, size: Math.max(0.5, el.size * s), pts: el.pts.map((v, i) => (i % 3 === 2 ? v : v * s)),
        outline: el.outline ? { d: el.outline.d, m: el.outline.m.map((v) => v * s) as InkEl['outline'] extends infer O ? O extends { m: infer M } ? M : never : never } : undefined }
    }
    if (el.type === 'line') return { ...el, x: a.x + (el.x - a.x) * s, y: a.y + (el.y - a.y) * s, dx: el.dx * s, dy: el.dy * s, strokeWidth: Math.max(1, el.strokeWidth * s) }
    const b = localBox(el)
    const c = center(b)
    const nc = { x: a.x + (c.x - a.x) * s, y: a.y + (c.y - a.y) * s }
    const w = b.w * s, h = b.h * s
    const base = { ...el, x: nc.x - w / 2, y: nc.y - h / 2 }
    switch (el.type) {
      case 'note': return { ...base, w, h, fontSize: el.fontSize ? el.fontSize * s : undefined } as NoteEl
      case 'text': return { ...base, w, fontSize: Math.max(4, el.fontSize * s) } as TextEl
      case 'shape': return { ...base, w, h, fontSize: el.fontSize ? el.fontSize * s : el.text ? 18 * s : undefined } as ShapeEl
      case 'image': return { ...base, w, h } as ImageEl
      case 'stamp': return { ...base, size: w } as StampEl
    }
    return el
  }

  // ── Selection frame and handles (screen coords) ──────────────────────────
  const frame = useMemo(() => {
    if (!selectedEls.length) return null
    const single = selectedEls.length === 1 ? selectedEls[0] : null
    if (single && single.type === 'line') {
      return { kind: 'line' as const, el: single, a: toScreen({ x: single.x, y: single.y }), b: toScreen({ x: single.x + single.dx, y: single.y + single.dy }) }
    }
    if (single && isBoxType(single)) {
      const b = localBox(single)
      const c = center(b)
      const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => toScreen(rotate({ x, y }, c, single.angle ?? 0)))
      const topMid = rotate({ x: c.x, y: b.y }, c, single.angle ?? 0)
      const out = rotate({ x: c.x, y: b.y - 28 / view.zoom }, c, single.angle ?? 0)
      return { kind: 'box' as const, el: single, corners, rot: toScreen(out), rotBase: toScreen(topMid), rotatable: true }
    }
    const u = unionBounds(selectedEls)!
    const corners = [[u.x, u.y], [u.x + u.w, u.y], [u.x + u.w, u.y + u.h], [u.x, u.y + u.h]].map(([x, y]) => toScreen({ x, y }))
    return { kind: 'box' as const, el: null, corners, rot: null, rotBase: null, rotatable: false }
  }, [selectedEls, view, toScreen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pointer ──────────────────────────────────────────────────────────────
  const topHit = (pt: Pt, tol: number): WbElement | null => {
    for (let i = list.length - 1; i >= 0; i--) if (hitTest(list[i], pt, tol)) return list[i]
    return null
  }

  const finishEditing = useCallback(() => {
    const id = editingIdRef.current
    if (!id) return
    const el = els.current.get(id)
    setEditingId(null)
    if (!el) return
    const text = draftRef.current
    if (el.type === 'text' && !text.trim()) { commit([{ ...el, isDeleted: true }], { record: el.version > 2 }); return }
    const cur = 'text' in el ? (el as TextEl).text ?? '' : ''
    if (text !== cur) commit([{ ...el, text } as WbElement])
  }, [commit])
  const editingIdRef = useRef(editingId); editingIdRef.current = editingId
  const draftRef = useRef(draftText); draftRef.current = draftText

  const startEditing = useCallback((el: WbElement) => {
    if (!canWrite || el.locked || !(el.type === 'note' || el.type === 'text' || el.type === 'shape')) return
    setSelected(new Set([el.id]))
    setDraftText((el as NoteEl | TextEl | ShapeEl).text ?? '')
    setEditingId(el.id)
  }, [canWrite])

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    pointerDown(e)
    setDragging(!!drag.current)
  }
  const pointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return
    // No mousedown after this: its default action would move focus to the board and
    // take it straight back from a note that has just opened for typing.
    e.preventDefault()
    wrapRef.current?.focus({ preventScroll: true })
    setPopover(null)
    if (editingId) finishEditing()
    // Two fingers: pinch and pan, whatever the tool.
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.current.size === 2) {
        cancelDrag()
        const [a, b] = [...touches.current.values()]
        pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y), mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view0: { ...viewRef.current } }
        return
      }
      if (touches.current.size > 2) return
    }
    svgRef.current?.setPointerCapture(e.pointerId)
    const pt = toScene(e.clientX, e.clientY)
    const v = viewRef.current
    const tol = 6 / v.zoom

    if (e.button === 1 || tool === 'hand' || spaceHeld) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y }
      return
    }
    if (!canWrite) {
      // Viewers: select to look, drag the board to move around.
      const hit = topHit(pt, tol)
      if (hit) setSelected(new Set([hit.id]))
      else { setSelected(new Set()); drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y } }
      return
    }
    // Pen's eraser end.
    const eraserEnd = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) === 32)
    const active = eraserEnd ? 'eraser' : tool

    if (active === 'pen' || active === 'highlighter') {
      const slot = pens[activePen]
      const hl = active === 'highlighter'
      const pressure = e.pointerType === 'pen'
      const el: InkEl = {
        id: makeId(), type: 'ink', x: pt.x, y: pt.y, z: topZ(els.current.values()) + 1,
        pts: [0, 0, pressure ? e.pressure || 0.5 : 0.5],
        color: hl ? highlighter.color : slot.color,
        size: hl ? highlighter.size : slot.size,
        pen: hl ? 'highlighter' : slot.kind,
        pressure, by: p.me.uid, version: 0, versionNonce: 0,
      }
      drag.current = { kind: 'ink', el, pts: el.pts.slice(), sent: 0 }
      setLiveInk(el)
      return
    }
    if (active === 'eraser') {
      drag.current = { kind: 'erase', last: pt, erased: new Set() }
      eraseAt(pt, pt)
      return
    }
    if (active === 'note') {
      const w = 220
      const el = make<NoteEl>({ type: 'note', x: pt.x - w / 2, y: pt.y - w / 2, w, h: w, color: NOTE_COLORS[0], text: '', by: p.me.uid, author: p.me.name }, topZ(els.current.values()) + 1)
      commit([el])
      setToolState('select')
      startEditing(el)
      return
    }
    if (active === 'text') {
      const el = make<TextEl>({ type: 'text', x: pt.x, y: pt.y - 14, w: 320, text: '', color: '#1f1f1f', fontSize: 24, by: p.me.uid }, topZ(els.current.values()) + 1)
      commit([el], { record: false })
      setToolState('select')
      startEditing(el)
      return
    }
    if (active === 'stamp') {
      const s = 72
      commit([make<StampEl>({ type: 'stamp', x: pt.x - s / 2, y: pt.y - s / 2, emoji: stamp, size: s, by: p.me.uid }, topZ(els.current.values()) + 1)])
      return
    }
    if (active === 'shape') {
      drag.current = { kind: 'create', shape: shapeTool, start: pt }
      return
    }
    if (active === 'lasso') {
      drag.current = { kind: 'lasso', pts: [pt] }
      setLasso([pt])
      return
    }

    // Select tool: handles first, then elements, then the empty board.
    if (frame) {
      const sp = { x: e.clientX - (svgRef.current?.getBoundingClientRect().left ?? 0), y: e.clientY - (svgRef.current?.getBoundingClientRect().top ?? 0) }
      const near = (q: Pt) => Math.hypot(q.x - sp.x, q.y - sp.y) <= HANDLE + (e.pointerType === 'touch' ? 8 : 0)
      if (frame.kind === 'line') {
        if (near(frame.a)) { drag.current = { kind: 'line-end', el0: frame.el, end: 'start' }; return }
        if (near(frame.b)) { drag.current = { kind: 'line-end', el0: frame.el, end: 'end' }; return }
      } else {
        const lockedSel = selectedEls.some((x) => x.locked)
        if (!lockedSel && frame.rot && near(frame.rot) && frame.el) {
          const b = localBox(frame.el)
          const c = center(b)
          drag.current = { kind: 'rotate', el0: frame.el, c, a0: Math.atan2(pt.y - c.y, pt.x - c.x) }
          return
        }
        const ci = lockedSel ? -1 : frame.corners.findIndex(near)
        if (ci >= 0) {
          const single = frame.el
          if (single) {
            const b = localBox(single)
            const c = center(b)
            const [sx, sy] = CORNERS[ci]
            const anchor = { x: sx < 0 ? b.x + b.w : b.x, y: sy < 0 ? b.y + b.h : b.y }
            drag.current = { kind: 'resize', corner: ci, originals: [single], single, box0: b, anchor, c0: c, angle: single.angle ?? 0 }
          } else {
            const u = unionBounds(selectedEls)!
            const [sx, sy] = CORNERS[ci]
            const anchor = { x: sx < 0 ? u.x + u.w : u.x, y: sy < 0 ? u.y + u.h : u.y }
            drag.current = { kind: 'resize', corner: ci, originals: selectedEls, single: null, box0: u, anchor, c0: center(u), angle: 0 }
          }
          return
        }
      }
    }
    const hit = topHit(pt, tol)
    if (hit) {
      let sel = selected
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        sel = new Set(selected)
        if (sel.has(hit.id)) sel.delete(hit.id); else sel.add(hit.id)
      } else if (!selected.has(hit.id)) sel = new Set([hit.id])
      setSelected(sel)
      const originals = [...sel].map(byId).filter((x): x is WbElement => !!x && !x.locked)
      if (originals.length) drag.current = { kind: 'move', start: pt, originals, moved: false }
      return
    }
    drag.current = { kind: 'marquee', start: pt, additive: e.shiftKey, base: e.shiftKey ? new Set(selected) : new Set() }
    if (!e.shiftKey) setSelected(new Set())
  }

  const makeId = () => make<StampEl>({ type: 'stamp', x: 0, y: 0, emoji: '', size: 0 }, 0).id

  const eraseAt = (a: Pt, b: Pt) => {
    const d = drag.current
    if (!d || d.kind !== 'erase') return
    const r = 9 / viewRef.current.zoom
    let changed = false
    for (const el of list) {
      if (el.type !== 'ink' || el.locked || d.erased.has(el.id)) continue
      if (inkTouchesSegment(el, a, b, r)) { d.erased.add(el.id); changed = true }
    }
    if (changed) setErasing(new Set(d.erased))
  }

  const cancelDrag = () => {
    drag.current = null
    setDragging(false)
    setLiveInk(null); setPreview(null); setDraft(null); setMarquee(null); setLasso(null); setErasing(new Set())
  }

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pinch.current && touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        const r = svgRef.current?.getBoundingClientRect()
        const mid = { x: (a.x + b.x) / 2 - (r?.left ?? 0), y: (a.y + b.y) / 2 - (r?.top ?? 0) }
        const mid0 = { x: pinch.current.mid0.x - (r?.left ?? 0), y: pinch.current.mid0.y - (r?.top ?? 0) }
        const v0 = pinch.current.view0
        const zoom = clampZoom(v0.zoom * (d / (pinch.current.d0 || 1)))
        const sx = (mid0.x - v0.x) / v0.zoom, sy = (mid0.y - v0.y) / v0.zoom
        setView({ zoom, x: mid.x - sx * zoom, y: mid.y - sy * zoom })
        return
      }
    }
    const pt = toScene(e.clientX, e.clientY)
    if (canWrite && e.pointerType !== 'touch') session.current?.moveCursor(pt.x, pt.y, { tool, button: e.buttons ? 'down' : 'up' })
    if (tool === 'eraser' || e.pointerType === 'pen') setPointer(pt)
    const d = drag.current
    if (!d) return
    switch (d.kind) {
      case 'pan': setView((v) => ({ ...v, x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) })); return
      case 'ink': {
        const evs = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent]
        for (const ev of evs.length ? evs : [e.nativeEvent]) {
          const q = toScene(ev.clientX, ev.clientY)
          d.pts.push(q.x - d.el.x, q.y - d.el.y, d.el.pressure ? (ev.pressure || 0.5) : 0.5)
        }
        if (!inkFrame.current) inkFrame.current = requestAnimationFrame(() => {
          inkFrame.current = 0
          const cur = drag.current
          if (cur?.kind !== 'ink') return
          setLiveInk({ ...cur.el, pts: cur.pts.slice() })
          // Others see the stroke grow (points since the last tick).
          const from = cur.sent
          const total = cur.pts.length / 3
          if (total > from) {
            session.current?.pushInk({ id: cur.el.id, from, pts: roundPts(cur.pts.slice(from * 3)), style: from === 0 ? { x: cur.el.x, y: cur.el.y, color: cur.el.color, size: cur.el.size, pen: cur.el.pen, pressure: cur.el.pressure } : undefined })
            cur.sent = total
          }
        })
        return
      }
      case 'erase': { eraseAt(d.last, pt); d.last = pt; return }
      case 'lasso': { d.pts.push(pt); setLasso(d.pts.slice()); return }
      case 'marquee': {
        const box = boxFromPoints(d.start, pt)
        setMarquee(box)
        const next = new Set(d.base)
        for (const el of list) if (!el.locked && boxContains(box, bounds(el))) next.add(el.id)
        setSelected(next)
        return
      }
      case 'move': {
        const dx = pt.x - d.start.x, dy = pt.y - d.start.y
        if (!d.moved && Math.hypot(dx, dy) * viewRef.current.zoom < 3) return
        d.moved = true
        const m = new Map(d.originals.map((el) => [el.id, translate(el, dx, dy)]))
        setPreview(m)
        session.current?.pushLive([...m.values()].map((el) => ({ ...el, version: el.version + 1 })))
        return
      }
      case 'resize': {
        const m = new Map<string, WbElement>()
        if (d.single) {
          const el = d.single
          const [sx, sy] = CORNERS[d.corner]
          const q = rotate(pt, d.c0, -d.angle)
          const keep = el.type !== 'shape' || e.shiftKey
          let w = Math.max(8, (q.x - d.anchor.x) * sx), h = Math.max(8, (q.y - d.anchor.y) * sy)
          if (keep) { const s = Math.max(w / d.box0.w, h / d.box0.h); w = d.box0.w * s; h = d.box0.h * s }
          const x0 = sx > 0 ? d.anchor.x : d.anchor.x - w
          const y0 = sy > 0 ? d.anchor.y : d.anchor.y - h
          const cw = rotate({ x: x0 + w / 2, y: y0 + h / 2 }, d.c0, d.angle)
          const s = w / d.box0.w
          let next: WbElement
          if (el.type === 'text') next = { ...el, x: cw.x - w / 2, y: cw.y - (d.box0.h * s) / 2, w, fontSize: Math.max(4, el.fontSize * s) }
          else if (el.type === 'stamp') next = { ...el, x: cw.x - w / 2, y: cw.y - w / 2, size: w }
          else if (el.type === 'note') next = { ...el, x: cw.x - w / 2, y: cw.y - h / 2, w, h, fontSize: el.fontSize ? el.fontSize * s : undefined }
          else if (el.type === 'shape' || el.type === 'image') next = { ...el, x: cw.x - w / 2, y: cw.y - h / 2, w, h }
          else next = el
          m.set(el.id, next)
        } else {
          const c0 = { x: d.anchor.x + (d.box0.x + d.box0.w - d.anchor.x) + (d.box0.x - d.anchor.x), y: 0 }
          void c0
          const far = { x: d.anchor.x === d.box0.x ? d.box0.x + d.box0.w : d.box0.x, y: d.anchor.y === d.box0.y ? d.box0.y + d.box0.h : d.box0.y }
          const vx = far.x - d.anchor.x, vy = far.y - d.anchor.y
          const s = Math.max(0.05, ((pt.x - d.anchor.x) * vx + (pt.y - d.anchor.y) * vy) / (vx * vx + vy * vy || 1))
          for (const el of d.originals) m.set(el.id, scaleAround(el, d.anchor, s))
        }
        setPreview(m)
        session.current?.pushLive([...m.values()].map((el) => ({ ...el, version: el.version + 1 })))
        return
      }
      case 'rotate': {
        let a = (d.el0.angle ?? 0) + Math.atan2(pt.y - d.c.y, pt.x - d.c.x) - d.a0
        if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12)
        const next = { ...d.el0, angle: a } as WbElement
        setPreview(new Map([[next.id, next]]))
        session.current?.pushLive([{ ...next, version: next.version + 1 }])
        return
      }
      case 'line-end': {
        const el = d.el0
        const next: LineEl = d.end === 'end'
          ? { ...el, dx: pt.x - el.x, dy: pt.y - el.y }
          : { ...el, x: pt.x, y: pt.y, dx: el.x + el.dx - pt.x, dy: el.y + el.dy - pt.y }
        setPreview(new Map([[el.id, next]]))
        return
      }
      case 'create': {
        const el = shapeFrom(d.shape, d.start, pt, e.shiftKey)
        setDraft(el)
        return
      }
    }
  }

  const shapeFrom = (kind: ShapeTool, a: Pt, b: Pt, square: boolean): WbElement => {
    const z = topZ(els.current.values()) + 1
    if (kind === 'line' || kind === 'arrowLine') {
      return make<LineEl>({ type: 'line', x: a.x, y: a.y, dx: b.x - a.x, dy: b.y - a.y, color: '#1f1f1f', strokeWidth: 3, arrowEnd: kind === 'arrowLine', by: p.me.uid }, z)
    }
    let box = boxFromPoints(a, b)
    if (square) { const s = Math.max(box.w, box.h); box = { x: b.x < a.x ? a.x - s : a.x, y: b.y < a.y ? a.y - s : a.y, w: s, h: s } }
    return make<ShapeEl>({ type: 'shape', kind, x: box.x, y: box.y, w: box.w, h: box.h, stroke: '#1f1f1f', fill: null, strokeWidth: 3, by: p.me.uid }, z)
  }

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    setDragging(false)
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId)
      if (pinch.current) { if (touches.current.size < 2) pinch.current = null; return }
    }
    const d = drag.current
    drag.current = null
    if (!d) return
    const pt = toScene(e.clientX, e.clientY)
    switch (d.kind) {
      case 'ink': {
        cancelAnimationFrame(inkFrame.current); inkFrame.current = 0
        const pts = roundPts(thinPoints(d.pts))
        const el: InkEl = { ...d.el, pts }
        setLiveInk(null)
        session.current?.pushInk({ id: el.id, from: 0, pts: [], done: true })
        commit([el])
        return
      }
      case 'erase': {
        const gone = [...d.erased].map(byId).filter((x): x is WbElement => !!x).map((x) => ({ ...x, isDeleted: true }))
        setErasing(new Set())
        commit(gone)
        return
      }
      case 'lasso': {
        setLasso(null)
        if (d.pts.length < 3) return
        setSelected(new Set(list.filter((el) => !el.locked && inLasso(el, d.pts)).map((el) => el.id)))
        setToolState('select')
        return
      }
      case 'marquee': setMarquee(null); return
      case 'move': case 'resize': case 'rotate': case 'line-end': {
        const m = preview
        setPreview(null)
        if (m && m.size) commit([...m.values()])
        return
      }
      case 'create': {
        setDraft(null)
        const dist = Math.hypot(pt.x - d.start.x, pt.y - d.start.y) * viewRef.current.zoom
        let el: WbElement
        if (dist < 6) {
          // A click: the default size, centred where it was clicked.
          const w = d.shape === 'line' || d.shape === 'arrowLine' ? 200 : 160
          const h = d.shape === 'line' || d.shape === 'arrowLine' ? 0 : d.shape === 'ellipse' || d.shape === 'star' || d.shape === 'hexagon' ? 160 : 120
          el = shapeFrom(d.shape, { x: d.start.x - w / 2, y: d.start.y - h / 2 }, { x: d.start.x + w / 2, y: d.start.y + h / 2 }, false)
        } else el = shapeFrom(d.shape, d.start, pt, e.shiftKey)
        commit([el])
        setSelected(new Set([el.id]))
        setToolState('select')
        return
      }
    }
  }

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!canWrite) return
    const pt = toScene(e.clientX, e.clientY)
    const hit = topHit(pt, 6 / viewRef.current.zoom)
    if (hit) startEditing(hit)
    else if (tool === 'select') {
      // Double-click on the empty board: a text box, like most whiteboards.
      const el = make<TextEl>({ type: 'text', x: pt.x, y: pt.y - 14, w: 320, text: '', color: '#1f1f1f', fontSize: 24, by: p.me.uid }, topZ(els.current.values()) + 1)
      commit([el], { record: false })
      startEditing(el)
    }
  }

  // Wheel: pan, Ctrl/⌘ (and pinch on a trackpad) zooms at the pointer.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element)?.closest?.('[data-wb-chrome]')) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022)), e.clientX - r.left, e.clientY - r.top)
      else setView((v) => ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, loaded])

  // ── Actions on the selection ─────────────────────────────────────────────
  const deleteSelected = () => {
    const gone = selectedEls.filter((x) => !x.locked).map((x) => ({ ...x, isDeleted: true }))
    if (gone.length) commit(gone)
    setSelected(new Set())
  }
  const duplicate = (list0 = selectedEls, offset = 24) => {
    let z = topZ(els.current.values())
    const copies = list0.map((el) => make({ ...el, id: undefined, locked: false, x: el.x + offset, y: el.y + offset, by: p.me.uid } as never, ++z) as WbElement)
    commit(copies)
    setSelected(new Set(copies.map((c) => c.id)))
  }
  const toFront = () => { let z = topZ(els.current.values()); commit(ordered(selectedEls).map((el) => ({ ...el, z: ++z }))) }
  const toBack = () => { let z = bottomZ(els.current.values()); commit(ordered(selectedEls).reverse().map((el) => ({ ...el, z: --z }))) }
  const setLock = (locked: boolean) => commit(selectedEls.map((el) => ({ ...el, locked: locked || undefined })))
  const patchSelected = (patch: (el: WbElement) => Partial<WbElement> | null) => {
    const out: WbElement[] = []
    for (const el of selectedEls) { const pp = patch(el); if (pp) out.push({ ...el, ...pp } as WbElement) }
    commit(out)
  }

  const copySelection = (cut: boolean) => {
    if (!selectedEls.length) return
    clipboard = selectedEls.map((el) => ({ ...el }))
    void navigator.clipboard?.writeText(JSON.stringify({ type: 'fira-whiteboard/clipboard', elements: clipboard })).catch(() => {})
    if (cut) deleteSelected()
  }
  const pasteElements = (items: WbElement[]) => {
    if (!items.length) return
    const b = unionBounds(items)!
    const v = viewRef.current
    const cx = (size.w / 2 - v.x) / v.zoom, cy = (size.h / 2 - v.y) / v.zoom
    const dx = cx - (b.x + b.w / 2), dy = cy - (b.y + b.h / 2)
    let z = topZ(els.current.values())
    const copies = ordered(items).map((el) => make({ ...el, id: undefined, x: el.x + dx, y: el.y + dy, by: p.me.uid } as never, ++z) as WbElement)
    commit(copies)
    setSelected(new Set(copies.map((c) => c.id)))
    setToolState('select')
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editingId) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key
    if (k === ' ') { if (!spaceHeld) setSpaceHeld(true); e.preventDefault(); return }
    if (k === 'Escape') { if (popover) setPopover(null); else if (tool !== 'select') setTool('select'); else setSelected(new Set()); return }
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (!canWrite) return; if (e.shiftKey) redo(); else undo(); return }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); if (canWrite) redo(); return }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); setSelected(new Set(list.filter((x) => !x.locked).map((x) => x.id))); setToolState('select'); return }
    if (mod && k.toLowerCase() === 'c') { copySelection(false); return }
    if (mod && k.toLowerCase() === 'x') { if (canWrite) copySelection(true); return }
    if (mod && k.toLowerCase() === 'd') { e.preventDefault(); if (canWrite && selectedEls.length) duplicate(); return }
    if (mod) return
    if ((k === 'Delete' || k === 'Backspace') && canWrite) { e.preventDefault(); deleteSelected(); return }
    if (k.startsWith('Arrow') && selectedEls.length && canWrite) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0
      const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0
      commit(selectedEls.filter((x) => !x.locked).map((el) => translate(el, dx, dy)))
      return
    }
    if (k === 'Enter' && selectedEls.length === 1 && canWrite) { e.preventDefault(); startEditing(selectedEls[0]); return }
    if (k === '+' || k === '=') { zoomAt(1.2); return }
    if (k === '-') { zoomAt(1 / 1.2); return }
    if (k === '!' || (e.shiftKey && k === '1')) { fitTo(unionBounds(list), 2); return }
    const map: Record<string, Tool> = { v: 'select', h: 'hand', l: 'lasso', ...(canWrite ? { p: 'pen', m: 'highlighter', e: 'eraser', n: 'note', t: 'text', s: 'shape' } : {}) }
    const next = map[k.toLowerCase()]
    if (next) setTool(next)
  }
  const onKeyUp = (e: React.KeyboardEvent) => { if (e.key === ' ') setSpaceHeld(false) }

  // Paste: whiteboard elements (this or another board), pictures, or plain text as a text box.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const root = wrapRef.current
      if (!root || !canWrite || editingIdRef.current) return
      if (!root.contains(document.activeElement) && document.activeElement !== root) return
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (files.length) { e.preventDefault(); void insertImages(files); return }
      const text = e.clipboardData?.getData('text/plain') ?? ''
      try {
        const data = JSON.parse(text)
        if (data?.type === 'fira-whiteboard/clipboard' && Array.isArray(data.elements)) {
          e.preventDefault()
          pasteElements((data.elements as unknown[]).map(sanitize).filter((x): x is WbElement => !!x))
          return
        }
      } catch { /* not ours */ }
      if (clipboard.length && !text) { e.preventDefault(); pasteElements(clipboard); return }
      if (text.trim()) {
        e.preventDefault()
        const v = viewRef.current
        const el = make<TextEl>({ type: 'text', x: (size.w / 2 - v.x) / v.zoom - 160, y: (size.h / 2 - v.y) / v.zoom, w: 320, text: text.slice(0, 5000), color: '#1f1f1f', fontSize: 24, by: p.me.uid }, topZ(els.current.values()) + 1)
        commit([el]); setSelected(new Set([el.id]))
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  })

  // ── Images, import, export ───────────────────────────────────────────────
  const viewCenter = (): Pt => { const v = viewRef.current; return { x: (size.w / 2 - v.x) / v.zoom, y: (size.h / 2 - v.y) / v.zoom } }

  const insertImages = async (files: File[], at?: Pt) => {
    let where = at ?? viewCenter()
    for (const f of files) {
      try {
        setBusy(t('wb.import.working', { done: files.indexOf(f) + 1, total: files.length }))
        const dims = await imageSize(f)
        const url = await uploadCanvasFile(propsRef.current.pageId, f, f.name)
        const scale = Math.min(1, 480 / Math.max(dims.w, dims.h))
        const w = dims.w * scale, h = dims.h * scale
        const el = make<ImageEl>({ type: 'image', x: where.x - w / 2, y: where.y - h / 2, w, h, src: url, mime: f.type, by: p.me.uid }, topZ(els.current.values()) + 1)
        commit([el])
        setSelected(new Set([el.id]))
        where = { x: where.x + 32, y: where.y + 32 }
      } catch (e) { emitError(e) }
    }
    setBusy(null)
  }

  /** Put an import bundle on the board: below what is there, one undo step, then show it. */
  const placeImport = async (bundle: ImportBundle) => {
    if (!bundle.elements.length) { emitToast(t('wb.import.unknown')); return }
    try { await snapshotScene(propsRef.current.pageId) } catch { /* a version is a bonus, not a condition */ }
    const srcs = [...bundle.images.keys()]
    const urls = new Map<string, string>()
    for (let i = 0; i < srcs.length; i++) {
      setBusy(t('wb.import.working', { done: i + 1, total: srcs.length }))
      try { urls.set(srcs[i], await uploadCanvasFile(propsRef.current.pageId, bundle.images.get(srcs[i])!)) } catch (e) { emitError(e) }
    }
    setBusy(null)
    const placed = placeBundle(bundle, unionBounds(els.current.values()), topZ(els.current.values()) + 1, urls, p.me.uid)
    commit(placed)
    setSelected(new Set(placed.map((x) => x.id)))
    fitTo(unionBounds(placed), 1)
    const skipped = Object.entries(bundle.skipped).map(([k, n]) => `${k} (${n})`).join(', ')
    emitToast(t('wb.import.done', { n: placed.length }), skipped ? t('wb.import.skipped', { list: skipped }) : undefined)
  }

  const importFiles = async (files: File[], at?: Pt) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    const rest = files.filter((f) => !f.type.startsWith('image/'))
    if (images.length) await insertImages(images, at)
    for (const f of rest) {
      try {
        setBusy(t('wb.import.working', { done: 0, total: 1 }))
        const bundle = await readImportFile(f, t)
        setBusy(null)
        await placeImport(bundle)
      } catch (e) {
        setBusy(null)
        emitToast(t('wb.import.failed', { msg: (e as Error)?.message ?? String(e) }))
      }
    }
  }

  const importFromBoard = async (pageId: string) => {
    setPickerOpen(false)
    try {
      setBusy(t('wb.import.working', { done: 0, total: 1 }))
      const bundle = await boardAsBundle(pageId)
      setBusy(null)
      await placeImport(bundle)
    } catch (e) { setBusy(null); emitError(e) }
  }

  const doExport = async (kind: 'png' | 'svg' | 'file', onlySelection: boolean) => {
    setPopover(null)
    try {
      setBusy('…')
      const items = onlySelection && selectedEls.length ? ordered(selectedEls) : list
      await exportBoard(kind, items, settings, propsRef.current.title)
    } catch (e) {
      emitToast(t('wb.export.failed', { msg: (e as Error)?.message ?? String(e) }))
    } finally { setBusy(null) }
  }

  const changeSettings = (patch: Partial<WbSettings>) => {
    setSettings((s) => ({ ...s, ...patch }))
    session.current?.pushSettings(patch)
  }
  // The shared timer (timer.ts): a setting of the scene, so it reaches everybody on the board and is there for who comes later.
  const setTimer = (timer: WbTimer | null) => { setPopover(null); changeSettings({ timer }) }

  const clearInk = () => {
    setPopover(null)
    if (!window.confirm(t('wb.clearInkConfirm'))) return
    commit(list.filter((el) => el.type === 'ink' && !el.locked).map((el) => ({ ...el, isDeleted: true })))
  }

  const insertTemplate = (id: TemplateId) => {
    setPopover(null)
    const els0 = buildTemplate(id, viewCenter(), t, p.me.uid, p.me.name)
    let z = topZ(els.current.values())
    const out = els0.map((el) => ({ ...el, z: ++z }))
    commit(out)
    setSelected(new Set(out.map((x) => x.id)))
    setToolState('select')
    fitTo(unionBounds(out), 1)
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
        <p className="text-sm text-fg-2">{t('canvas.loadFailed')}</p>
        <p className="text-xs text-fg-faint max-w-sm">{error}</p>
        <button onClick={() => setAttempt((n) => n + 1)} className="px-3 py-1.5 rounded-lg text-sm border border-line text-fg-2 hover:bg-raised">{t('canvas.retry')}</button>
      </div>
    )
  }
  if (!loaded) return <CanvasLoading />

  const editingEl = editingId ? byId(editingId) : null
  const cursorStyle = spaceHeld || tool === 'hand' ? (dragging ? 'grabbing' : 'grab')
    : tool === 'pen' || tool === 'highlighter' || tool === 'shape' || tool === 'note' || tool === 'text' || tool === 'stamp' || tool === 'lasso' ? 'crosshair'
      : tool === 'eraser' ? 'none' : 'default'
  const hasSelection = selectedEls.length > 0
  const sel0 = selectedEls[0]
  const allOf = (type: WbElement['type']) => selectedEls.length > 0 && selectedEls.every((x) => x.type === type)
  const selBox = frame ? { x: Math.min(...frame.kind === 'line' ? [frame.a.x, frame.b.x] : frame.corners.map((c) => c.x)), y: Math.min(...frame.kind === 'line' ? [frame.a.y, frame.b.y] : frame.corners.map((c) => c.y)) } : null
  const selTop = frame ? Math.min(...(frame.kind === 'line' ? [frame.a.y, frame.b.y] : [...frame.corners.map((c) => c.y), frame.rot?.y ?? Infinity])) : 0
  const selMidX = frame ? (frame.kind === 'line' ? (frame.a.x + frame.b.x) / 2 : frame.corners.reduce((s, c) => s + c.x, 0) / 4) : 0

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      aria-label={t('wb.canvasLabel')}
      data-whiteboard
      className="absolute inset-0 overflow-hidden outline-none select-none"
      style={{ background: settings.bg }}
      // Tuval odaktayken tuşlar Fira'nın tek harfli kısayollarına gitmesin (n = yeni görev!).
      onKeyDownCapture={(e) => markHandled(e.nativeEvent)}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onDragOver={(e) => { if (canWrite && e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={(e) => {
        if (!canWrite || !e.dataTransfer.files.length) return
        e.preventDefault()
        void importFiles([...e.dataTransfer.files], toScene(e.clientX, e.clientY))
      }}
    >
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: cursorStyle, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => { touches.current.delete(e.pointerId); pinch.current = null; cancelDrag() }}
        onPointerLeave={() => { setPointer(null); session.current?.moveCursor(null) }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <GridPattern kind={settings.grid} zoom={view.zoom} pan={view} bg={settings.bg} />
        <WbDefs />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {visible.map((el) => (
            erasing.has(el.id) ? null : <ElementView key={el.id} el={preview?.get(el.id) ?? el} editing={el.id === editingId} />
          ))}
          {draft && <ElementView el={draft} />}
          {[...remoteInk.entries()].map(([k, el]) => <g key={k} opacity={0.85}><InkView el={el} live /></g>)}
          {liveInk && <InkView el={liveInk} live />}
          {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="rgba(59,130,246,0.08)" stroke="#3b82f6" strokeWidth={1 / view.zoom} strokeDasharray={`${4 / view.zoom} ${3 / view.zoom}`} />}
          {lasso && <path d={`M${lasso.map((q) => `${q.x},${q.y}`).join(' L')}`} fill="rgba(59,130,246,0.06)" stroke="#3b82f6" strokeWidth={1.5 / view.zoom} strokeDasharray={`${5 / view.zoom} ${4 / view.zoom}`} />}
        </g>
        {/* Selection frame in screen space: its lines and handles do not scale with zoom. */}
        {frame && !editingId && (
          frame.kind === 'line' ? (
            <g>
              {[frame.a, frame.b].map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={6} fill="#fff" stroke="#3b82f6" strokeWidth={2} />)}
            </g>
          ) : (
            <g>
              <polygon points={frame.corners.map((c) => `${c.x},${c.y}`).join(' ')} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
              {selectedEls.length > 1 && selectedEls.map((el) => { const b = bounds(el); const a = toScreen({ x: b.x, y: b.y }); return <rect key={el.id} x={a.x} y={a.y} width={b.w * view.zoom} height={b.h * view.zoom} fill="none" stroke="#3b82f6" strokeOpacity={0.4} strokeWidth={1} /> })}
              {canWrite && !selectedEls.some((x) => x.locked) && frame.corners.map((c, i) => <rect key={i} x={c.x - 5} y={c.y - 5} width={10} height={10} rx={2} fill="#fff" stroke="#3b82f6" strokeWidth={1.5} style={{ cursor: i % 2 === 0 ? 'nwse-resize' : 'nesw-resize' }} />)}
              {canWrite && frame.rot && frame.rotBase && !selectedEls.some((x) => x.locked) && (
                <>
                  <line x1={frame.rotBase.x} y1={frame.rotBase.y} x2={frame.rot.x} y2={frame.rot.y} stroke="#3b82f6" strokeWidth={1.5} />
                  <circle cx={frame.rot.x} cy={frame.rot.y} r={6} fill="#fff" stroke="#3b82f6" strokeWidth={1.5} style={{ cursor: 'grab' }} />
                </>
              )}
            </g>
          )
        )}
        {tool === 'eraser' && pointer && (() => { const q = toScreen(pointer); return <circle cx={q.x} cy={q.y} r={9} fill="rgba(255,255,255,0.6)" stroke="#1f1f1f" strokeWidth={1.2} pointerEvents="none" /> })()}
      </svg>

      {/* Others' pointers, with their names */}
      {showCursors && [...cursors.values()].map((c) => {
        const q = toScreen({ x: c.x, y: c.y })
        if (q.x < -40 || q.y < -40 || q.x > size.w + 40 || q.y > size.h + 40) return null
        return (
          <div key={c.key} className="absolute left-0 top-0 pointer-events-none transition-transform duration-150 ease-linear" style={{ transform: `translate(${q.x}px, ${q.y}px)` }} data-wb-cursor={c.name}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><path d="M5 3l14 7.5-6.2 1.8-2.9 6.2z" fill={c.color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" /></svg>
            <span className="absolute left-4 top-4 whitespace-nowrap rounded-md px-1.5 py-0.5 text-2xs font-semibold text-white shadow-sm" style={{ background: c.color }}>{c.name}</span>
          </div>
        )
      })}

      {/* Text editing: an HTML textarea over the element, styled like it */}
      {editingEl && <TextEditor el={editingEl} view={view} value={draftText} onChange={(v) => { setDraftText(v); session.current?.pushLive([{ ...editingEl, text: v, version: editingEl.version + 1 } as WbElement]) }} onDone={finishEditing} placeholder={editingEl.type === 'note' ? t('wb.note.placeholder') : t('wb.text.placeholder')} />}

      {list.length === 0 && canWrite && !liveInk && !draft && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-8">
          <p className="max-w-sm text-center text-sm" style={{ color: isDark(settings.bg) ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)' }}>{t('wb.empty')}</p>
        </div>
      )}

      {/* ── Inking toolbar (top centre) ── */}
      {canWrite && (
        // Telefonda çubuk sola yaslanır ve menü düğmesine yer bırakıp iki satıra kırılır
        // (kaydırma değil: kalem ayarları gibi açılır paneller kırpılmasın).
        <div data-wb-chrome className="absolute top-2 left-2 right-14 sm:right-auto sm:top-3 sm:left-1/2 sm:-translate-x-1/2 z-20 flex flex-wrap items-center justify-center gap-0.5 rounded-xl border border-line bg-surface/95 backdrop-blur px-1.5 py-1 shadow-lg sm:max-w-[calc(100%-8rem)]" role="toolbar" aria-label={t('wb.canvasLabel')}>
          <ToolButton label={`${t('wb.tool.select')} (V)`} active={tool === 'select'} onClick={() => setTool('select')} testId="select"><Icon name="select" /></ToolButton>
          <ToolButton label={`${t('wb.tool.lasso')} (L)`} active={tool === 'lasso'} onClick={() => setTool('lasso')} testId="lasso"><Icon name="lasso" /></ToolButton>
          <ToolButton label={`${t('wb.tool.hand')} (H)`} active={tool === 'hand'} onClick={() => setTool('hand')} testId="hand"><Icon name="hand" /></ToolButton>
          <span className="w-px h-7 bg-line mx-1" aria-hidden />
          {pens.map((pen, i) => (
            <span key={i} className="relative" data-wb-popover-anchor>
              <ToolButton label={`${t(`wb.pen.${pen.kind === 'plain' ? 'plain' : pen.kind}`)} · ${pen.color}`} active={tool === 'pen' && activePen === i} testId={`pen-${i}`}
                onClick={() => { if (tool === 'pen' && activePen === i) setPopover(popover === 'pen' ? null : 'pen'); else { setActivePen(i); setTool('pen') } }}>
                <PenGlyph color={pen.color} kind={pen.kind} />
              </ToolButton>
              {popover === 'pen' && activePen === i && (
                <Popover label={t('wb.pen.settings')} onClose={() => setPopover(null)} className="top-12 left-1/2 -translate-x-1/2 w-80 max-w-[calc(100vw-1.5rem)]">
                  <SectionLabel>{t('wb.pen.color')}</SectionLabel>
                  <Swatches colors={INK_COLORS} value={pen.color} label={t('wb.pen.color')} onPick={(c) => setPens((ps) => ps.map((x, j) => (j === i ? { ...x, color: c } : x)))} />
                  <SectionLabel>{t('wb.pen.size')}</SectionLabel>
                  <div className="flex items-center gap-2">
                    {[1.5, 3, 5, 8, 12].map((s) => (
                      <button key={s} type="button" onClick={() => setPens((ps) => ps.map((x, j) => (j === i ? { ...x, size: s } : x)))} aria-pressed={pen.size === s} aria-label={`${s}`}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center ${pen.size === s ? 'bg-primary-100 dark:bg-primary-900/50' : 'hover:bg-raised'}`}>
                        <span className="rounded-full bg-fg" style={{ width: Math.max(3, s * 1.4), height: Math.max(3, s * 1.4) }} />
                      </button>
                    ))}
                  </div>
                  <SectionLabel>{t('wb.pen.kind')}</SectionLabel>
                  <div className="grid grid-cols-2 gap-1">
                    {(['plain', 'rainbow', 'galaxy', 'arrow'] as PenKind[]).map((k) => (
                      <button key={k} type="button" onClick={() => setPens((ps) => ps.map((x, j) => (j === i ? { ...x, kind: k } : x)))} aria-pressed={pen.kind === k}
                        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-left ${pen.kind === k ? 'bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-100' : 'text-fg-2 hover:bg-raised'}`}>
                        <PenGlyph color={pen.color} kind={k} /><span className="truncate" title={t(`wb.pen.${k}`)}>{t(`wb.pen.${k}`)}</span>
                      </button>
                    ))}
                  </div>
                </Popover>
              )}
            </span>
          ))}
          <span className="relative" data-wb-popover-anchor>
            <ToolButton label={`${t('wb.tool.highlighter')} (M)`} active={tool === 'highlighter'} testId="highlighter"
              onClick={() => { if (tool === 'highlighter') setPopover(popover === 'highlighter' ? null : 'highlighter'); else setTool('highlighter') }}>
              <PenGlyph color={highlighter.color} highlighter />
            </ToolButton>
            {popover === 'highlighter' && (
              <Popover label={t('wb.tool.highlighter')} onClose={() => setPopover(null)} className="top-12 left-1/2 -translate-x-1/2 w-56">
                <SectionLabel>{t('wb.pen.color')}</SectionLabel>
                <Swatches colors={HIGHLIGHTER_COLORS} value={highlighter.color} label={t('wb.pen.color')} onPick={(c) => setHighlighter((h) => ({ ...h, color: c }))} />
                <SectionLabel>{t('wb.pen.size')}</SectionLabel>
                <div className="flex gap-2">
                  {[12, 22, 34].map((s) => (
                    <button key={s} type="button" onClick={() => setHighlighter((h) => ({ ...h, size: s }))} aria-pressed={highlighter.size === s} aria-label={`${s}`}
                      className={`w-9 h-8 rounded-lg flex items-center justify-center ${highlighter.size === s ? 'bg-primary-100 dark:bg-primary-900/50' : 'hover:bg-raised'}`}>
                      <span className="rounded-md" style={{ width: 22, height: s / 3, background: highlighter.color }} />
                    </button>
                  ))}
                </div>
              </Popover>
            )}
          </span>
          <span className="relative" data-wb-popover-anchor>
            <ToolButton label={`${t('wb.tool.eraser')} (E)`} active={tool === 'eraser'} testId="eraser"
              onClick={() => { if (tool === 'eraser') setPopover(popover === 'eraser' ? null : 'eraser'); else setTool('eraser') }}>
              <Icon name="eraser" />
            </ToolButton>
            {popover === 'eraser' && (
              <Popover label={t('wb.tool.eraser')} onClose={() => setPopover(null)} className="top-12 left-1/2 -translate-x-1/2 w-56">
                <MenuItem icon="trash" label={t('wb.clearInk')} onClick={clearInk} danger />
              </Popover>
            )}
          </span>
          <span className="w-px h-7 bg-line mx-1" aria-hidden />
          <ToolButton label={`${t('wb.undo')} (Ctrl+Z)`} onClick={undo} disabled={!history.current.canUndo} testId="undo"><Icon name="undo" /></ToolButton>
          <ToolButton label={`${t('wb.redo')} (Ctrl+Y)`} onClick={redo} disabled={!history.current.canRedo} testId="redo"><Icon name="redo" /></ToolButton>
        </div>
      )}

      {/* ── Create panel (left) ── */}
      {canWrite && (
        <div data-wb-chrome className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-0.5 rounded-xl border border-line bg-surface/95 backdrop-blur p-1 shadow-lg" role="toolbar" aria-orientation="vertical" aria-label={t('wb.tool.shape')}>
          <ToolButton label={`${t('wb.tool.note')} (N)`} active={tool === 'note'} onClick={() => setTool('note')} testId="note"><Icon name="note" /></ToolButton>
          <ToolButton label={`${t('wb.tool.text')} (T)`} active={tool === 'text'} onClick={() => setTool('text')} testId="text"><Icon name="text" /></ToolButton>
          <span className="relative" data-wb-popover-anchor>
            <ToolButton label={`${t('wb.tool.shape')} (S)`} active={tool === 'shape'} testId="shape" onClick={() => { setTool('shape'); setPopover(popover === 'shape' ? null : 'shape') }}><Icon name="shape" /></ToolButton>
            {popover === 'shape' && (
              <Popover label={t('wb.tool.shape')} onClose={() => setPopover(null)} className="left-12 top-0 w-60">
                <div className="grid grid-cols-3 gap-1">
                  {([...SHAPE_KINDS, 'line', 'arrowLine'] as ShapeTool[]).map((k) => (
                    <button key={k} type="button" title={t(`wb.shape.${k}`)} aria-label={t(`wb.shape.${k}`)} aria-pressed={shapeTool === k} onClick={() => { setShapeTool(k); setToolState('shape'); setPopover(null) }}
                      className={`h-14 flex flex-col items-center justify-center gap-0.5 rounded-lg text-xs ${shapeTool === k ? 'bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-100' : 'text-fg-2 hover:bg-raised'}`}>
                      <svg width="28" height="22" viewBox="0 0 28 22" aria-hidden>
                        {k === 'line' ? <line x1="3" y1="19" x2="25" y2="3" stroke="currentColor" strokeWidth="2" />
                          : k === 'arrowLine' ? <g stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"><line x1="3" y1="19" x2="25" y2="3" /><path d="M17 3h8v8" /></g>
                            : k === 'rect' ? <rect x="3" y="3" width="22" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                              : k === 'ellipse' ? <ellipse cx="14" cy="11" rx="11" ry="8" fill="none" stroke="currentColor" strokeWidth="2" />
                                : <path d={shapePath(k as ShapeKind, 3, 2, 22, 18)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />}
                      </svg>
                      <span className="truncate max-w-full px-0.5">{t(`wb.shape.${k}`)}</span>
                    </button>
                  ))}
                </div>
              </Popover>
            )}
          </span>
          <span className="relative" data-wb-popover-anchor>
            <ToolButton label={t('wb.tool.reaction')} active={tool === 'stamp'} testId="stamp" onClick={() => { setTool('stamp'); setPopover(popover === 'stamp' ? null : 'stamp') }}><Icon name="reaction" /></ToolButton>
            {popover === 'stamp' && (
              <Popover label={t('wb.tool.reaction')} onClose={() => setPopover(null)} className="left-12 top-0 w-56">
                <div className="grid grid-cols-4 gap-1">
                  {STAMPS.map((s) => (
                    <button key={s} type="button" aria-label={s} aria-pressed={stamp === s} onClick={() => { setStamp(s); setToolState('stamp'); setPopover(null) }}
                      className={`h-11 rounded-lg text-2xl ${stamp === s ? 'bg-primary-100 dark:bg-primary-900/50' : 'hover:bg-raised'}`}>{s}</button>
                  ))}
                </div>
              </Popover>
            )}
          </span>
          <ToolButton label={t('wb.tool.image')} onClick={() => fileInput.current?.click()} testId="image"><Icon name="image" /></ToolButton>
          <span className="relative" data-wb-popover-anchor>
            <ToolButton label={t('wb.tool.template')} active={popover === 'template'} testId="template" onClick={() => setPopover(popover === 'template' ? null : 'template')}><Icon name="template" /></ToolButton>
            {popover === 'template' && (
              <Popover label={t('wb.tpl.title')} onClose={() => setPopover(null)} className="left-12 bottom-0 w-56">
                <p className="text-xs text-fg-faint px-2 pb-1">{t('wb.tpl.hint')}</p>
                {TEMPLATES.map((id) => <MenuItem key={id} icon="template" label={t(`wb.tpl.${id}`)} onClick={() => insertTemplate(id)} />)}
              </Popover>
            )}
          </span>
          <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void insertImages(fs) }} />
        </div>
      )}

      {/* ── Board menu (top right) ── */}
      <div data-wb-chrome className="absolute top-3 right-3 z-20" data-wb-popover-anchor>
        <button type="button" onClick={() => setPopover(popover === 'menu' ? null : 'menu')} aria-label={t('wb.menu')} title={t('wb.menu')} aria-expanded={popover === 'menu'} data-wb-tool="menu"
          className="w-10 h-10 flex items-center justify-center rounded-xl border border-line bg-surface/95 backdrop-blur shadow-lg text-fg-2 hover:text-fg hover:bg-raised">
          <Icon name="menu" />
        </button>
        {popover === 'menu' && (
          <Popover label={t('wb.menu')} onClose={() => setPopover(null)} className="right-0 top-12 w-72 max-h-[70vh] overflow-y-auto">
            {canWrite && (
              <>
                <SectionLabel>{t('wb.bg.title')}</SectionLabel>
                <Swatches colors={BG_COLORS} value={settings.bg} round={false} label={t('wb.bg.color')} onPick={(c) => changeSettings({ bg: c })} />
                <div className="flex gap-1 mt-2" role="group" aria-label={t('wb.bg.title')}>
                  {(['dots', 'grid', 'none'] as GridKind[]).map((g) => (
                    <button key={g} type="button" aria-pressed={settings.grid === g} onClick={() => changeSettings({ grid: g })}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-xs ${settings.grid === g ? 'bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-100' : 'text-fg-2 hover:bg-raised'}`}>{t(`wb.bg.${g}`)}</button>
                  ))}
                </div>
                <div className="my-2 border-t border-line-soft" />
              </>
            )}
            <label className="flex items-center justify-between gap-3 px-2.5 py-2 text-sm text-fg-2">
              <span>{t('wb.cursors')}</span>
              <input type="checkbox" checked={showCursors} onChange={(e) => setShowCursors(e.target.checked)} className="w-4 h-4 accent-primary-600" />
            </label>
            <div className="my-2 border-t border-line-soft" />
            <MenuItem icon="download" label={t('wb.export.png')} onClick={() => void doExport('png', false)} />
            <MenuItem icon="download" label={t('wb.export.svg')} onClick={() => void doExport('svg', false)} />
            <MenuItem icon="download" label={t('wb.export.file')} onClick={() => void doExport('file', false)} />
            {hasSelection && <MenuItem icon="download" label={`${t('wb.export.png')} · ${t('wb.export.selection')}`} onClick={() => void doExport('png', true)} />}
            {canWrite && (
              <>
                <div className="my-2 border-t border-line-soft" />
                <MenuItem icon="upload" label={t('wb.import.file')} hint={t('wb.import.fileHint')} onClick={() => { setPopover(null); importInput.current?.click() }} />
                <MenuItem icon="board" label={t('wb.import.fromBoard')} onClick={() => { setPopover(null); setPickerOpen(true) }} />
                <div className="my-2 border-t border-line-soft" />
                <MenuItem icon="timer" label={t('wb.timer.title')} hint={t('wb.timer.hint')} onClick={() => setPopover('timer')} />
              </>
            )}
          </Popover>
        )}
        <input ref={importInput} type="file" accept=".json,.zip,.excalidraw,image/*,application/json,application/zip" className="hidden"
          onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void importFiles(fs) }} />
      </div>

      {/* ── Zoom (bottom right) ── */}
      <div data-wb-chrome className="absolute bottom-3 right-3 z-20 flex items-center gap-0.5 rounded-xl border border-line bg-surface/95 backdrop-blur px-1 py-0.5 shadow-lg">
        {canWrite && (
          <>
            <span className="relative" data-wb-popover-anchor>
              <ToolButton label={t('wb.timer.title')} active={popover === 'timer'} onClick={() => setPopover(popover === 'timer' ? null : 'timer')} testId="timer"><Icon name="timer" className="w-4 h-4" /></ToolButton>
              {popover === 'timer' && (
                <Popover label={t('wb.timer.title')} onClose={() => setPopover(null)} className="right-0 bottom-12 w-64">
                  <TimerStart onStart={(m) => setTimer(startTimer(m, serverNow(), p.me.name))} />
                </Popover>
              )}
            </span>
            <span className="w-px h-6 bg-line mx-0.5" aria-hidden />
          </>
        )}
        <ToolButton label={t('wb.zoomOut')} onClick={() => zoomAt(1 / 1.25)} testId="zoom-out"><Icon name="zoomOut" className="w-4 h-4" /></ToolButton>
        <button type="button" onClick={() => setView((v) => ({ zoom: 1, x: size.w / 2 - ((size.w / 2 - v.x) / v.zoom), y: size.h / 2 - ((size.h / 2 - v.y) / v.zoom) }))} title={t('wb.zoomReset')}
          className="min-w-[3.25rem] h-9 px-1 rounded-lg text-xs font-medium tabular-nums text-fg-2 hover:bg-raised" data-wb-zoom>{Math.round(view.zoom * 100)}%</button>
        <ToolButton label={t('wb.zoomIn')} onClick={() => zoomAt(1.25)} testId="zoom-in"><Icon name="zoomIn" className="w-4 h-4" /></ToolButton>
        <ToolButton label={`${t('wb.zoomFit')} (Shift+1)`} onClick={() => fitTo(unionBounds(list), 2)} testId="fit"><Icon name="fit" className="w-4 h-4" /></ToolButton>
      </div>

      {busy && (
        <div className={`absolute ${settings.timer ? 'bottom-20' : 'bottom-3'} left-1/2 -translate-x-1/2 z-30 rounded-lg bg-surface border border-line shadow-lg px-3 py-1.5 text-xs text-fg-2`} role="status">{busy}</div>
      )}

      {/* ── The shared timer (bottom centre): everybody sees it, who can write controls it ── */}
      {settings.timer && (
        <TimerPill timer={settings.timer} now={serverNow} canWrite={canWrite} me={p.me.name} muted={timerMuted}
          onMute={(m) => patchPrefs({ wbTimerMuted: m ? true : null })} onChange={setTimer} />
      )}

      {/* ── Selection bar ── */}
      {hasSelection && canWrite && !editingId && frame && !dragging && (
        <div data-wb-chrome className="absolute z-20 flex items-center gap-0.5 rounded-xl border border-line bg-surface shadow-lg px-1 py-0.5"
          style={{ left: Math.max(8, Math.min(size.w - 8, selMidX)), top: Math.max(60, selTop - 12), transform: 'translate(-50%, -100%)' }}
          onPointerDown={(e) => e.stopPropagation()} data-wb-selbar>
          {selectedEls.length > 1 && <span className="px-2 text-xs text-fg-muted whitespace-nowrap">{t('wb.sel.count', { n: selectedEls.length })}</span>}
          {allOf('note') && <InlineSwatches colors={NOTE_COLORS} value={(sel0 as NoteEl).color} onPick={(c) => patchSelected((el) => (el.type === 'note' ? { color: c } : null))} label={t('wb.sel.color')} />}
          {allOf('ink') && <InlineSwatches colors={INK_COLORS.slice(0, 8)} value={(sel0 as InkEl).color} onPick={(c) => patchSelected((el) => (el.type === 'ink' && el.pen !== 'highlighter' ? { color: c, pen: el.pen === 'rainbow' || el.pen === 'galaxy' ? 'plain' : el.pen } as Partial<InkEl> : null))} label={t('wb.sel.color')} />}
          {(allOf('text') || allOf('line')) && <InlineSwatches colors={SHAPE_COLORS} value={sel0.type === 'text' ? sel0.color : sel0.type === 'line' ? sel0.color : null} onPick={(c) => patchSelected((el) => (el.type === 'text' || el.type === 'line' ? { color: c } : null))} label={t('wb.sel.color')} />}
          {allOf('shape') && (
            <>
              <InlineSwatches colors={SHAPE_COLORS.slice(0, 6)} value={(sel0 as ShapeEl).stroke} onPick={(c) => patchSelected((el) => (el.type === 'shape' ? { stroke: c } : null))} label={t('wb.sel.stroke')} />
              <span className="w-px h-6 bg-line mx-0.5" aria-hidden />
              <InlineSwatches colors={FILL_COLORS.slice(0, 6)} value={(sel0 as ShapeEl).fill} onPick={(c) => patchSelected((el) => (el.type === 'shape' ? { fill: c } : null))} label={t('wb.sel.fill')} />
              <button type="button" onClick={() => patchSelected((el) => (el.type === 'shape' ? { fill: null } : null))} title={t('wb.sel.noFill')} aria-label={t('wb.sel.noFill')}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-raised"><span className="w-5 h-5 rounded-full border border-line bg-[linear-gradient(135deg,transparent_45%,#e81224_45%,#e81224_55%,transparent_55%)]" /></button>
            </>
          )}
          {(allOf('text') || allOf('shape') || allOf('note')) && (
            <>
              <span className="w-px h-6 bg-line mx-0.5" aria-hidden />
              <button type="button" title={`${t('wb.sel.fontSize')} −`} aria-label={`${t('wb.sel.fontSize')} −`} onClick={() => patchSelected((el) => fontStep(el, 1 / 1.2))} className="w-8 h-8 rounded-lg text-xs font-semibold text-fg-2 hover:bg-raised">A−</button>
              <button type="button" title={`${t('wb.sel.fontSize')} +`} aria-label={`${t('wb.sel.fontSize')} +`} onClick={() => patchSelected((el) => fontStep(el, 1.2))} className="w-8 h-8 rounded-lg text-sm font-semibold text-fg-2 hover:bg-raised">A+</button>
            </>
          )}
          {allOf('text') && (
            <>
              <button type="button" aria-pressed={!!(sel0 as TextEl).bold} title={t('wb.sel.bold')} aria-label={t('wb.sel.bold')} onClick={() => patchSelected((el) => (el.type === 'text' ? { bold: !(sel0 as TextEl).bold || undefined } : null))} className={`w-8 h-8 rounded-lg text-sm font-bold ${(sel0 as TextEl).bold ? 'bg-primary-100 dark:bg-primary-900/50' : 'text-fg-2 hover:bg-raised'}`}>B</button>
              <button type="button" aria-pressed={!!(sel0 as TextEl).italic} title={t('wb.sel.italic')} aria-label={t('wb.sel.italic')} onClick={() => patchSelected((el) => (el.type === 'text' ? { italic: !(sel0 as TextEl).italic || undefined } : null))} className={`w-8 h-8 rounded-lg text-sm italic ${(sel0 as TextEl).italic ? 'bg-primary-100 dark:bg-primary-900/50' : 'text-fg-2 hover:bg-raised'}`}>I</button>
              <button type="button" title={t('wb.sel.align')} aria-label={t('wb.sel.align')} onClick={() => patchSelected((el) => (el.type === 'text' ? { align: el.align === 'center' ? 'right' : el.align === 'right' ? 'left' : 'center' } : null))} className="w-8 h-8 rounded-lg flex items-center justify-center text-fg-2 hover:bg-raised">
                <Icon name={(sel0 as TextEl).align === 'center' ? 'alignCenter' : (sel0 as TextEl).align === 'right' ? 'alignRight' : 'alignLeft'} className="w-4 h-4" />
              </button>
            </>
          )}
          {allOf('line') && (
            <button type="button" aria-pressed={!!(sel0 as LineEl).arrowEnd} title={t('wb.shape.arrowLine')} aria-label={t('wb.shape.arrowLine')} onClick={() => patchSelected((el) => (el.type === 'line' ? { arrowEnd: !el.arrowEnd || undefined } : null))} className={`w-8 h-8 rounded-lg flex items-center justify-center ${(sel0 as LineEl).arrowEnd ? 'bg-primary-100 dark:bg-primary-900/50' : 'text-fg-2 hover:bg-raised'}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 20L20 4M12 4h8v8" /></svg>
            </button>
          )}
          {selectedEls.length === 1 && (sel0.type === 'note' || sel0.type === 'text' || sel0.type === 'shape') && !sel0.locked && (
            <button type="button" title={t('wb.sel.edit')} aria-label={t('wb.sel.edit')} onClick={() => startEditing(sel0)} className="w-8 h-8 rounded-lg flex items-center justify-center text-fg-2 hover:bg-raised"><Icon name="text" className="w-4 h-4" /></button>
          )}
          <span className="w-px h-6 bg-line mx-0.5" aria-hidden />
          <SelButton label={`${t('wb.sel.duplicate')} (Ctrl+D)`} icon="duplicate" onClick={() => duplicate()} />
          <SelButton label={t('wb.sel.front')} icon="front" onClick={toFront} />
          <SelButton label={t('wb.sel.back')} icon="back" onClick={toBack} />
          {selectedEls.some((x) => x.locked)
            ? <SelButton label={t('wb.sel.unlock')} icon="unlock" onClick={() => setLock(false)} />
            : <SelButton label={t('wb.sel.lock')} icon="lock" onClick={() => setLock(true)} />}
          <SelButton label={`${t('wb.sel.delete')} (Del)`} icon="trash" onClick={deleteSelected} danger />
        </div>
      )}
      {selBox === null ? null : null}

      {pickerOpen && <BoardPicker currentId={p.pageId} onPick={(id) => void importFromBoard(id)} onClose={() => setPickerOpen(false)} />}
    </div>
  )
}

function fontStep(el: WbElement, f: number): Partial<WbElement> | null {
  if (el.type === 'text') return { fontSize: Math.max(8, Math.min(200, Math.round(el.fontSize * f))) }
  if (el.type === 'shape') return { fontSize: Math.max(8, Math.min(120, Math.round((el.fontSize ?? 18) * f))) }
  if (el.type === 'note') return { fontSize: Math.max(10, Math.min(96, Math.round((el.fontSize ?? noteLayout(el).size) * f))) }
  return null
}

const isDark = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return false
  const n = parseInt(m[1], 16)
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) < 110
}

function InlineSwatches({ colors, value, onPick, label }: { colors: string[]; value: string | null | undefined; onPick: (c: string) => void; label: string }) {
  return (
    <div className="flex items-center gap-1 px-1" role="group" aria-label={label}>
      {colors.map((c) => (
        <button key={c} type="button" onClick={() => onPick(c)} aria-label={`${label} ${c}`} aria-pressed={value?.toLowerCase() === c.toLowerCase()} title={c}
          className={`w-5 h-5 rounded-full border ${value?.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-primary-500 ring-offset-1 ring-offset-surface border-transparent' : 'border-black/15'}`} style={{ background: c }} />
      ))}
    </div>
  )
}

function SelButton({ label, icon, onClick, danger }: { label: string; icon: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick}
      className={`w-8 h-8 rounded-lg flex items-center justify-center ${danger ? 'text-danger hover:bg-danger/10' : 'text-fg-2 hover:bg-raised hover:text-fg'}`}>
      <Icon name={icon} className="w-4 h-4" />
    </button>
  )
}

/**
 * Editing a note, a text box or a shape's label: a textarea laid exactly over
 * the element (same font, size, padding, rotation), so the text does not move
 * when editing starts or ends.
 */
function TextEditor({ el, view, value, onChange, onDone, placeholder }: {
  el: WbElement; view: { x: number; y: number; zoom: number }; value: string; onChange: (v: string) => void; onDone: () => void; placeholder: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { const ta = ref.current; if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length) } }, [el.id])
  const b = localBox(el)
  const z = view.zoom
  let size = 24
  let pad = 0
  let color = '#1f1f1f'
  let align: 'left' | 'center' | 'right' = 'left'
  let weight = 400
  let italic = false
  let family = "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
  let box = b
  if (el.type === 'note') {
    size = noteLayout({ ...el, text: value }).size
    pad = NOTE_PAD
    color = isDark(el.color) ? '#ffffff' : '#1f1f1f'
  } else if (el.type === 'text') {
    size = el.fontSize; color = el.color; align = el.align ?? 'left'; weight = el.bold ? 700 : 400; italic = !!el.italic
    family = fontCss(10, el.font ?? 'sans').replace(/^.*?10px /, '')
    const h = textBlockSize({ ...el, text: value || ' ' }).h
    box = { ...b, h: Math.max(h, size * LINE_HEIGHT) }
  } else if (el.type === 'shape') {
    const lay = shapeTextLayout({ ...el, text: value })
    size = lay.size; align = 'center'; weight = el.bold ? 700 : 400
    color = el.textColor ?? '#1f1f1f'
    const lines = Math.max(1, lay.lines.length)
    const h = lines * size * LINE_HEIGHT
    box = { x: b.x + (b.w - lay.width) / 2, y: b.y + (b.h - h) / 2, w: lay.width, h: Math.max(h, size * LINE_HEIGHT) }
  }
  const left = box.x * z + view.x
  const top = box.y * z + view.y
  const c = center(b)
  const originX = (c.x - box.x) * z
  const originY = (c.y - box.y) * z
  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      spellCheck
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); onDone() }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-10 resize-none overflow-hidden bg-transparent outline-none border-0 placeholder:text-black/35"
      data-wb-editor
      style={{
        left, top, width: box.w * z, height: (el.type === 'note' ? b.h : box.h) * z,
        padding: `${pad * z}px`,
        fontSize: size * z, lineHeight: LINE_HEIGHT, fontFamily: family, fontWeight: weight, fontStyle: italic ? 'italic' : undefined,
        color, textAlign: align, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        transform: el.angle ? `rotate(${el.angle}rad)` : undefined, transformOrigin: `${originX}px ${originY}px`,
        caretColor: color,
      }}
    />
  )
}
