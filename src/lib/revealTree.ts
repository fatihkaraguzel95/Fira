/**
 * "Bu sayfa nerede duruyor?" — bir düğümü soldaki ağaçta gösterme (#58fab188).
 *
 * Aramayla bulunup açılan bir sayfanın ağaçtaki yeri görünmüyordu. Sayfanın
 * üstündeki konum satırının her parçası artık bunu ister: kenar çubuğu
 * "Takımlar" paneline geçer, **yalnız yol üzerindeki** dallar açılır (hedef ve
 * kardeşleri görünsün diye; bütün takımı açmak aradığın satırı kalabalığa
 * gömüyor), satır görünür alana kaydırılır ve kısa bir vurguyla işaretlenir.
 *
 * İstek bir olayla gider; ama panel kapalıyken takım bloğu takılı değildir ve
 * olayı kimse duymaz. Bu yüzden istek kısa bir süre saklanır da: blok takılınca
 * `pendingReveal` ile görür. İstek numaralıdır — kenar çubuğu aynı anda iki kez
 * çizilebildiği için (telefon çekmecesi + masaüstü paneli) her kopya isteği
 * kendisi uygular, ama her biri bir kez.
 */
import { FOLDER, LIST, PAGE } from '../components/layout/treeDnd'

export type TreeNodeKind = 'team' | 'folder' | 'list' | 'page'

export interface RevealRequest {
  teamId: string
  /** Kaydırılıp vurgulanacak satır. */
  node: { kind: TreeNodeKind; id: string }
  /** Yol üzerindeki klasörler (dıştan içe) — kapalıysa açılır. */
  folderIds?: string[]
  /** Hedef bir listenin altındaysa o liste. */
  listId?: string | null
  /** Yol üzerindeki üst sayfalar (hedefin kendisi değil). */
  pageIds?: string[]
  /**
   * Konum çubuğu menüsünden "Tümünü aç/kapat" (#c675e160): gösterdikten sonra
   * bu dalı (klasör ya da `null` = bütün takım) açar ya da kapatır.
   */
  branch?: { folderId: string | null; open: boolean }
}

const EVENT = 'fira:reveal-tree'
/** Panel açılıp takım bloğu takılana kadar geçen süre; sonrası bayat sayılır. */
const PENDING_MS = 10_000

let pending: { req: RevealRequest; id: number; at: number } | null = null
let seq = 0

export function revealInTree(req: RevealRequest) {
  pending = { req, id: ++seq, at: Date.now() }
  window.dispatchEvent(new CustomEvent<RevealRequest>(EVENT, { detail: req }))
}

export function onRevealRequest(fn: (r: RevealRequest) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<RevealRequest>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

/** O takım için bekleyen istek; numarasıyla, çünkü tüketilmiyor (her kopya bir kez uygular). */
export function pendingReveal(teamId: string): { req: RevealRequest; id: number } | null {
  if (!pending || pending.req.teamId !== teamId || Date.now() - pending.at > PENDING_MS) return null
  return { req: pending.req, id: pending.id }
}

/** Satırın DOM'daki işareti; önekler sürükle-bırak kimlikleriyle aynı (treeDnd.ts). */
export const treeRowSelector = (kind: TreeNodeKind, id: string) =>
  kind === 'team'
    ? `[data-team-dnd="team:${id}"]`
    : `[data-dnd-id="${kind === 'folder' ? FOLDER : kind === 'list' ? LIST : PAGE}${id}"]`

/**
 * Satırı görünür alana getirip vurgular. Dal daha yeni açıldığı için satır
 * hemen olmayabilir: kısa aralıklarla birkaç saniye aranır. Kenar çubuğu iki
 * kez çizildiğinden (çekmece + panel) **görünen** kopyalar alınır; gizli
 * kopyada ne kaydırma ne vurgu bir işe yarar.
 */
export function revealRow(kind: TreeNodeKind, id: string) {
  let tries = 0
  const tick = window.setInterval(() => {
    const rows = [...document.querySelectorAll<HTMLElement>(treeRowSelector(kind, id))].filter((el) => el.getClientRects().length > 0)
    if (rows.length) {
      window.clearInterval(tick)
      for (const el of rows) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.classList.add('fira-row-flash')
        window.setTimeout(() => el.classList.remove('fira-row-flash'), 2400)
      }
      return
    }
    if (++tries > 40) window.clearInterval(tick)
  }, 120)
}
