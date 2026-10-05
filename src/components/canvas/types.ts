import type { Me, Peer, SaveState } from '../../lib/canvas/session'

/** What CanvasView hands to the drawing / the whiteboard (both lazy chunks). */
export interface CanvasProps {
  pageId: string
  teamId: string
  title: string
  canWrite: boolean
  me: Me
  /** Bumped after this user restored a version: reload from the server and tell the others. */
  reloadToken: number
  onPeers: (peers: Peer[]) => void
  onSaveState: (s: SaveState) => void
  onLive: (live: boolean) => void
  /** Whether the canvas holds anything — a blank new canvas is removed on leave. */
  onEmptyChange: (empty: boolean) => void
  /** Someone else restored a version. */
  onRemoteRestore: (byName: string) => void
}
