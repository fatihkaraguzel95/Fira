// Çalıştırma: npx esbuild scripts/check-drop.ts --bundle --platform=node --format=cjs --log-level=warning | node
// Kanban'da sütunlar arası bırakmada ekleme konumunu (src/lib/dropIndex.ts) tarayıcısız doğrular.
import { dropIndex } from '../src/lib/dropIndex'

const cases: { name: string; args: Parameters<typeof dropIndex>[0]; expect: number }[] = [
  { name: 'kartın üst yarısına → önüne', args: { length: 3, overIdx: 1, activeMid: 100, overMid: 120 }, expect: 1 },
  { name: 'kartın alt yarısına → arkasına', args: { length: 3, overIdx: 1, activeMid: 140, overMid: 120 }, expect: 2 },
  { name: 'son kartın altına → sona', args: { length: 3, overIdx: 2, activeMid: 500, overMid: 400 }, expect: 3 },
  { name: 'sütun başlığı/hızlı ekleme üzerinde (ilk kartın üstü) → en üste', args: { length: 3, overIdx: -1, activeMid: 80, firstMid: 150 }, expect: 0 },
  { name: 'sütunun boş alt kısmı → sona', args: { length: 3, overIdx: -1, activeMid: 900, firstMid: 150 }, expect: 3 },
  { name: 'boş sütun → 0', args: { length: 0, overIdx: -1, activeMid: 200, firstMid: null }, expect: 0 },
  { name: 'konum bilinmiyor, kart üzerinde → önüne', args: { length: 3, overIdx: 1, activeMid: null, overMid: 120 }, expect: 1 },
  { name: 'konum bilinmiyor, sütun üzerinde → sona', args: { length: 3, overIdx: -1, activeMid: null, firstMid: 150 }, expect: 3 },
]

let failed = 0
for (const c of cases) {
  const got = dropIndex(c.args)
  const ok = got === c.expect
  if (!ok) failed++
  console.log(`${ok ? 'GEÇTİ' : '*** KALDI ***'}  ${c.name}  (beklenen ${c.expect}, gelen ${got})`)
}
console.log(`${cases.length - failed}/${cases.length} kontrol geçti`)
process.exit(failed ? 1 : 0)
