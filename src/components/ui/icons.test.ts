import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ICON_BOLD } from './iconBold'
import { ICON_FINE } from './iconFine'

/**
 * Interface icons come from <Icon name="…" /> (#089a79f7). Before, 261 inline <svg> drawings
 * from several hands were shrunk to 12–14 px with ten different stroke widths; this test keeps
 * them from coming back one by one.
 *
 * The files below may hold a drawing of their own, because what they draw is not an icon:
 * add a file here only for that reason, and say what it draws.
 */
const OWN_DRAWINGS: Record<string, number> = {
  'components/ui/Icon.tsx': 2,                        // the component itself: one <svg> per set
  'components/auth/LoginForm.tsx': 1,                 // the Google mark: a brand logo, in its colours
  'components/list/InlineCells.tsx': 1,               // the priority flag: filled in the priority's colour
  'components/ticket/PriorityPicker.tsx': 2,          // the same flag, in the picker
  'components/ticket/StatusIndicator.tsx': 1,         // the status ring: drawn from the status' category and colour
  'components/ticket/DescriptionEditor.tsx': 1,       // the upload progress ring inside the editor
  'components/ui/UploadProgress.tsx': 1,              // the upload progress ring
  'components/ui/FileThumb.tsx': 1,                   // the play mark over a video thumbnail
  'pages/AdminPage.tsx': 1,                           // a bar chart
}
/** The whiteboard draws its tools, shapes and the scene itself. */
const OWN_FOLDERS = ['components/canvas/whiteboard/']

const SRC = path.resolve(__dirname, '..', '..')
function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    return e.isDirectory() ? tsxFiles(full) : e.name.endsWith('.tsx') ? [full] : []
  })
}

describe('interface icons', () => {
  it('are drawn through <Icon>, not as inline <svg>', () => {
    const offenders: string[] = []
    for (const file of tsxFiles(SRC)) {
      const rel = path.relative(SRC, file).replace(/\\/g, '/')
      if (OWN_FOLDERS.some((f) => rel.startsWith(f))) continue
      const count = (fs.readFileSync(file, 'utf8').match(/<svg\b/g) ?? []).length
      if (count > (OWN_DRAWINGS[rel] ?? 0)) offenders.push(`${rel}: ${count} <svg> (allowed ${OWN_DRAWINGS[rel] ?? 0})`)
    }
    expect(offenders, 'use <Icon name="…" /> (add the icon to scripts/gen-ui-icons.mjs if it is missing)').toEqual([])
  })

  it('every icon exists in both sets', () => {
    expect(Object.keys(ICON_FINE).sort()).toEqual(Object.keys(ICON_BOLD).sort())
    for (const [name, shapes] of Object.entries(ICON_BOLD)) expect(shapes.length, name).toBeGreaterThan(0)
    // A path opens with a move; a leading lower-case `m` is still absolute for the first command.
    for (const [name, icon] of Object.entries(ICON_FINE)) expect(/^[Mm]/.test(icon.d), name).toBe(true)
  })
})
