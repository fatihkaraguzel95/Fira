import type { StatusCategory } from '../../types'
import { pickColumn, type SheetTable, type WorkbookDoc } from './sheet'
import { PRIORITY_MAP, statusCategoryOf } from './fields'
import type { CsvPlan } from './import'
// `t` is the loop variable for tasks throughout this file, hence the alias.
import { t as translate } from '../../i18n'

/**
 * Microsoft Planner .xlsx adapter.
 *
 * A Planner export is one workbook with several sheets: the plan itself, the
 * tasks twice (once with GUIDs, once with display names), goals, buckets and
 * users. Nothing here reads a single flat table — the sheets are joined so the
 * import keeps everything the export carries:
 *
 *   bucket → column (status)      checklist items → subtasks
 *   labels → tags                 notes → description
 *   assignees → members by e-mail (unmatched names are written into the notes)
 *
 * Whatever Fira has no field for (task id, plan, goal, creator, completion,
 * recurrence, late flag, progress) is appended to the description as a
 * "Planner alanları" block rather than dropped.
 */

const RX = {
  planId: /^plan (kimliği|id)/i,
  planName: /^plan (adı|name)/i,
  planExported: /^(dışarı aktarma tarihi|export(ed)? date)/i,
  bucketId: /^(kutu|demet) (kimliği|id)|^bucket id/i,
  bucketName: /^(kutu|demet) (adı|name)|^bucket name/i,
  userId: /^(kullanıcı|user) (kimliği|id)/i,
  userName: /^(kullanıcı|user) (adı|name)/i,
  userMail: /^(e-?posta|e-?mail|upn)/i,
  taskId: /^görev (kimliği|id)|^task id/i,
  title: /^(görev adı|task name|title|başlık)/i,
  bucket: /^(kutu|demet|bucket)$/i,
  goal: /^(hedef|goal)/i,
  progress: /^(durum|progress|ilerleme)$/i,
  priority: /^(öncelik|priority)/i,
  assignees: /^(atanan|assigned to|assignees)/i,
  createdBy: /^(oluşturan|created by)/i,
  createdAt: /^(oluşturma tarihi|created date|created)/i,
  due: /^(son tarih|due date|bitiş tarihi)/i,
  start: /^(başlangıç tarihi|start date)/i,
  recurring: /^(yinelenen|recurr)/i,
  late: /^(geciken|late)/i,
  completedAt: /^(tamamlanma tarihi|completed date)/i,
  completedBy: /^(tarafından tamamlanmıştır|completed by)/i,
  checklistDone: /^(tamamlanan denetim listesi|completed checklist)/i,
  checklist: /^(denetim listesi öğeleri|checklist items)/i,
  labels: /^(etiketler|labels|tags)/i,
  notes: /^(notlar|notes|description|açıklama)/i,
}

interface TaskColumns {
  taskId: string | null; title: string | null; bucket: string | null; goal: string | null; progress: string | null
  priority: string | null; assignees: string | null; createdBy: string | null; createdAt: string | null
  due: string | null; start: string | null; recurring: string | null; late: string | null
  completedAt: string | null; completedBy: string | null; checklistDone: string | null; checklist: string | null
  labels: string | null; notes: string | null
}

function taskColumns(t: SheetTable): TaskColumns {
  const used = new Set<string>()
  const take = (rx: RegExp) => { const h = pickColumn(t, rx, used); if (h) used.add(h); return h }
  // Order matters: "Tamamlanan Denetim Listesi Öğeleri" also matches the checklist pattern.
  return {
    taskId: take(RX.taskId), title: take(RX.title), bucket: take(RX.bucket), goal: take(RX.goal),
    progress: take(RX.progress), priority: take(RX.priority), assignees: take(RX.assignees),
    createdBy: take(RX.createdBy), createdAt: take(RX.createdAt), due: take(RX.due), start: take(RX.start),
    recurring: take(RX.recurring), late: take(RX.late), completedAt: take(RX.completedAt),
    completedBy: take(RX.completedBy), checklistDone: take(RX.checklistDone), checklist: take(RX.checklist),
    labels: take(RX.labels), notes: take(RX.notes),
  }
}

export interface PlannerTask {
  id: string
  title: string
  bucket: string
  goal: string
  progress: string
  priority: string
  assignees: { id: string; name: string; email: string }[]
  createdBy: string
  createdAt: string
  due: string
  start: string
  recurring: string
  late: string
  completedAt: string
  completedBy: string
  checklist: string[]
  checklistRaw: string
  checklistDone: number
  checklistTotal: number
  checklistUnsplit: boolean
  labels: string[]
  notes: string
}

export interface PlannerDoc {
  planName: string
  planId: string
  exportedAt: string
  buckets: string[]
  users: { id: string; name: string; email: string }[]
  tasks: PlannerTask[]
  sheetNames: string[]
  taskSheet: string
}

const DONE_RX = /^(tamamland|completed|complete|done|bitti)/i
const isFinished = (t: PlannerTask) => DONE_RX.test(t.progress) || !!t.completedAt

const norm = (v: string) => v.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim()
const split = (v: string) => v.split(';').map((s) => s.trim()).filter(Boolean)
/** Same split, but empty positions are kept so two columns can be zipped by index. */
const slots = (v: string) => (v ? v.split(';').map((s) => s.trim()) : [])

/** Recognise a Planner workbook. Returns null for anything else — the wizard then falls back to column mapping. */
export function detectPlanner(wb: WorkbookDoc): PlannerDoc | null {
  const taskTables = wb.sheets.filter((s) => {
    const c = taskColumns(s)
    return !!c.taskId && !!c.title && (!!c.bucket || !!c.progress) && s.rows.length > 0
  })
  if (taskTables.length === 0) return null

  const bucketTable = wb.sheets.find((s) => pickColumn(s, RX.bucketId) && pickColumn(s, RX.bucketName))
  const userTable = wb.sheets.find((s) => pickColumn(s, RX.userId) && pickColumn(s, RX.userMail))
  const planTable = wb.sheets.find((s) => pickColumn(s, RX.planName) && s.rows.length > 0)

  const bucketById = new Map<string, string>()
  const bucketOrder: string[] = []
  if (bucketTable) {
    const id = pickColumn(bucketTable, RX.bucketId)!
    const name = pickColumn(bucketTable, RX.bucketName)!
    for (const r of bucketTable.rows) {
      if (!r[id] || !r[name]) continue
      bucketById.set(r[id], r[name])
      if (!bucketOrder.includes(r[name])) bucketOrder.push(r[name])
    }
  }

  const users: { id: string; name: string; email: string }[] = []
  const userById = new Map<string, { name: string; email: string }>()
  if (userTable) {
    const id = pickColumn(userTable, RX.userId)!
    const name = pickColumn(userTable, RX.userName)
    const mail = pickColumn(userTable, RX.userMail)!
    for (const r of userTable.rows) {
      if (!r[id]) continue
      const u = { id: r[id], name: name ? r[name] : '', email: r[mail] }
      users.push(u)
      userById.set(u.id, u)
    }
  }

  // Planner writes the same tasks twice: with GUIDs and with display names.
  // The GUID sheet is the one whose bucket cells resolve against the bucket ids.
  const withIds = taskTables.find((t) => {
    const c = taskColumns(t)
    return c.bucket ? t.rows.some((r) => bucketById.has(r[c.bucket!])) : false
  })
  const primary = withIds ?? taskTables[taskTables.length - 1]
  const secondary = taskTables.find((t) => t !== primary) ?? null
  const cols = taskColumns(primary)
  const namesById = new Map<string, Record<string, string>>()
  if (secondary && cols.taskId) {
    const sc = taskColumns(secondary)
    if (sc.taskId) for (const r of secondary.rows) namesById.set(r[sc.taskId], r)
  }
  const secCols = secondary ? taskColumns(secondary) : null

  const plan = planTable?.rows[0] ?? {}
  const planNameCol = planTable ? pickColumn(planTable, RX.planName) : null
  const planIdCol = planTable ? pickColumn(planTable, RX.planId) : null
  const planExpCol = planTable ? pickColumn(planTable, RX.planExported) : null

  const val = (r: Record<string, string>, c: string | null) => (c ? (r[c] ?? '') : '')

  const tasks: PlannerTask[] = primary.rows.map((r) => {
    const id = val(r, cols.taskId)
    const alt = namesById.get(id) ?? {}
    const altVal = (c: string | null) => (c ? (alt[c] ?? '') : '')
    const rawBucket = val(r, cols.bucket)
    const bucket = bucketById.get(rawBucket) || altVal(secCols?.bucket ?? null) || rawBucket
    // The two task sheets list the same people in the same order — one by GUID,
    // one by display name — so zip them and keep whatever each side knows.
    const ids = slots(val(r, cols.assignees))
    const names = slots(altVal(secCols?.assignees ?? null))
    const assignees = (ids.length ? ids : names).map((id, k) => {
      const u = userById.get(id)
      return {
        id,
        name: u?.name || names[k] || (id.includes('@') ? '' : id),
        email: u?.email || (id.includes('@') ? id : ''),
      }
    }).filter((a) => a.id || a.name)
    const person = (v: string, altV: string) => userById.get(v)?.name || altV || (userById.get(v)?.email ?? (v.includes('@') ? v : ''))
    const checklistRaw = val(r, cols.checklist)
    const items = split(checklistRaw)
    const progressCell = val(r, cols.checklistDone)
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(progressCell)
    const done = m ? Number(m[1]) : 0
    const total = m ? Number(m[2]) : items.length
    return {
      id,
      title: val(r, cols.title) || altVal(secCols?.title ?? null),
      bucket,
      goal: val(r, cols.goal) || altVal(secCols?.goal ?? null),
      progress: val(r, cols.progress),
      priority: val(r, cols.priority),
      assignees,
      createdBy: person(val(r, cols.createdBy), altVal(secCols?.createdBy ?? null)),
      createdAt: val(r, cols.createdAt),
      due: val(r, cols.due),
      start: val(r, cols.start),
      recurring: val(r, cols.recurring),
      late: val(r, cols.late),
      completedAt: val(r, cols.completedAt),
      completedBy: person(val(r, cols.completedBy), altVal(secCols?.completedBy ?? null)),
      checklist: items,
      checklistRaw,
      checklistDone: done,
      checklistTotal: total,
      // A ";" inside an item text makes the split disagree with Planner's own count.
      checklistUnsplit: items.length > 0 && total > 0 && items.length !== total,
      labels: split(val(r, cols.labels)),
      notes: val(r, cols.notes),
    }
  }).filter((t) => t.title)

  return {
    planName: val(plan, planNameCol) || wb.fileName.replace(/\.[^.]+$/, ''),
    planId: val(plan, planIdCol),
    exportedAt: val(plan, planExpCol),
    buckets: bucketOrder.length ? bucketOrder : [...new Set(tasks.map((t) => t.bucket).filter(Boolean))],
    users,
    tasks,
    sheetNames: wb.sheets.map((s) => s.name),
    taskSheet: primary.name,
  }
}

export interface PlannerOptions {
  /** Which Planner field becomes the Fira column. */
  columnSource: 'bucket' | 'progress'
  /** Checklist items become subtasks (otherwise they stay in the description). */
  checklistAsSubtasks: boolean
  /**
   * Planner keeps the bucket and the progress apart, so a task can sit in "ToDo"
   * and still be marked Tamamlandı. Fira has one column per ticket, so those
   * tasks are put in the finished column and their bucket is kept in the notes.
   */
  completedToDone: boolean
}

export interface PlannerPlan {
  plan: CsvPlan
  stats: { tasks: number; subtasks: number; withNotes: number; labels: number; matchedUsers: number; movedToDone: number; completions: number }
  warnings: string[]
  unknownEmails: string[]
  unknownNames: string[]
}

/** Turn a detected Planner export into the plan the importer executes. */
export function buildPlannerPlan(
  doc: PlannerDoc,
  opts: PlannerOptions,
  existing: { statuses: { name: string; category: StatusCategory }[]; tags: string[]; users: { email: string; name?: string | null }[] },
): PlannerPlan {
  const known = new Set(existing.users.map((u) => u.email.toLowerCase()))
  // Planner only names people it has no account row for; match those on full name.
  const byName = new Map(existing.users.filter((u) => u.name).map((u) => [norm(u.name!), u.email]))
  const existingTags = new Set(existing.tags.map((t) => t.toLowerCase()))
  const statusByName = new Map(existing.statuses.map((s) => [s.name.toLowerCase(), s]))
  const newStatuses: { name: string; category: StatusCategory }[] = []
  const useStatus = (name: string): string => {
    const key = name.toLowerCase()
    if (!statusByName.has(key) && !newStatuses.some((s) => s.name.toLowerCase() === key)) {
      newStatuses.push({ name, category: statusCategoryOf(name) })
    }
    return name
  }

  const columnOf = (t: PlannerTask) => (opts.columnSource === 'progress' ? t.progress : t.bucket) || t.bucket || t.progress || 'Planner'
  // Where "finished" lives: an existing finished column, otherwise a bucket of
  // this plan that already means finished (a "Completed" bucket), otherwise a new
  // one. Without the middle step an import would end up with two done columns.
  const doneStatus =
    (opts.columnSource === 'bucket' ? doc.buckets.find((b) => statusCategoryOf(b) === 'done') : undefined) ??
    existing.statuses.find((s) => s.category === 'done')?.name ??
    existing.statuses.find((s) => s.category === 'closed')?.name ??
    null

  const tickets: CsvPlan['tickets'] = []
  // Everyone the plan names, keyed the way the importer resolves them.
  const people = new Map<string, { key: string; email: string | null; name: string | null; external_id: string | null }>()
  const keyOf = (p: { id: string; name: string; email: string }) => {
    const viaMail = p.email && known.has(p.email.toLowerCase()) ? p.email : null
    const viaName = !viaMail && p.name ? byName.get(norm(p.name)) ?? null : null
    const key = viaMail ?? viaName ?? p.email ?? (p.name ? `name:${p.name}` : null)
    if (key && !viaMail && !viaName) {
      people.set(key, { key, email: p.email || null, name: p.name || null, external_id: p.id || null })
    }
    return { key, matched: !!(viaMail ?? viaName) }
  }
  const warnings: string[] = []
  const unknownEmails = new Set<string>()
  const unknownNames = new Set<string>()
  let subtasks = 0
  let withNotes = 0
  const allTags = new Set<string>()

  // Keep the board the team knows: every bucket becomes a column, even if all of
  // its tasks turn out to be finished and end up in the done column.
  if (opts.columnSource === 'bucket') doc.buckets.forEach((b) => useStatus(b))

  let movedToDone = 0
  let completions = 0

  doc.tasks.forEach((t, i) => {
    const finished = isFinished(t)
    // Bucket says one thing, progress another: "Tamamlandı" wins, otherwise the
    // task would land in a column where nobody looks for finished work.
    const moved = opts.completedToDone && finished && opts.columnSource === 'bucket' && !DONE_RX.test(t.bucket)
    if (moved) movedToDone++
    const status = moved ? useStatus(doneStatus ?? 'Tamamlandı') : useStatus(columnOf(t))
    const emails: string[] = []
    const unmatched: string[] = []
    for (const a of t.assignees) {
      const { key, matched } = keyOf(a)
      if (!key) continue
      emails.push(key)
      if (matched) continue
      const label = a.name || a.email || a.id
      unmatched.push(label)
      if (a.email) unknownEmails.add(a.email); else unknownNames.add(label)
    }
    for (const l of t.labels) allTags.add(l)
    if (t.notes) withNotes++

    const keepChecklist = opts.checklistAsSubtasks && t.checklist.length > 0 && !t.checklistUnsplit
    if (t.checklistUnsplit) warnings.push(translate('team.planner.warn.checklist', { title: t.title, expected: t.checklistTotal, found: t.checklist.length }))

    // The labels below are written INTO the ticket description as data (the
    // "Planner alanları" block the docs describe), not shown as UI, so they stay
    // in Turkish — the importer and the docs both refer to them by these names.
    const meta: string[] = []
    const add = (label: string, value: string) => { if (value) meta.push(`- ${label}: ${value}`) }
    if (doc.planName) add('Plan', doc.planName)
    if (opts.columnSource === 'progress' || moved) add('Kutu', t.bucket)
    if (opts.columnSource === 'bucket') add('Durum (Planner)', t.progress)
    add('Hedef', t.goal)
    add('Oluşturan', t.createdBy)
    add('Oluşturma', t.createdAt)
    add('Başlangıç', t.start)
    add('Tamamlanma', [t.completedAt, t.completedBy && `(${t.completedBy})`].filter(Boolean).join(' '))
    add('Yinelenen', t.recurring)
    if (t.late === 'true') add('Geciken', 'evet')
    if (t.checklistTotal > 0) {
      const partial = t.checklistDone > 0 && t.checklistDone < t.checklistTotal
      add('Denetim listesi', `${t.checklistDone}/${t.checklistTotal} tamamlandı${partial ? ' — hangi maddelerin tamamlandığı dışa aktarımda yok' : ''}`)
    }
    if (!keepChecklist && t.checklistRaw) add('Denetim listesi öğeleri', t.checklistRaw)
    if (unmatched.length) add('Fira hesabı olmayan atananlar', [...new Set(unmatched)].join(', '))
    add('Görev Kimliği', t.id)

    // "Tamamlanma Tarihi" + "Tarafından tamamlanmıştır" become a real transition in
    // the activity log rather than only a line of prose in the description.
    const completedAt = isoOrNull(t.completedAt)
    let completion: CsvPlan['tickets'][number]['completion'] = null
    if (completedAt && finished) {
      const name = t.completedBy || null
      // The completer may have no account either — key them like an assignee so a
      // placeholder profile is created and the completion is attributed to it.
      const key = name ? keyOf({ id: '', name, email: '' }).key : null
      completion = {
        at: `${completedAt}T12:00:00.000Z`,
        personKey: key,
        name,
        from: t.bucket && t.bucket !== status ? t.bucket : null,
      }
      completions++
    }

    const metaBlock = meta.length ? `${t.notes ? '---\n\n' : ''}**Planner alanları**\n\n${meta.join('\n')}` : ''
    const description = [t.notes, metaBlock].filter(Boolean).join('\n\n') || null

    tickets.push({
      key: t.id || `row-${i + 1}`,
      title: t.title,
      description,
      status,
      priority: PRIORITY_MAP[t.priority.toLowerCase()] ?? null,
      assignees: [...new Set(emails)],
      tags: t.labels,
      due_date: isoOrNull(t.due),
      parentKey: null,
      comments: [],
      created_at: isoOrNull(t.createdAt) ? `${isoOrNull(t.createdAt)}T00:00:00.000Z` : null,
      completion,
      createdByKey: t.createdBy ? keyOf({ id: '', name: t.createdBy, email: '' }).key : null,
    })

    if (keepChecklist) {
      const allDone = t.checklistTotal > 0 && t.checklistDone === t.checklistTotal
      const childStatus = allDone && doneStatus ? doneStatus : allDone ? useStatus('Tamamlandı') : status
      if (allDone && !doneStatus) useStatus('Tamamlandı')
      t.checklist.forEach((item, k) => {
        subtasks++
        tickets.push({
          key: `${t.id}#${k + 1}`,
          title: item,
          description: null,
          status: childStatus,
          priority: null,
          assignees: [],
          tags: [],
          due_date: null,
          parentKey: t.id || `row-${i + 1}`,
          comments: [],
          created_at: null,
        })
      })
    }
  })

  // Keep the plan's column order: buckets as Planner lists them, progress in its natural order.
  const order = opts.columnSource === 'bucket' ? doc.buckets : ['Başlatılmadı', 'Not started', 'Devam ediyor', 'In progress', 'Tamamlandı', 'Completed']
  newStatuses.sort((a, b) => {
    const ia = order.findIndex((n) => n.toLowerCase() === a.name.toLowerCase())
    const ib = order.findIndex((n) => n.toLowerCase() === b.name.toLowerCase())
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib)
  })
  const newTags = [...allTags].filter((t) => !existingTags.has(t.toLowerCase()))
  if (unknownEmails.size) warnings.push(translate('team.planner.warn.unknownEmails', { n: unknownEmails.size }))
  if (unknownNames.size) warnings.push(translate('team.planner.warn.unknownNames', { n: unknownNames.size }))

  return {
    plan: { tickets, newStatuses, newTags, unknownUsers: [...unknownEmails, ...unknownNames], people: [...people.values()] },
    stats: {
      tasks: doc.tasks.length,
      subtasks,
      withNotes,
      labels: allTags.size,
      matchedUsers: new Set(tickets.flatMap((t) => t.assignees)).size,
      movedToDone,
      completions,
    },
    warnings,
    unknownEmails: [...unknownEmails],
    unknownNames: [...unknownNames],
  }
}

/** Planner writes ISO days; be forgiving about anything else Excel may hand over. */
function isoOrNull(v: string): string | null {
  if (!v) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const tr = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/.exec(v)
  if (tr) return `${tr[3]}-${tr[2].padStart(2, '0')}-${tr[1].padStart(2, '0')}`
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
