// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseMicrosoftWhiteboard } from './msImport'
import type { ImageEl, InkEl, LineEl, NoteEl, ShapeEl, TextEl } from './model'

/**
 * Pages shaped like a Microsoft Whiteboard export, reduced to what the importer
 * reads. Built after the synthetic pages of SQLBI Whiteboard's smoke tests (MIT),
 * whose expected positions were checked against the same boards rendered by Edge.
 */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const WORDS = { comment: 'Yorum', link: 'Bağlantı' }

const INK_PAGE = `
<html><head><title>Sample</title></head><body>
<div id="canvasContent">
<div class="anchor align topLeft" data-whiteboard-type="InkGroup" style="left: 100px; top: 200px; transform: matrix(0.5, 0, 0, 0.5, 4, 6);">
  <svg class="inkGroup ink PenStroke" viewBox="-10 -20 100 50" width="100" height="50">
    <g class="inkStroke" transform="matrix(0.0078125, 0, 0, 0.0078125, 0, 0)">
      <path d="M0,-256L2560,-256A256,256 0 0 0 2560,256L0,256A256,256 0 0 0 0,-256" fill="rgba(231,18,36,1)"></path>
      <polyline class="inkHitTestOverlay" points="0,0 1280,0 2560,0 "></polyline>
    </g>
  </svg>
</div>
<div class="anchor align center" data-whiteboard-type="FluidImage" style="left: 500px; top: 400px; transform: matrix(2, 0, 0, 2, 1, -1);">
  <div class="content imageComponent" style="height: 50px; width: 100px;"><img src="data:text/plain;base64,${PNG}"></div>
</div>
<div class="anchor align topLeft" data-whiteboard-type="InkGroup" style="left: 450px; top: 380px; transform: matrix(1, 0, 0, 1, 0, 0);">
  <svg class="inkGroup ink Mixed" viewBox="0 0 40 40" width="40" height="40">
    <g class="inkStroke" transform="matrix(0.0078125, 0, 0, 0.0078125, 0, 0)">
      <path d="M0,0L1024,0L1024,2048L0,2048L0,0" fill="rgba(40,246,45,0.4)"></path>
      <polyline class="inkHitTestOverlay" points="512,1024 3500,1024 "></polyline>
    </g>
  </svg>
</div>
<div class="anchor align topLeft" data-whiteboard-type="StickyNote" style="left: 0px; top: 0px;"><div>A note</div></div>
<div class="anchor align topLeft" data-whiteboard-type="CommentThread" style="left: 0px; top: 0px;"></div>
<div id="remoteInkPool" class="canvasChild anchor ink"><svg class="inkGroup ink PenStroke" viewBox="0 0 10 10" width="10" height="10"><g class="inkStroke"><path d="M0,0" fill="#000"></path><polyline class="inkHitTestOverlay" points="0,64"></polyline></g></svg></div>
</div></body></html>`

const OBJECTS_PAGE = `
<html><body><div id="canvasContent">
<div class="anchor align center" data-whiteboard-type="Shape" style="left: 100px; top: 100px;">
  <div class="filledShape"><svg class="shape" width="200" height="100">
    <g transform="translate(100 50)" fill="rgba(153, 201, 239, 1)" stroke="rgba(31, 31, 31, 1)" stroke-width="2pt">
      <path d="M-100,-50L100,-50L100,50L-100,50Z"></path></g></svg>
    <div class="textBoxContainer"><div class="textbox shapeText" style="font-size: 20px;"><div class="textBoxCore" style="font-weight: 400;"><div data-block="true"><span data-text="true">Arrow</span></div></div></div></div></div>
</div>
<div class="anchor align topLeft" data-whiteboard-type="Connector" style="left: 200px; top: 90px;">
  <svg width="100" height="30" class="shape connector"><g stroke-width="2.5" fill="none" stroke="rgba(31, 31, 31, 1)">
    <path d="M0 10L11 11L100 10"></path><path d="M-5 -9 L0 0 L5 -9" transform="translate(0,10), rotate(90)"></path></g></svg>
</div>
<div class="anchor align topLeft" data-whiteboard-type="Note" style="left: 1000px; top: 0px;">
  <div class="textBoxBackground noteVisualUpdate softBlueGradient"><div class="textbox stickyNote" style="width: 304px; height: 265px; font-size: 32px;">
    <div class="textBoxCore"><div data-block="true"><span data-text="true">First line</span></div><div data-block="true"><span data-text="true">Second &amp; last</span></div></div></div></div>
  <div class="ReactionTagContainer"><button type="button" class="ms-Button ReactionPill"></button></div>
</div>
<div class="anchor align topLeft" data-whiteboard-type="PlainText" style="left: 0px; top: 600px;">
  <div style="width: 400px; display: flex; justify-content: center;"><div class="textbox plainText" style="max-width: 400px; font-size: 20px;">
    <div class="textBoxCore" style="color: rgb(193, 0, 81); font-family: &quot;Segoe Print&quot;, &quot;ink free&quot;; font-weight: 700; font-style: italic;">
      <div data-block="true"><span data-text="true">one two three</span></div></div></div></div>
</div>
<div class="anchor align topLeft" data-whiteboard-type="GridList" style="left: 0px; top: 1000px;">
  <div class="listTitleContainer"><div class="textbox listTitle"><div data-block="true"><span data-text="true">Grid</span></div></div></div>
  <div class="listChildren" style="grid-template-columns: repeat(2, auto);">
    <div class="listChild" data-whiteboard-type="Note"><div class="textBoxBackground softRedGradient"><div class="textbox stickyNote" style="width: 304px; height: 265px; font-size: 32px;"><div data-block="true"><span data-text="true">A</span></div></div></div></div>
    <div class="listChild" data-whiteboard-type="Note"><div class="textBoxBackground softRedGradient"><div class="textbox stickyNote" style="width: 304px; height: 265px; font-size: 32px;"><div data-block="true"><br data-text="true"></div></div></div></div>
    <div class="listChild" data-whiteboard-type="Note"><div class="textBoxBackground softRedGradient"><div class="textbox stickyNote" style="width: 304px; height: 265px; font-size: 32px;"><div data-block="true"><span data-text="true">C</span></div></div></div></div>
  </div>
</div>
<div class="anchor align topLeft" data-whiteboard-type="Hyperlink" style="left: 2000px; top: 0px;">
  <div class="previewCardTitleContainer" style="width: 320px;"><a href="https://www.sqlbi.com/">Home - SQLBI</a><div class="previewCardDescription">Business</div></div>
</div>
<div class="anchor align topLeft" data-whiteboard-type="CommentThread" style="left: 50px; top: 50px;">
  <div class="commentHintContainer" role="button" aria-label="Comment hint: 1"></div>
</div>
<div class="anchor align center" data-whiteboard-type="FluidImage" style="left: 3000px; top: 3000px; transform: matrix(0, 1, -1, 0, 0, 0);">
  <div class="content imageComponent" style="height: 50px; width: 100px;"><img src="data:text/plain;base64,${PNG}"></div>
</div>
<div class="anchor align topLeft" data-whiteboard-type="LoopComponent" style="left: 0px; top: 0px;"></div>
</div></body></html>`

const COMMENTS = JSON.stringify({ description: 'x', commentThreads: [{ id: 1, comments: [{ author: { name: 'Ada', email: 'ada@example.com' }, body: 'Looks good', displayDate: '27.09.2026' }] }] })

describe('Microsoft Whiteboard import', () => {
  it('reads ink and pictures in page order, the remote ink pool is not an object', () => {
    const b = parseMicrosoftWhiteboard(INK_PAGE, null, WORDS)
    expect(b.elements.map((e) => e.type)).toEqual(['ink', 'image', 'ink'])
    expect(b.skipped).toEqual({ StickyNote: 1 })
    expect(b.name).toBe('Sample')
  })

  it('places ink through the view box and the anchor matrix', () => {
    const [line] = parseMicrosoftWhiteboard(INK_PAGE, null, WORDS).elements as InkEl[]
    // (0,0) is 10 and 20 px into the group; ×0.5 around the anchor (100,200), then +(4,6).
    expect(line.x).toBeCloseTo(109, 5)
    expect(line.y).toBeCloseTo(216, 5)
    expect(line.x + line.pts[line.pts.length - 3]).toBeCloseTo(119, 5)
    expect(line.color).toBe('#e71224')
    expect(line.pen).toBe('plain')
    // Arc radius 256/128 = 2 px, ×0.5 → a 2 px stroke; the outline is kept as drawn.
    expect(line.size).toBeCloseTo(2, 5)
    expect(line.outline?.d).toContain('A256,256')
  })

  it('a translucent stroke in a mixed group is a highlighter', () => {
    const hl = parseMicrosoftWhiteboard(INK_PAGE, null, WORDS).elements[2] as InkEl
    expect(hl.pen).toBe('highlighter')
    expect(hl.color).toBe('#28f62d')
    expect(hl.opacity).toBeCloseTo(0.4, 5)
  })

  it('a picture is centred on its anchor and scaled around it; its bytes say its type', () => {
    const b = parseMicrosoftWhiteboard(INK_PAGE, null, WORDS)
    const img = b.elements[1] as ImageEl
    expect([img.x, img.y, img.w, img.h]).toEqual([401, 349, 200, 100])
    expect(b.images.get(img.src)?.type).toBe('image/png')
  })

  it('reads shapes, connectors, notes, text, grids, links and comments', () => {
    const b = parseMicrosoftWhiteboard(OBJECTS_PAGE, COMMENTS, WORDS)
    const types = b.elements.map((e) => e.type)
    expect(types).toEqual(['shape', 'line', 'note', 'text', 'shape', 'text', 'note', 'note', 'note', 'text', 'note', 'image'])
    expect(b.skipped).toEqual({ 'Reactions on notes': 1, LoopComponent: 1 })

    const shape = b.elements[0] as ShapeEl
    expect([shape.x, shape.y, shape.w, shape.h]).toEqual([0, 50, 200, 100])
    expect(shape.fill).toBe('#99c9ef')
    expect(shape.strokeWidth).toBeCloseTo(8 / 3, 5) // 2 pt
    expect(shape.text).toBe('Arrow')

    const conn = b.elements[1] as LineEl
    // The head sits at the start of the route, so the line is reversed and ends there.
    expect(conn.x).toBe(300); expect(conn.y).toBe(100)
    expect(conn.x + conn.dx).toBe(200); expect(conn.y + conn.dy).toBe(100)
    expect(conn.arrowEnd).toBe(true)

    const note = b.elements[2] as NoteEl
    expect(note.color).toBe('#99c9ef')
    expect(note.text).toBe('First line\nSecond & last')
    expect([note.x, note.y, note.w, note.h]).toEqual([1000, 0, 304, 305])

    const text = b.elements[3] as TextEl
    expect(text.color).toBe('#c10051')
    expect(text.font).toBe('hand')
    expect(text.bold).toBe(true)
    expect(text.italic).toBe(true)
    expect(text.align).toBe('center')
    expect([text.x, text.y, text.w]).toEqual([16, 616, 368])

    const grid = b.elements.slice(4, 9)
    expect((grid[1] as TextEl).text).toBe('Grid')
    const notes = grid.slice(2) as NoteEl[]
    expect(notes.map((n) => [n.x, n.y])).toEqual([[17, 1081], [337, 1081], [17, 1401]])
    expect(notes.map((n) => n.text)).toEqual(['A', '', 'C'])

    expect((b.elements[9] as TextEl).text).toBe('Bağlantı: Home - SQLBI\nhttps://www.sqlbi.com/\nBusiness')
    const comment = b.elements[10] as NoteEl
    expect(comment.text).toContain('Ada · 27.09.2026\nLooks good')
    expect(comment.text).not.toContain('@')

    const turned = b.elements[11] as ImageEl
    expect(turned.angle).toBeCloseTo(Math.PI / 2, 5)
  })
})
