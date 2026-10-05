import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabase'

/**
 * Live collaboration and saving for a canvas (drawing or whiteboard, 096).
 *
 * Model: every element carries `version` / `versionNonce` (Excalidraw's model;
 * the whiteboard uses the same fields). Whoever has the higher version wins,
 * on a tie the lower nonce — on every client (`preferRemote`) and on the server
 * (`save_page_scene`). So order does not matter: two people saving at once
 * never erase each other's elements, and a late broadcast cannot roll back a
 * newer one.
 *
 * Transport: one private Realtime channel per canvas (`canvas:<page id>`), which
 * RLS on `realtime.messages` opens only to members who can see the canvas and
 * lets only writers broadcast. Presence says who is here.
 *
 * Budget: Realtime counts every message sent *and* every delivery against one
 * tenant-wide limit (100/s averaged over a minute), and the whole app's live
 * updates share it. So a client sends at most one message per tick, the tick
 * slows down as more people join (`tickMs`), nothing is sent while alone, and
 * an idle pointer sends nothing at all.
 */

export interface SyncElement {
  id: string
  version: number
  versionNonce: number
  isDeleted?: boolean
  updated?: number
}

/** A stored image: the file itself lives in storage, the scene keeps its address. */
export interface SceneFile {
  id: string
  mimeType: string
  url: string
  created?: number
}

export interface Peer {
  key: string
  uid: string
  name: string
  color: string
  avatar?: string | null
  canWrite: boolean
  self: boolean
}

export interface RemoteCursor {
  key: string
  uid: string
  name: string
  color: string
  x: number
  y: number
  tool?: string
  button?: string
}

/** A stroke still being drawn by someone else: points appended since `from`. */
export interface InkDelta {
  id: string
  from: number
  pts: number[]
  style?: Record<string, unknown>
  done?: boolean
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'offline'

export interface SessionHandlers<E extends SyncElement> {
  onElements: (els: E[]) => void
  onFiles: (files: Record<string, SceneFile>) => void
  onSettings: (patch: Record<string, unknown>) => void
  onPeers: (peers: Peer[]) => void
  onCursor: (key: string, cursor: RemoteCursor | null) => void
  onInk?: (key: string, delta: InkDelta) => void
  /** Someone restored a version: reload the scene from the server. */
  onReload: (byName: string) => void
  /** The channel came back after a drop: events may have been missed. */
  onResync: () => void
  onSaveState: (s: SaveState) => void
  onLive: (live: boolean) => void
}

export interface Me {
  uid: string
  name: string
  color: string
  avatar?: string | null
  canWrite: boolean
}

/** Remote copy replaces local: higher version, or equal version and lower nonce. */
export function preferRemote(local: SyncElement | undefined, remote: SyncElement): boolean {
  if (!local) return true
  if (remote.version !== local.version) return remote.version > local.version
  return remote.versionNonce < local.versionNonce
}

/** A fresh (version, nonce, updated) triple after a local change. */
export function bump<E extends SyncElement>(el: E): E {
  return { ...el, version: (el.version ?? 0) + 1, versionNonce: randomNonce(), updated: Date.now() }
}
export const randomNonce = () => Math.floor(Math.random() * 2 ** 31)

/** Collaborator colours: readable on a light canvas, distinct from each other. */
const PEER_COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#c2255c', '#6741d9', '#0c8599', '#f08c00', '#5c940d', '#d6336c', '#1971c2', '#9c36b5', '#087f5b']
export function peerColor(uid: string): string {
  let h = 0
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0
  return PEER_COLORS[Math.abs(h) % PEER_COLORS.length]
}

const SAVE_QUIET_MS = 900
const SAVE_MAX_WAIT_MS = 4000
/** PostgREST sits behind nginx `client_max_body_size 2m`; stay well below. */
const SAVE_CHUNK_BYTES = 1_200_000
/** Broadcast payloads are kept small; a big paste goes through the database instead. */
const BROADCAST_MAX_BYTES = 180_000

type Tick = {
  k: string
  els?: SyncElement[]
  files?: Record<string, SceneFile>
  set?: Record<string, unknown>
  cur?: { x: number; y: number; t?: string; b?: string } | null
  ink?: InkDelta[]
  hello?: boolean
  reload?: string
  /** Too much for one message: ask peers to pull the scene from the database. */
  pull?: boolean
}

export class CanvasSession<E extends SyncElement> {
  readonly key = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  private channel: RealtimeChannel | null = null
  private peers: Peer[] = []
  private peerInfo = new Map<string, Peer>()
  private pendingBroadcast = new Map<string, E>()
  private pendingSave = new Map<string, E>()
  private pendingFiles: Record<string, SceneFile> = {}
  private broadcastFiles: Record<string, SceneFile> = {}
  private pendingSettings: Record<string, unknown> | null = null
  private broadcastSettings: Record<string, unknown> | null = null
  private cursor: Tick['cur'] | undefined
  private ink: InkDelta[] = []
  private pull = false
  private tickTimer: number | undefined
  private saveTimer: number | undefined
  private firstPendingAt = 0
  private saving: Promise<void> | null = null
  private saveFails = 0
  private retry = 0
  private retryTimer: number | undefined
  private joinedOnce = false
  private disposed = false
  private ready = false
  private buffered: Tick[] = []
  private token: string | null = null
  private live = false

  constructor(private pageId: string, private me: Me, private h: SessionHandlers<E>) {}

  // ── Channel ────────────────────────────────────────────────────────────────
  async connect() {
    if (this.disposed) return
    if (this.channel) { void supabase.removeChannel(this.channel); this.channel = null }
    const { data } = await supabase.auth.getSession()
    this.token = data.session?.access_token ?? null
    // Realtime keeps its own copy of the token; a private channel is checked with it.
    if (this.token) supabase.realtime.setAuth(this.token)
    if (this.disposed) return
    const ch = supabase.channel(`canvas:${this.pageId}`, {
      config: { private: true, broadcast: { self: false }, presence: { key: this.key } },
    })
    ch.on('broadcast', { event: 'tick' }, ({ payload }) => this.receive(payload as Tick))
    ch.on('presence', { event: 'sync' }, () => this.syncPresence())
    ch.subscribe((status) => {
      if (this.disposed) return
      if (status === 'SUBSCRIBED') {
        this.retry = 0
        this.setLive(true)
        void ch.track({ uid: this.me.uid, name: this.me.name, color: this.me.color, avatar: this.me.avatar ?? null, canWrite: this.me.canWrite })
        // Anyone already here re-sends what they have not saved yet (see receive).
        if (this.me.canWrite) this.send({ k: this.key, hello: true })
        if (this.joinedOnce) this.h.onResync()
        this.joinedOnce = true
        return
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.setLive(false)
        const delay = Math.min(30_000, 1000 * 2 ** this.retry++)
        window.clearTimeout(this.retryTimer)
        this.retryTimer = window.setTimeout(() => void this.connect(), delay)
      }
    })
    this.channel = ch
  }

  /** Name, avatar or permission arrived after the session started (profile / role load late). */
  updateMe(me: Me) {
    const changed = me.name !== this.me.name || me.avatar !== this.me.avatar || me.canWrite !== this.me.canWrite || me.color !== this.me.color
    this.me = me
    if (changed && this.live && this.channel) {
      void this.channel.track({ uid: me.uid, name: me.name, color: me.color, avatar: me.avatar ?? null, canWrite: me.canWrite })
    }
  }

  /** Remote events wait until the first scene from the database is on screen. */
  markReady() {
    this.ready = true
    const queued = this.buffered
    this.buffered = []
    for (const t of queued) this.receive(t)
  }

  private setLive(v: boolean) {
    if (this.live === v) return
    this.live = v
    this.h.onLive(v)
  }

  private syncPresence() {
    const state = this.channel?.presenceState() as Record<string, { uid: string; name: string; color: string; avatar?: string | null; canWrite: boolean }[]> | undefined
    const next: Peer[] = []
    for (const [key, metas] of Object.entries(state ?? {})) {
      const m = metas[metas.length - 1]
      if (!m) continue
      next.push({ key, uid: m.uid, name: m.name, color: m.color, avatar: m.avatar ?? null, canWrite: !!m.canWrite, self: key === this.key })
    }
    // Someone left: their cursor and half-drawn ink go with them.
    for (const old of this.peers) if (!next.some((p) => p.key === old.key)) this.h.onCursor(old.key, null)
    this.peers = next
    this.peerInfo = new Map(next.map((p) => [p.key, p]))
    this.h.onPeers(next)
  }

  /** Others in the room (not this tab). */
  get othersCount() { return this.peers.filter((p) => !p.self).length }

  /** One message per tick; slower as the room fills up (see the budget note on top). */
  private tickMs() { return Math.min(1000, 160 * Math.max(1, this.othersCount)) }

  private receive(t: Tick) {
    if (!t || t.k === this.key) return
    if (!this.ready) { this.buffered.push(t); return }
    const who = this.peerInfo.get(t.k)
    if (t.reload) { this.h.onReload(t.reload); return }
    if (t.hello) {
      // A newcomer loaded the scene from the database; what we have not saved
      // yet is not there. Send it once more and save it now.
      if (this.pendingSave.size) {
        for (const [id, el] of this.pendingSave) this.pendingBroadcast.set(id, el)
        this.scheduleTick()
      }
      void this.flush()
    }
    if (t.pull) this.h.onResync()
    if (t.els?.length) this.h.onElements(t.els as E[])
    if (t.files && Object.keys(t.files).length) this.h.onFiles(t.files)
    if (t.set) this.h.onSettings(t.set)
    if (t.ink?.length && this.h.onInk) for (const d of t.ink) this.h.onInk(t.k, d)
    if (t.cur !== undefined) {
      this.h.onCursor(t.k, t.cur && who ? { key: t.k, uid: who.uid, name: who.name, color: who.color, x: t.cur.x, y: t.cur.y, tool: t.cur.t, button: t.cur.b } : null)
    }
  }

  private send(t: Tick) {
    const ch = this.channel
    if (!ch || !this.live) return
    void ch.send({ type: 'broadcast', event: 'tick', payload: t })
  }

  // ── Outgoing ───────────────────────────────────────────────────────────────
  /** Local changes: broadcast soon, save after a pause. */
  push(els: E[]) {
    if (!this.me.canWrite || !els.length) return
    for (const el of els) {
      const prev = this.pendingSave.get(el.id)
      if (!prev || el.version >= prev.version) this.pendingSave.set(el.id, el)
      this.pendingBroadcast.set(el.id, el)
    }
    this.scheduleTick()
    this.scheduleSave()
  }

  /**
   * A change still in progress (a drag, a resize, text being typed): the others
   * see it move, nothing is saved — the final state comes through `push`.
   */
  pushLive(els: E[]) {
    if (!this.me.canWrite || !els.length || this.othersCount === 0) return
    for (const el of els) this.pendingBroadcast.set(el.id, el)
    this.scheduleTick()
  }

  pushFiles(files: Record<string, SceneFile>) {
    if (!this.me.canWrite) return
    Object.assign(this.pendingFiles, files)
    Object.assign(this.broadcastFiles, files)
    this.scheduleTick()
    this.scheduleSave()
  }

  pushSettings(patch: Record<string, unknown>) {
    if (!this.me.canWrite) return
    this.pendingSettings = { ...(this.pendingSettings ?? {}), ...patch }
    this.broadcastSettings = { ...(this.broadcastSettings ?? {}), ...patch }
    this.scheduleTick()
    this.scheduleSave()
  }

  /** Pointer position in scene coordinates; null when it leaves the canvas. */
  moveCursor(x: number | null, y?: number, extra?: { tool?: string; button?: string }) {
    if (!this.me.canWrite) return
    this.cursor = x === null ? null : { x: Math.round(x * 10) / 10, y: Math.round((y ?? 0) * 10) / 10, t: extra?.tool, b: extra?.button }
    this.scheduleTick()
  }

  pushInk(delta: InkDelta) {
    if (!this.me.canWrite) return
    this.ink.push(delta)
    this.scheduleTick()
  }

  /** After a version restore: everyone reloads from the server. */
  announceReload() { this.send({ k: this.key, reload: this.me.name }) }

  private scheduleTick() {
    if (this.tickTimer !== undefined) return
    this.tickTimer = window.setTimeout(() => { this.tickTimer = undefined; this.tick() }, this.tickMs())
  }

  private tick() {
    if (this.disposed) return
    const t: Tick = { k: this.key }
    // Alone in the room: nothing to tell anyone (the database gets it anyway).
    if (this.othersCount === 0 || !this.live) {
      this.pendingBroadcast.clear(); this.broadcastFiles = {}; this.broadcastSettings = null; this.cursor = undefined; this.ink = []; this.pull = false
      return
    }
    if (this.pendingBroadcast.size) {
      const els = [...this.pendingBroadcast.values()]
      this.pendingBroadcast.clear()
      if (JSON.stringify(els).length > BROADCAST_MAX_BYTES) {
        // A big paste or import: save first, then let the others pull it.
        this.pull = true
        void this.flush().then(() => { this.scheduleTick() })
      } else t.els = els
    }
    if (Object.keys(this.broadcastFiles).length) { t.files = this.broadcastFiles; this.broadcastFiles = {} }
    if (this.broadcastSettings) { t.set = this.broadcastSettings; this.broadcastSettings = null }
    if (this.cursor !== undefined) { t.cur = this.cursor; this.cursor = undefined }
    if (this.ink.length) { t.ink = this.ink; this.ink = [] }
    if (this.pull && !this.pendingSave.size && !this.saving) { t.pull = true; this.pull = false }
    if (Object.keys(t).length > 1) this.send(t)
  }

  // ── Saving ─────────────────────────────────────────────────────────────────
  private scheduleSave() {
    const now = Date.now()
    if (!this.firstPendingAt) this.firstPendingAt = now
    window.clearTimeout(this.saveTimer)
    const wait = Math.max(0, Math.min(SAVE_QUIET_MS, SAVE_MAX_WAIT_MS - (now - this.firstPendingAt)))
    this.saveTimer = window.setTimeout(() => void this.flush(), wait)
  }

  get hasUnsaved() { return this.pendingSave.size > 0 || Object.keys(this.pendingFiles).length > 0 || !!this.pendingSettings }

  /** Write everything pending now (one write at a time). */
  flush(): Promise<void> {
    if (this.saving) return this.saving.then(() => (this.hasUnsaved ? this.flush() : undefined))
    if (!this.hasUnsaved) return Promise.resolve()
    window.clearTimeout(this.saveTimer)
    this.firstPendingAt = 0
    const els = [...this.pendingSave.values()]
    const files = this.pendingFiles
    const settings = this.pendingSettings
    this.pendingSave = new Map()
    this.pendingFiles = {}
    this.pendingSettings = null
    this.h.onSaveState('saving')
    const run = async () => {
      try {
        const chunks = chunkElements(els)
        for (let i = 0; i < chunks.length; i++) {
          const { error } = await supabase.rpc('save_page_scene', {
            p_page: this.pageId,
            p_elements: chunks[i],
            p_files: i === 0 && Object.keys(files).length ? files : null,
            p_settings: i === 0 ? settings : null,
          })
          if (error) throw error
        }
        this.saveFails = 0
        this.h.onSaveState(this.hasUnsaved ? 'saving' : 'saved')
      } catch (e) {
        // Put it back (unless something newer arrived meanwhile) and try again later.
        for (const el of els) { const cur = this.pendingSave.get(el.id); if (!cur || cur.version < el.version) this.pendingSave.set(el.id, el) }
        this.pendingFiles = { ...files, ...this.pendingFiles }
        if (settings) this.pendingSettings = { ...settings, ...(this.pendingSettings ?? {}) }
        this.saveFails++
        const offline = typeof navigator !== 'undefined' && !navigator.onLine
        this.h.onSaveState(offline ? 'offline' : 'error')
        if (!offline) console.warn('[fira] tuval kaydedilemedi:', (e as { message?: string })?.message ?? e)
        window.clearTimeout(this.saveTimer)
        this.saveTimer = window.setTimeout(() => void this.flush(), Math.min(30_000, 2000 * 2 ** (this.saveFails - 1)))
      } finally {
        this.saving = null
      }
    }
    this.saving = run()
    return this.saving
  }

  /**
   * The tab is closing: a normal request would be cancelled. `keepalive` lets
   * it finish, within the browser's 64 KB budget — enough for the last few
   * strokes, which is what is usually pending at that moment.
   */
  flushOnUnload() {
    if (!this.hasUnsaved || !this.token) return
    const body = JSON.stringify({
      p_page: this.pageId,
      p_elements: [...this.pendingSave.values()],
      p_files: Object.keys(this.pendingFiles).length ? this.pendingFiles : null,
      p_settings: this.pendingSettings,
    })
    if (body.length > 60_000) { void this.flush(); return }
    try {
      void fetch(`${SUPABASE_URL}/rest/v1/rpc/save_page_scene`, {
        method: 'POST',
        keepalive: true,
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body,
      })
      this.pendingSave.clear(); this.pendingFiles = {}; this.pendingSettings = null
    } catch { void this.flush() }
  }

  dispose() {
    this.disposed = true
    window.clearTimeout(this.tickTimer)
    window.clearTimeout(this.retryTimer)
    window.clearTimeout(this.saveTimer)
    if (this.hasUnsaved) void this.flush()
    if (this.channel) { void this.channel.untrack(); void supabase.removeChannel(this.channel); this.channel = null }
  }
}

/** Split a save so no single request crosses the body limit. */
function chunkElements<E>(els: E[]): E[][] {
  const out: E[][] = []
  let cur: E[] = []
  let size = 0
  for (const el of els) {
    const n = JSON.stringify(el).length + 1
    if (cur.length && size + n > SAVE_CHUNK_BYTES) { out.push(cur); cur = []; size = 0 }
    cur.push(el); size += n
  }
  if (cur.length || !out.length) out.push(cur)
  return out
}

// ── Loading ──────────────────────────────────────────────────────────────────

export interface StoredScene {
  elements: unknown[]
  files: Record<string, SceneFile>
  settings: Record<string, unknown>
  rev: number
  updated_at: string | null
  updated_by: string | null
}

/** The saved scene; an empty one when nothing was saved yet (a new canvas). */
export async function fetchScene(pageId: string): Promise<StoredScene> {
  const { data, error } = await supabase.from('page_scenes').select('elements, files, settings, rev, updated_at, updated_by').eq('page_id', pageId).maybeSingle()
  if (error) throw error
  return {
    elements: Array.isArray(data?.elements) ? (data!.elements as unknown[]) : [],
    files: (data?.files as Record<string, SceneFile>) ?? {},
    settings: (data?.settings as Record<string, unknown>) ?? {},
    rev: (data?.rev as number) ?? 0,
    updated_at: (data?.updated_at as string) ?? null,
    updated_by: (data?.updated_by as string) ?? null,
  }
}
