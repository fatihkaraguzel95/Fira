import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { emitError } from '../lib/errorToast'
import { t } from '../i18n'
import { useAuth } from './useAuth'

/**
 * Server-side user preferences (table user_preferences, RPC merge_user_prefs).
 *
 * Forward compatible by design: the server merges patches key by key (one
 * nested level) and treats `null` as "delete this key", so a tab running an
 * older build never wipes keys it does not know about, and new keys added in
 * later versions survive. Unknown keys are carried through untouched.
 */
export type Prefs = Record<string, unknown>

/** Sessizlik süresi: son değişiklikten bu kadar sonra tek bir istek gider. */
const DEBOUNCE_MS = 600
/** Değişiklik akmayı sürdürürse yazma sonsuza kadar ertelenmesin (üst sınır). */
const MAX_WAIT_MS = 2500

/**
 * Scopes the server has actually answered for in this session. A `patch()`
 * before the first fetch seeds the query with a partial object, and React
 * Query then counts the query as fetched — which made `loaded` true on
 * `{ recents }` alone and drew the ticket window in the wrong frame for a
 * moment (#541947B0). Only a real answer counts.
 */
const answered = new Set<string>()

/**
 * Aynı kapsamı 26 yerde `usePrefs` kullanıyor. Yazma sırası, bekleyen yama ve
 * önbellek anahtarı **kapsam başına** tutulur — bileşen başına değil (kullanıcı
 * kaydı, #6dcda6e5).
 *
 * Üç turda üç arıza aynı kökten çıktı:
 *  1. Her bileşen kendi yazmasının cevabını önbelleğe basıyordu; geç dönen eski
 *     fotoğraf yeni değeri siliyordu → kapsam başına sıra numarası (0.51.1).
 *  2. Gecikme de bileşen başınaydı; üç bileşen aynı saniyede yazınca üç istek
 *     çıkıp yarışıyordu → kapsam başına tek tampon, tek istek (0.55.1).
 *  3. Tampon anahtarı `${user}:${scope}` idi, ama `useAuth` her bileşende ayrı
 *     çözülüyor: kullanıcısı henüz gelmemiş bir çağıran `undefined:global` diye
 *     **ikinci bir tampon** açıyordu. İki tampon = iki istek = yine yarış:
 *     görev penceresi açıkken ayar 200 ms sonra eski değerine dönüyordu
 *     (0.57.1). Artık anahtar yalnız kapsam; kullanıcı kimliği kapsamın
 *     "sahibi" olarak bir kez çözülüp bütün yazmalarda kullanılıyor.
 */
const issued = new Map<string, number>()
const settled = new Map<string, number>()
const lastWriteAt = new Map<string, number>()

/** Kapsamın çözülmüş sahibi: önbellek anahtarı çağırandan bağımsız kurulsun. */
const owner = new Map<string, { id: string; qc: QueryClient }>()
const keyFor = (scope: string) => ['prefs', owner.get(scope)?.id ?? null, scope]

interface Buffer {
  /** Henüz gönderilmemiş yama. */
  patch: Prefs
  /**
   * Gönderildi ama sunucuda **görüldüğü doğrulanmadı**. Yazma başarısız olduysa
   * ya da sunucunun döndürdüğü nesne bizim değeri taşımıyorsa burada kalır ve
   * okumaların üstüne yeniden uygulanır; yoksa ayar bir süre doğru görünüp ilk
   * tazelemede sessizce eski değerine dönüyor.
   */
  inflight: Prefs
  timer?: number
  /** İlk gönderilmemiş değişikliğin zamanı — üst sınır buradan sayılır. */
  since: number
  /** Üst üste başarısız yazma sayısı: geri çekilme ve tek seferlik uyarı için. */
  fails: number
  /** Cevabı beklenen bir istek var mı: aynı yamayı ikinci kez göndermeyelim. */
  sending: boolean
  /** Tamponu boşaltan çağrı; sekme kapanırken de bu kullanılır. */
  run?: () => void
}
const buffers = new Map<string, Buffer>()
const bufferOf = (scope: string): Buffer => {
  const cur = buffers.get(scope)
  if (cur) return cur
  const next: Buffer = { patch: {}, inflight: {}, since: 0, fails: 0, sending: false }
  buffers.set(scope, next)
  return next
}

/** Sunucudan gelenin üstüne binecek yerel katman: gönderilmemiş + doğrulanmamış. */
const overlayOf = (scope: string): Prefs => {
  const b = buffers.get(scope)
  return b ? mergeLocal(b.inflight, b.patch, true) : {}
}

/** Yazdığımız değerlerden sunucunun cevabında görünmeyenler (nadir: yazma tutmamış). */
function unverified(sent: Prefs, server: Prefs): Prefs {
  const out: Prefs = {}
  for (const [key, v] of Object.entries(sent)) {
    const got = server[key]
    if (v === null ? got === undefined || got === null : JSON.stringify(got) === JSON.stringify(v)) continue
    out[key] = v
  }
  return out
}

async function flushScope(scope: string, qc: QueryClient) {
  const buf = buffers.get(scope)
  if (!buf) return
  window.clearTimeout(buf.timer)
  buf.timer = undefined
  // Cevabı beklenen bir istek varken ikincisini açma: görev penceresi biçim
  // değiştirince onlarca bileşen sökülüp takılıyor ve her sökülme tamponu
  // boşaltıyordu — tek tıklama için beş özdeş istek çıkıyordu.
  if (buf.sending) return
  // Gönderilmemiş yama ile daha önce gönderilip doğrulanmamış olan birlikte gider.
  const patch = mergeLocal(buf.inflight, buf.patch, true)
  buf.patch = {}
  buf.inflight = patch
  buf.since = 0
  if (Object.keys(patch).length === 0) return
  const seq = (issued.get(scope) ?? 0) + 1
  issued.set(scope, seq)
  const client = owner.get(scope)?.qc ?? qc
  buf.sending = true
  try {
    const { data, error } = await supabase.rpc('merge_user_prefs', { p_scope: scope, p_patch: patch })
    if (error) throw error
    lastWriteAt.set(scope, Date.now())
    const cur = bufferOf(scope)
    // Sunucu bizim değeri geri veriyorsa iş bitti; vermiyorsa katmanda kalsın
    // ve birkaç kez daha denensin (sonra sunucunun dediği doğru kabul edilir).
    cur.inflight = unverified(patch, (data ?? {}) as Prefs)
    const unconfirmed = Object.keys(cur.inflight).length > 0
    cur.fails = unconfirmed ? cur.fails + 1 : 0
    if (unconfirmed && cur.fails >= 3) cur.inflight = {}
    // Daha yeni bir yazma gitmişse bu cevap eskidir; ekrana basma.
    if (seq >= (settled.get(scope) ?? 0)) {
      settled.set(scope, seq)
      client.setQueryData(keyFor(scope), mergeLocal(data as Prefs, overlayOf(scope)))
    }
  } catch (e) {
    // Ekrandaki iyimser değer kalır (katman sayesinde tazeleme de bozamaz) ve
    // artan aralıklarla yeniden denenir. Üst üste üç denemede olmuyorsa
    // kullanıcıya söylenir: sessizce kaybolan ayar en kötüsü.
    const cur = bufferOf(scope)
    cur.fails++
    if (cur.fails === 3) emitError(e, t('settings.prefsSaveFailed'))
  } finally {
    const cur = bufferOf(scope)
    cur.sending = false
    // Bekleyen ya da doğrulanmamış bir şey kaldıysa yeniden sıraya gir.
    if (Object.keys(cur.patch).length || Object.keys(cur.inflight).length) {
      if (!cur.since) cur.since = Date.now()
      window.clearTimeout(cur.timer)
      cur.timer = window.setTimeout(() => void flushScope(scope, client), cur.fails ? Math.min(3000 * 2 ** (cur.fails - 1), 30_000) : DEBOUNCE_MS)
    }
  }
}

/** Zamanlayıcıyı kurar: sessizlikte gider, ama ilk değişiklikten en geç MAX_WAIT_MS sonra. */
function arm(scope: string, qc: QueryClient) {
  const buf = bufferOf(scope)
  if (!buf.since) buf.since = Date.now()
  buf.run = () => void flushScope(scope, qc)
  window.clearTimeout(buf.timer)
  const delay = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - (Date.now() - buf.since)))
  buf.timer = window.setTimeout(() => void flushScope(scope, qc), delay)
}

// Sekme kapanırken ya da arkaplana geçerken bekleyen yama gitsin: yazma artık
// gecikmeli, "ayarı değiştirip hemen kapattım" kaybolmamalı.
if (typeof window !== 'undefined') {
  const flushAll = () => { for (const b of buffers.values()) b.run?.() }
  window.addEventListener('pagehide', flushAll)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll() })
}

export function usePrefs(scope: string | null) {
  const { user } = useAuth()
  const qc = useQueryClient()
  // Kapsamın sahibi: kullanıcısı çözülmüş ilk çağıran belirler, sonrakiler onu kullanır.
  if (scope && user?.id) owner.set(scope, { id: user.id, qc })
  const key = scope ? keyFor(scope) : ['prefs', null, null]

  const query = useQuery({
    queryKey: key,
    enabled: !!user && !!scope,
    staleTime: 60_000,
    queryFn: async (): Promise<Prefs> => {
      const startedAt = Date.now()
      const { data, error } = await supabase.from('user_preferences').select('prefs').eq('scope', scope!).maybeSingle()
      if (error) throw error
      answered.add(`${user?.id}:${scope}`)
      const server = (data?.prefs as Prefs) ?? {}
      // Okuma sonuçlanırken araya bir yazma girdiyse sunucunun verdiği fotoğraf
      // o yazmadan önceye ait olabilir; o zaman ekrandaki değer doğrudur.
      const cached = qc.getQueryData<Prefs>(key)
      const stale = (lastWriteAt.get(scope!) ?? 0) > startedAt && !!cached
      return mergeLocal(stale ? (cached as Prefs) : server, overlayOf(scope!))
    },
  })

  /** Apply a patch optimistically and persist it (debounced, one request per scope). Use `null` to delete a key. */
  const patch = useCallback((p: Prefs) => {
    if (!scope) return
    const buf = bufferOf(scope)
    buf.patch = mergeLocal(buf.patch, p, true)
    qc.setQueryData(keyFor(scope), (old: Prefs | undefined) => mergeLocal(old ?? {}, p))
    arm(scope, qc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, user?.id])

  // Kapsam değişince (liste değiştirme) bekleyeni gönder; bileşenin kendisi
  // gidince değil — tampon kapsamın, bileşenin değil.
  useEffect(() => {
    if (!scope) return
    return () => { buffers.get(scope)?.run?.() }
  }, [scope])

  // `loaded` must mean "the prefs for THIS scope are actually here". useAuth keeps
  // its own state per component, so `user` is null for the first renders after a
  // mount; reporting "loaded" then handed callers an empty object as if it were
  // the truth — a client-side navigation back to the board applied {} and latched
  // it, wiping the saved view and filters (#1c92b701).
  return { prefs: query.data ?? {}, loaded: !scope ? true : (!!user && query.isFetched && answered.has(`${user.id}:${scope}`)), patch }
}

/** Same semantics as the server: one nested level merged, null deletes (kept as null when building a pending patch). */
function mergeLocal(base: Prefs, p: Prefs, keepNulls = false): Prefs {
  const out: Prefs = { ...base }
  for (const [k, v] of Object.entries(p)) {
    if (v === null) { if (keepNulls) out[k] = null; else delete out[k]; continue }
    if (isObj(v) && isObj(out[k])) {
      const inner: Prefs = { ...(out[k] as Prefs) }
      for (const [ik, iv] of Object.entries(v as Prefs)) {
        if (iv === null) { if (keepNulls) inner[ik] = null; else delete inner[ik] } else inner[ik] = iv
      }
      out[k] = inner
    } else out[k] = v
  }
  return out
}
const isObj = (x: unknown): x is Prefs => !!x && typeof x === 'object' && !Array.isArray(x)

/**
 * Send what is pending for `scope` now and resolve once the server has taken it
 * (false after `timeoutMs`). For the few settings the server itself reads — the
 * beta switches decide what RLS shows (096) — a caller has to refetch only
 * after the write landed, not after the local, optimistic one.
 */
export async function flushPrefsNow(scope: string, timeoutMs = 8000): Promise<boolean> {
  const started = Date.now()
  for (;;) {
    const b = buffers.get(scope)
    if (!b || (!b.sending && !Object.keys(b.patch).length && !Object.keys(b.inflight).length)) return true
    if (!b.sending) b.run?.()
    if (Date.now() - started > timeoutMs) return false
    await new Promise((r) => window.setTimeout(r, 120))
  }
}

export const listScope = (projectId: string) => `list:${projectId}`
export const GLOBAL_SCOPE = 'global'
