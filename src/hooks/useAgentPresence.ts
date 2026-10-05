import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { AgentPresence } from '../lib/agents'

/**
 * Whether each agent's listener is in its presence channel right now (104).
 *
 * One private channel per agent (`agent:<id>`): the listener tracks itself in
 * it, this hook only watches. Realtime tells of a leave the moment the
 * listener's socket closes, so "Dinliyor" follows the process instead of a
 * heartbeat window. Only the screens that show the status join — Claude'um and
 * the agent panel — and they leave when they close.
 *
 * 'unknown' until the channel answers (or when it cannot be joined); the
 * caller then falls back to the heartbeat (`agentOnline`).
 */
export function useAgentPresence(agentIds: string[]): Record<string, AgentPresence> {
  const qc = useQueryClient()
  const [state, setState] = useState<Record<string, AgentPresence>>({})
  const key = [...agentIds].sort().join(',')

  useEffect(() => {
    const ids = key ? key.split(',') : []
    if (!ids.length) return
    let disposed = false
    const channels = new Map<string, RealtimeChannel>()
    const timers = new Map<string, number>()
    const attempts = new Map<string, number>()
    let refetch: number | undefined

    const set = (id: string, value: AgentPresence) => {
      if (disposed) return
      setState((s) => (s[id] === value ? s : { ...s, [id]: value }))
    }
    // A listener that only lost its live connection says so in its agent row a moment
    // later (watch: 'poll'); read the row again so the heartbeat rule can take over.
    const rereadAgents = () => {
      window.clearTimeout(refetch)
      refetch = window.setTimeout(() => { if (!disposed) void qc.invalidateQueries({ queryKey: ['agents'] }) }, 1500)
    }

    const join = async (id: string) => {
      if (disposed) return
      const old = channels.get(id)
      if (old) { channels.delete(id); void supabase.removeChannel(old) }
      // Realtime keeps its own copy of the token; a private channel is checked with it.
      const { data } = await supabase.auth.getSession()
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token)
      if (disposed) return
      const ch = supabase.channel(`agent:${id}`, { config: { private: true } })
      const read = () => { set(id, Object.keys(ch.presenceState()).length > 0 ? 'present' : 'absent'); rereadAgents() }
      ch.on('presence', { event: 'sync' }, read)
      ch.subscribe((status) => {
        if (disposed || channels.get(id) !== ch) return
        if (status === 'SUBSCRIBED') { attempts.set(id, 0); return }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          set(id, 'unknown')
          const n = attempts.get(id) ?? 0
          attempts.set(id, n + 1)
          window.clearTimeout(timers.get(id))
          timers.set(id, window.setTimeout(() => void join(id), Math.min(30_000, 2000 * 2 ** n)))
        }
      })
      channels.set(id, ch)
    }
    for (const id of ids) void join(id)

    return () => {
      disposed = true
      window.clearTimeout(refetch)
      for (const t of timers.values()) window.clearTimeout(t)
      for (const ch of channels.values()) void supabase.removeChannel(ch)
      channels.clear()
    }
  }, [key, qc])

  return state
}
