import type { StatusCategory } from '../../types'

/**
 * Value maps shared by the import paths. Kept free of any Supabase import so
 * the parsers (sheet.ts, planner.ts) stay pure and testable on their own.
 */
export const PRIORITY_MAP: Record<string, string> = {
  low: 'low', lowest: 'low', düşük: 'low', dusuk: 'low', '4': 'low', medium: 'medium', orta: 'medium', normal: 'medium', '3': 'medium',
  high: 'high', yüksek: 'high', önemli: 'high', onemli: 'high', important: 'high', '2': 'high',
  highest: 'critical', critical: 'critical', kritik: 'critical', acil: 'critical', urgent: 'critical', '1': 'critical',
}

/**
 * Guess a status category from its name, so imported columns land in the right
 * bucket (a "Tamamlandı" column must count as complete, not as active work).
 */
export function statusCategoryOf(name: string): StatusCategory {
  const n = name.toLowerCase()
  if (/(iptal|cancel|kapat|closed|arşiv|archiv)/.test(n)) return 'closed'
  if (/(tamam|complete|done|bitti|bitmiş|finished|resolved|closed)/.test(n)) return 'done'
  if (/(bloke|blocked|beklem|waiting|on hold|askı)/.test(n)) return 'blocked'
  if (/(yapılacak|yapilacak|başlatılmadı|baslatilmadi|todo|to do|backlog|queue|kuyruk|yeni|new|not started|planlan)/.test(n)) return 'backlog'
  return 'active'
}

/** Distinct-ish colours for columns and tags created by an import. */
export const IMPORT_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#22c55e', '#ef4444']
export const colorFor = (i: number) => IMPORT_COLORS[i % IMPORT_COLORS.length]
