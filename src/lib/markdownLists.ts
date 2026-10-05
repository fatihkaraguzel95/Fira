import { Extension } from '@tiptap/core'

/**
 * markdown-it-task-lists tags a whole list as `contains-task-list` as soon as
 * ONE of its items starts with `[ ]`, but tiptap's taskList only accepts
 * taskItem children. A list that mixes both — hand written, or coming from a
 * CSV/Planner/OneNote import:
 *
 *     - a
 *     - [x] b
 *
 * therefore reached ProseMirror as taskList(listItem, taskItem), and the parser
 * "repaired" it by inventing an empty checkbox in front and a plain item
 * reading "[ ]" in the middle (#1F44279C sonrası bildirilen #1F291B1D).
 *
 * So split the mixed list into runs before ProseMirror ever sees it: every run
 * of checkbox items becomes its own taskList, every run of plain items stays a
 * bullet (or numbered) list. Nothing is invented, nothing is dropped, and the
 * result is stable across saves — reparsing the saved markdown splits it the
 * same way again.
 */
export function splitMixedLists(root: Element) {
  root.querySelectorAll('.contains-task-list').forEach((list) => {
    const items = Array.from(list.children).filter((el) => el.tagName === 'LI')
    if (items.length === 0) return
    const isTask = (el: Element) =>
      el.getAttribute('data-type') === 'taskItem' || el.classList.contains('task-list-item')
    const ordered = list.tagName === 'OL'
    // A <ul> whose items are all checkboxes is exactly what taskList wants.
    if (!ordered && items.every(isTask)) return
    if (items.every((el) => !isTask(el))) return

    const doc = list.ownerDocument
    // Numbering survives the split: a plain run that follows a checkbox run
    // starts where it left off.
    let number = Number(list.getAttribute('start') ?? '1') || 1
    let run: Element | null = null
    let runIsTask: boolean | null = null
    for (const item of items) {
      const task = isTask(item)
      if (task !== runIsTask) {
        run = doc.createElement(task || !ordered ? 'ul' : 'ol')
        if (task) {
          run.setAttribute('data-type', 'taskList')
          run.className = 'contains-task-list'
        } else if (ordered && number > 1) {
          run.setAttribute('start', String(number))
        }
        list.parentNode?.insertBefore(run, list)
        runIsTask = task
      }
      run?.appendChild(item)
      number += 1
    }
    list.remove()
  })
}

/**
 * Hooks {@link splitMixedLists} into tiptap-markdown's parse pipeline. The
 * priority keeps it behind the taskList/taskItem hooks that stamp `data-type`,
 * but the split reads the markdown-it classes too, so it does not depend on it.
 */
export const MixedLists = Extension.create({
  name: 'mixedLists',
  priority: 50,
  addStorage() {
    return {
      markdown: {
        parse: {
          updateDOM(element: HTMLElement) {
            splitMixedLists(element)
          },
        },
      },
    }
  },
})
