/**
 * Parser check for the spreadsheet import — no DB, no browser.
 *
 *   npx esbuild scripts/check-import.ts --bundle --platform=node --format=cjs \
 *     --outfile=.check-import.cjs --external:xlsx --external:papaparse
 *   node .check-import.cjs <örnek-dosyalar-klasörü>   &&   rm .check-import.cjs
 *
 * Point it at a folder of tool exports (Planner .xlsx and friends). Sample files
 * are customer data and are NOT in the repo — use the ones attached to the ticket.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readWorkbook } from '../src/lib/backup/sheet'
import { detectPlanner, buildPlannerPlan } from '../src/lib/backup/planner'

const dir = process.argv[2]
if (!dir) { console.error('Kullanım: node .check-import.cjs <klasör>'); process.exit(1) }

// A stand-in team: two members, the default Fira columns.
const existing = {
  statuses: [
    { name: 'Yapılacak', category: 'backlog' as const },
    { name: 'Devam Ediyor', category: 'active' as const },
    { name: 'Tamamlandı', category: 'done' as const },
  ],
  tags: [] as string[],
  users: [
    { email: 'ilker.topcu@epiuse.com', name: 'Ali İlker Topçu' },
    { email: 'Halil.Aydin@epiuse.com', name: 'Halil Ibrahim Aydin' },
  ],
}

async function main() {
  for (const name of readdirSync(dir).filter((f) => /\.(xlsx|xlsm|xls|csv)$/i.test(f))) {
    const file = new File([readFileSync(join(dir, name))], name)
    const wb = await readWorkbook(file)
    console.log('==========', name)
    console.log('  sayfalar:', wb.sheets.map((s) => `${s.name}(${s.rows.length})`).join(', '))
    const doc = detectPlanner(wb)
    if (!doc) { console.log('  Planner dışa aktarımı değil — elle sütun eşleme gerekir'); continue }
    console.log(`  plan="${doc.planName}" görev sayfası=${doc.taskSheet} görev=${doc.tasks.length} kutu=${doc.buckets.join(' · ')} kişi=${doc.users.length}`)
    for (const columnSource of ['bucket', 'progress'] as const) {
      const r = buildPlannerPlan(doc, { columnSource, checklistAsSubtasks: true, completedToDone: true }, existing)
      const parents = r.plan.tickets.filter((t) => !t.parentKey)
      console.log(`  [${columnSource}] ${parents.length} görev + ${r.plan.tickets.length - parents.length} alt görev · sütun: ${r.plan.newStatuses.map((s) => `${s.name}(${s.category})`).join(', ')}`)
      console.log(`           etiket: ${r.plan.newTags.length} · not: ${r.stats.withNotes} · eşleşen kişi: ${r.stats.matchedUsers} · uyarı: ${r.warnings.length}`)
      console.log(`           tamamlandıya taşınan: ${r.stats.movedToDone} · tamamlanma kaydı: ${r.stats.completions} · aktörü eşleşen: ${r.plan.tickets.filter((t) => t.completion?.email).length}`)
      const byStatus = new Map<string, number>()
      for (const t of parents) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1)
      console.log(`           sütun dağılımı: ${[...byStatus].map(([k, v]) => `${k}=${v}`).join(' · ')}`)
      const lost = parents.filter((t) => !t.title).length
      if (lost) console.log(`           !! başlıksız ${lost} satır atlandı`)
    }
  }
}
main()
