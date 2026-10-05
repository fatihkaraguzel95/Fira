/**
 * Generates src/components/ui/iconBold.ts and iconFine.ts: the drawings of every interface icon, in two sets.
 *
 *   node scripts/gen-ui-icons.mjs            fetch and write
 *   node scripts/gen-ui-icons.mjs --check    only report names a set does not have
 *
 * The person chooses the set (Ayarlar › Görünüm › İkonlar, #e8d26977):
 *  - "bold"  Lucide (ISC): 24 px outlines drawn with a 1.5 px line at the size shown. The default.
 *  - "fine"  Fluent UI System Icons (Microsoft, MIT), "regular": each icon drawn separately for
 *            16 and 20 px on that pixel grid, with a 1 px line.
 * Before, icons were 24 px outlines from several hands shrunk to 12–14 px with ten different
 * line widths: the lines fell between pixels and went soft.
 *
 * Nothing is fetched at build time: the generated file is committed, this script runs only when
 * the list below changes.
 *
 * To add an icon: add `name: ['lucide-name', 'fluent_name']` (https://lucide.dev/icons,
 * https://aka.ms/fluentui-system-icons), run the script, use <Icon name="name" />. `+20` after
 * the Fluent name also takes its 20 px drawing (rail, top bar); without it a 20 px icon is the
 * 16 px drawing scaled up. Every icon must exist in BOTH sets.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FLUENT = '1.1.343'
const LUCIDE = '1.50.0'
const FLUENT_BASE = `https://unpkg.com/@fluentui/svg-icons@${FLUENT}/icons/`
const LUCIDE_BASE = `https://unpkg.com/lucide-static@${LUCIDE}/icons/`
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'ui')

const ICONS = {
  // ── tree and navigation ──
  page: ['file-text', 'document_text'], pageAdd: ['file-plus', 'document_add'], drawing: ['shapes', 'shapes'], whiteboard: ['presentation', 'whiteboard'],
  chevronRight: ['chevron-right', 'chevron_right'], chevronDown: ['chevron-down', 'chevron_down'], chevronLeft: ['chevron-left', 'chevron_left'],
  arrowLeft: ['arrow-left', 'arrow_left'], arrowRight: ['arrow-right', 'arrow_right'],
  more: ['ellipsis', 'more_horizontal'], plus: ['plus', 'add'], close: ['x', 'dismiss'], grip: ['grip-vertical', 're_order_dots_vertical'],
  home: ['house', 'home+20'], bell: ['bell', 'alert+20'], teams: ['users', 'people+20'], admin: ['shield-check', 'shield_checkmark+20'], download: ['download', 'arrow_download+20'],
  tasks: ['clipboard-check', 'clipboard_task'], sparkle: ['sparkles', 'sparkle'], clock: ['clock', 'clock'], ticket: ['square-check-big', 'task_list_square_ltr'],
  // ── menus ──
  edit: ['pencil', 'edit'], trash: ['trash-2', 'delete'], settings: ['settings', 'settings'], open: ['external-link', 'open'], help: ['circle-help', 'question_circle'], key: ['key-round', 'key'],
  import: ['import', 'arrow_import'], expandAll: ['unfold-vertical', 'arrow_expand_all'], collapseAll: ['fold-vertical', 'arrow_collapse_all'], link: ['link', 'link'],
  // ── actions and states, everywhere ──
  check: ['check', 'checkmark'], checkCircle: ['circle-check', 'checkmark_circle'], chevronUp: ['chevron-up', 'chevron_up'],
  chevronsLeft: ['chevrons-left', 'chevron_double_left'], chevronsRight: ['chevrons-right', 'chevron_double_right'],
  minus: ['minus', 'subtract'], search: ['search', 'search'], menu: ['menu', 'navigation'], filter: ['list-filter', 'filter'], sort: ['arrow-up-down', 'arrow_sort'],
  refresh: ['refresh-cw', 'arrow_sync'], undo: ['undo-2', 'arrow_undo'], history: ['history', 'history'], copy: ['copy', 'copy'], archive: ['archive', 'archive'],
  attach: ['paperclip', 'attach'], image: ['image', 'image'], comment: ['message-square-text', 'comment'], text: ['align-left', 'text_align_left'],
  checklist: ['list-checks', 'task_list_ltr'], listAdd: ['list-plus', 'text_bullet_list_add'], grid: ['layout-grid', 'grid'], columns: ['columns-3', 'column_triple'],
  subtask: ['corner-down-right', 'arrow_turn_down_right'], moveTo: ['folder-input', 'folder_arrow_right'], maximize: ['maximize', 'full_screen_maximize'],
  warning: ['triangle-alert', 'warning'], alert: ['circle-alert', 'error_circle'], info: ['info', 'info'], ban: ['ban', 'prohibited'], half: ['contrast', 'circle_half_fill'],
  spinner: ['loader-circle', 'spinner_ios'], eye: ['eye', 'eye'], eyeOff: ['eye-off', 'eye_off'], bellOff: ['bell-off', 'alert_off'], inbox: ['inbox', 'mail_inbox'],
  person: ['user', 'person'], userAdd: ['user-plus', 'person_add'], userRemove: ['user-minus', 'person_subtract'], logout: ['log-out', 'sign_out'],
  sliders: ['sliders-horizontal', 'options'], keyboard: ['keyboard', 'keyboard'], language: ['languages', 'local_language'], shell: ['panels-top-left', 'layout_column_two'],
  audio: ['music', 'music_note_2'], mailUnread: ['mail', 'mail_unread'],
  offline: ['wifi-off', 'wifi_off'], fold: ['chevrons-up-down', 'chevron_up_down'],
  send: ['send', 'send'], play: ['play', 'play'], file: ['file', 'document'], video: ['video', 'video'], zoomIn: ['zoom-in', 'zoom_in'], zoomOut: ['zoom-out', 'zoom_out'],
  // ── the editor's toolbar ──
  bold: ['bold', 'text_bold'], italic: ['italic', 'text_italic'], strike: ['strikethrough', 'text_strikethrough'], type: ['type', 'text_t'],
  h1: ['heading-1', 'text_header_1'], h2: ['heading-2', 'text_header_2'], h3: ['heading-3', 'text_header_3'],
  listOrdered: ['list-ordered', 'text_number_list_ltr'], quote: ['text-quote', 'text_quote'], codeBlock: ['square-code', 'code_block'], table: ['table', 'table'],
  redo: ['redo-2', 'arrow_redo'], paste: ['clipboard-paste', 'clipboard_paste'], minimize: ['minimize', 'full_screen_minimize'],
  alignLeft: ['align-left', 'text_align_left'], alignCenter: ['align-center', 'text_align_center'], alignRight: ['align-right', 'text_align_right'],
  // ── list / folder marks (LIST_ICONS keys; a list stores the key, so keys never change) ──
  list: ['list', 'text_bullet_list'], clipboard: ['clipboard', 'clipboard'], folder: ['folder', 'folder'], code: ['code', 'code'], bug: ['bug', 'bug'], rocket: ['rocket', 'rocket'],
  star: ['star', 'star'], flag: ['flag', 'flag'], bolt: ['zap', 'flash'], briefcase: ['briefcase', 'briefcase'], chart: ['chart-column', 'data_bar_vertical'], chat: ['message-circle', 'chat'],
  cog: ['settings', 'settings'], globe: ['globe', 'globe'], heart: ['heart', 'heart'], layers: ['layers', 'stack'], bulb: ['lightbulb', 'lightbulb'], lock: ['lock', 'lock_closed'],
  mail: ['mail', 'mail'], shield: ['shield', 'shield'], tag: ['tag', 'tag'], users: ['users', 'people'], wrench: ['wrench', 'wrench'], calendar: ['calendar', 'calendar_ltr'],
  book: ['book-open', 'book_open'], cart: ['shopping-cart', 'cart'], cloud: ['cloud', 'cloud'], database: ['database', 'database'], gift: ['gift', 'gift'], megaphone: ['megaphone', 'megaphone'],
  palette: ['palette', 'color'], puzzle: ['puzzle', 'puzzle_piece'], truck: ['truck', 'vehicle_truck_profile'], beaker: ['flask-conical', 'beaker'],
}

// ── Fluent: filled outlines; several <path> elements become one path string ──
// Each must start with an absolute M, or the join would shift it.
const fluentPath = (svg) => {
  if (/<(circle|rect|g|defs|linearGradient)\b/.test(svg)) throw new Error('more than plain paths')
  const all = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1])
  if (all.some((d, i) => i > 0 && d[0] !== 'M')) throw new Error('a path does not start with M')
  return all.join('')
}
async function fluent(name, size) {
  const r = await fetch(`${FLUENT_BASE}${name}_${size}_regular.svg`)
  return r.ok ? fluentPath(await r.text()) : null
}

// ── Lucide: stroked shapes; kept as [tag, attributes] the way the drawing lists them ──
const KEEP = { path: ['d'], circle: ['cx', 'cy', 'r'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], ellipse: ['cx', 'cy', 'rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'], polyline: ['points'], polygon: ['points'] }
async function lucide(name) {
  const r = await fetch(`${LUCIDE_BASE}${name}.svg`)
  if (!r.ok) return null
  const body = (await r.text()).replace(/<!--[\s\S]*?-->/g, '').replace(/<svg[\s\S]*?>/, '').replace('</svg>', '')
  const nodes = []
  for (const m of body.matchAll(/<(\w+)\s([^>]*?)\/>/g)) {
    const keep = KEEP[m[1]]
    if (!keep) throw new Error(`${name}: <${m[1]}> is not handled`)
    const attrs = Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]).filter(([k]) => keep.includes(k)))
    nodes.push([m[1], attrs])
  }
  if (!nodes.length) throw new Error(`${name}: no shapes`)
  return nodes
}

const checkOnly = process.argv.includes('--check')
const fine = [], bold = [], missing = []
for (const [key, [lucideName, fluentSpec]] of Object.entries(ICONS)) {
  const [name, also20] = fluentSpec.split('+')
  let grid = 16
  let d = await fluent(name, 16)
  if (!d) { grid = 20; d = await fluent(name, 20) }
  const nodes = await lucide(lucideName)
  if (!d) missing.push(`${key}: fluent ${name}`)
  if (!nodes) missing.push(`${key}: lucide ${lucideName}`)
  if (!d || !nodes) continue
  if (grid === 20) console.log(`note: ${key} (${name}) has no 16 px Fluent drawing; the 20 px one is used`)
  const d20 = also20 && grid === 16 ? await fluent(name, 20) : null
  fine.push(`  ${key}: { g: ${grid}, d: '${d}'${d20 ? `, d20: '${d20}'` : ''} },`)
  bold.push(`  ${key}: ${JSON.stringify(nodes)},`)
}
if (missing.length) { console.log('MISSING:', missing.join('; ')); process.exitCode = 1 }
if (checkOnly || missing.length) { console.log(`${fine.length} found in both sets`); process.exit() }

// Two files: the bold set is the default and ships with the app; the fine set is loaded only by
// those who choose it (src/hooks/useIconSet.ts), so nobody downloads a set they do not see.
const HEAD = '// GENERATED by scripts/gen-ui-icons.mjs — do not edit by hand; change the list there and run it.\n'
fs.writeFileSync(path.join(DIR, 'iconBold.ts'), `${HEAD}//
// Lucide ${LUCIDE}. Copyright (c) Lucide Contributors, ISC License (parts from Feather, MIT):
//   https://github.com/lucide-icons/lucide/blob/main/LICENSE
// The shapes of a 24 px outline, as [tag, attributes].
export type IconShape = [tag: 'path' | 'circle' | 'rect' | 'ellipse' | 'line' | 'polyline' | 'polygon', attrs: Record<string, string>]

const BOLD = {
${bold.join('\n')}
}

export type IconName = keyof typeof BOLD

export const ICON_BOLD = BOLD as unknown as Record<IconName, IconShape[]>
`)
fs.writeFileSync(path.join(DIR, 'iconFine.ts'), `${HEAD}//
// Fluent UI System Icons ${FLUENT}, "regular" style. Copyright (c) Microsoft Corporation, MIT License:
//   https://github.com/microsoft/fluentui-system-icons/blob/main/LICENSE
// g = the pixel grid the drawing was made for; d20 = the separate 20 px drawing, where one was taken.
import type { IconName } from './iconBold'

export interface FineIcon { g: 16 | 20; d: string; d20?: string }

export const ICON_FINE: Record<IconName, FineIcon> = {
${fine.join('\n')}
}
`)
fs.rmSync(path.join(DIR, 'iconData.ts'), { force: true })
const kb = (f) => (fs.statSync(path.join(DIR, f)).size / 1024).toFixed(1)
console.log(`wrote ${fine.length} icons: iconBold.ts ${kb('iconBold.ts')} KB, iconFine.ts ${kb('iconFine.ts')} KB`)
