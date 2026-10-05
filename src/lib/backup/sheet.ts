import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { t } from '../../i18n'

/**
 * Spreadsheet reader for the import wizard.
 *
 * Reads .xlsx/.xlsm/.xls directly (no "save as CSV" detour) and keeps every
 * sheet, because tool exports — Microsoft Planner above all — spread one plan
 * over several sheets (tasks, buckets, users, goals). CSV goes through the same
 * shape so the rest of the wizard does not care where the rows came from.
 */
export interface SheetTable {
  name: string
  headers: string[]
  rows: Record<string, string>[]
}

export interface WorkbookDoc {
  fileName: string
  sheets: SheetTable[]
}

export const SPREADSHEET_ACCEPT = '.xlsx,.xlsm,.xls,.csv'

/** Calendar day, not the instant: SheetJS builds Dates in the local frame. */
function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const time = d.getHours() || d.getMinutes() ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : ''
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${time}`
}

function cell(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return isoDate(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v).trim()
}

/** First non-empty row is the header; blank rows and unnamed empty columns are dropped. */
function tableFromMatrix(name: string, matrix: unknown[][]): SheetTable {
  const first = matrix.findIndex((r) => Array.isArray(r) && r.some((c) => cell(c) !== ''))
  if (first < 0) return { name, headers: [], rows: [] }
  const headers: string[] = []
  // Columns with no header of their own get a generated name. It is tracked by
  // identity rather than by matching its text, so the name can be translated.
  const generated = new Set<string>()
  matrix[first].forEach((h, i) => {
    const own = cell(h)
    const base = own || t('team.sheet.column', { n: i + 1 })
    let unique = base
    for (let n = 2; headers.includes(unique); n++) unique = `${base} (${n})`
    headers.push(unique)
    if (!own) generated.add(unique)
  })
  const rows = matrix
    .slice(first + 1)
    .map((r) => {
      const row: Record<string, string> = {}
      headers.forEach((h, i) => { row[h] = cell((r as unknown[])[i]) })
      return row
    })
    .filter((r) => Object.values(r).some((v) => v !== ''))
  // Columns that are empty everywhere and had no header carry nothing.
  const used = headers.filter((h, i) => !generated.has(h) || rows.some((r) => r[h] !== '') || i === 0)
  return { name, headers: used, rows }
}

export async function readWorkbook(file: File): Promise<WorkbookDoc> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = (await file.text()).replace(/^﻿/, '')
    const res = Papa.parse<string[]>(text, { skipEmptyLines: true })
    return { fileName: file.name, sheets: [tableFromMatrix('CSV', res.data)] }
  }
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
  const sheets = wb.SheetNames.map((n) =>
    tableFromMatrix(n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, blankrows: false, defval: null }) as unknown[][]),
  )
  const kept = sheets.filter((s) => s.headers.length > 0)
  if (kept.length === 0) throw new Error(t('team.sheet.error.noReadableSheet'))
  return { fileName: file.name, sheets: kept }
}

/** First header matching `rx` that is not already spoken for. */
export function pickColumn(table: SheetTable, rx: RegExp, used: Set<string> = new Set()): string | null {
  return table.headers.find((h) => !used.has(h) && rx.test(h.trim())) ?? null
}
