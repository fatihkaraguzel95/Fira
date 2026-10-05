import type { TranslationKey } from '../../../i18n'
import { make, type LineEl, type NoteEl, type ShapeEl, type TextEl, type WbElement } from './model'
import type { Pt } from './geometry'

/** Ready-made layouts (Teams' template gallery, the common ones). Built around a centre point. */
export type TemplateId = 'brainstorm' | 'retro' | 'kanban' | 'swot' | 'weekly' | 'mindmap'
export const TEMPLATES: TemplateId[] = ['retro', 'kanban', 'brainstorm', 'swot', 'weekly', 'mindmap']

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string

const note = (x: number, y: number, color: string, text: string, by: string, author?: string): NoteEl =>
  make<NoteEl>({ type: 'note', x, y, w: 200, h: 200, color, text, by, author }, 0)
const title = (x: number, y: number, w: number, text: string, size = 26): TextEl =>
  make<TextEl>({ type: 'text', x, y, w, text, color: '#1f1f1f', fontSize: size, bold: true, align: 'center' }, 0)
const panel = (x: number, y: number, w: number, h: number, fill: string, stroke = '#d1d5db'): ShapeEl =>
  make<ShapeEl>({ type: 'shape', kind: 'rect', x, y, w, h, stroke, fill, strokeWidth: 2 }, 0)

/** Columns with a title and two empty notes each (retro, kanban, weekly plan). */
function columns(c: Pt, titles: string[], fills: string[], noteColors: string[], by: string): WbElement[] {
  const colW = 280, gap = 32, h = 620
  const total = titles.length * colW + (titles.length - 1) * gap
  const left = c.x - total / 2, top = c.y - h / 2
  const out: WbElement[] = []
  titles.forEach((tt, i) => {
    const x = left + i * (colW + gap)
    out.push(panel(x, top, colW, h, fills[i % fills.length]))
    out.push(title(x + 12, top + 18, colW - 24, tt, 24))
    out.push(note(x + 40, top + 80, noteColors[i % noteColors.length], '', by))
    out.push(note(x + 40, top + 300, noteColors[i % noteColors.length], '', by))
  })
  return out
}

export function buildTemplate(id: TemplateId, c: Pt, t: T, by: string, author: string): WbElement[] {
  let els: WbElement[]
  switch (id) {
    case 'retro':
      els = columns(c, [t('wb.tpl.retro.good'), t('wb.tpl.retro.improve'), t('wb.tpl.retro.actions')], ['#effaf1', '#fff4ec', '#eef4ff'], ['#cbe59c', '#ffab7c', '#99c9ef'], by)
      break
    case 'kanban':
      els = columns(c, [t('wb.tpl.kanban.todo'), t('wb.tpl.kanban.doing'), t('wb.tpl.kanban.done')], ['#f5f5f5', '#fff9e6', '#effaf1'], ['#fee15a', '#fccd7a', '#b4e8ca'], by)
      break
    case 'weekly': {
      const days = t('wb.tpl.weekly.days').split(',')
      els = columns(c, days, ['#f8fafc'], ['#fee15a', '#99c9ef', '#cbe59c', '#ea99c7', '#fccd7a'], by)
      break
    }
    case 'swot': {
      const s = 420, gap = 20
      const quad: [string, string][] = [[t('wb.tpl.swot.s'), '#e8f7ec'], [t('wb.tpl.swot.w'), '#fdecec'], [t('wb.tpl.swot.o'), '#e9f1fd'], [t('wb.tpl.swot.t'), '#fdf3e6']]
      els = []
      quad.forEach(([name, fill], i) => {
        const x = c.x - s - gap / 2 + (i % 2) * (s + gap)
        const y = c.y - s - gap / 2 + Math.floor(i / 2) * (s + gap)
        els.push(panel(x, y, s, s, fill))
        els.push(title(x + 16, y + 18, s - 32, name, 28))
      })
      break
    }
    case 'brainstorm': {
      els = [note(c.x - 130, c.y - 130, '#fee15a', t('wb.tpl.brainstorm.topic'), by, author)]
      ;(els[0] as NoteEl).w = 260; (els[0] as NoteEl).h = 260
      const colors = ['#99c9ef', '#cbe59c', '#ea99c7', '#fccd7a', '#b7c3fc', '#b4e8ca']
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2
        const nx = c.x + Math.cos(a) * 420, ny = c.y + Math.sin(a) * 340
        els.push(make<LineEl>({ type: 'line', x: c.x + Math.cos(a) * 150, y: c.y + Math.sin(a) * 150, dx: Math.cos(a) * 170, dy: Math.sin(a) * 110, color: '#9ca3af', strokeWidth: 3 }, 0))
        els.push(note(nx - 90, ny - 90, colors[i], `${t('wb.tpl.brainstorm.idea')} ${i + 1}`, by, author))
        ;(els[els.length - 1] as NoteEl).w = 180; (els[els.length - 1] as NoteEl).h = 180
      }
      break
    }
    case 'mindmap': {
      els = [make<ShapeEl>({ type: 'shape', kind: 'ellipse', x: c.x - 150, y: c.y - 70, w: 300, h: 140, stroke: '#0063b1', fill: '#dbeafe', strokeWidth: 3, text: t('wb.tpl.mindmap.center'), fontSize: 26, bold: true }, 0)]
      const spots = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
      spots.forEach(([sx, sy], i) => {
        const bx = c.x + sx * 380 - 110, by2 = c.y + sy * 200 - 45
        els.push(make<LineEl>({ type: 'line', x: c.x + sx * 140, y: c.y + sy * 50, dx: sx * 130, dy: sy * 120, color: '#0063b1', strokeWidth: 3 }, 0))
        els.push(make<ShapeEl>({ type: 'shape', kind: 'rect', x: bx, y: by2, w: 220, h: 90, stroke: '#0063b1', fill: '#ffffff', strokeWidth: 2, text: t('wb.tpl.mindmap.branch', { n: i + 1 }), fontSize: 20 }, 0))
      })
      break
    }
  }
  return els
}
