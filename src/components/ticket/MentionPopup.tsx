/**
 * The "@" popup of the editor (#3461B7F0): a short list of team members that
 * follows the caret; arrows move, Enter/Tab pick, Esc closes (and only closes
 * the list — the field, fullscreen and window stay).
 */
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { displayUrl } from '../../lib/storage'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import { markHandled } from '../../lib/keys'
import { filterMentionItems, type MentionItem, type MentionSuggestion } from '../../lib/mentions'
import { t } from '../../i18n'

type ListProps = { items: MentionItem[]; command: (item: { id: string; label: string }) => void }
type ListHandle = { onKeyDown: (p: SuggestionKeyDownProps) => boolean }

const MentionList = forwardRef<ListHandle, ListProps>(function MentionList({ items, command }, ref) {
  const [index, setIndex] = useState(0)
  useEffect(() => { setIndex(0) }, [items])
  const pick = (i: number) => { const it = items[i]; if (it) command({ id: it.id, label: it.label }) }
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') { setIndex((i) => (i + items.length - 1) % Math.max(1, items.length)); return true }
      if (event.key === 'ArrowDown') { setIndex((i) => (i + 1) % Math.max(1, items.length)); return true }
      if (event.key === 'Enter' || event.key === 'Tab') { if (!items.length) return false; pick(index); return true }
      return false
    },
  }), [items, index])
  return (
    <div role="listbox" aria-label={t('ticket.editor.mentionList')} className="min-w-[200px] max-w-[280px] py-1 rounded-lg border border-line bg-surface shadow-2xl text-sm">
      {items.length === 0 && <div className="px-3 py-1.5 text-fg-faint">{t('ticket.editor.mentionEmpty')}</div>}
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          role="option"
          aria-selected={i === index}
          onMouseDown={(e) => { e.preventDefault(); pick(i) }}
          onMouseEnter={() => setIndex(i)}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer ${i === index ? 'bg-primary-500/10 text-fg' : 'text-fg-2'}`}
        >
          {it.avatar
            ? <img src={displayUrl(it.avatar) ?? ''} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
            : <span className="w-5 h-5 rounded-full bg-raised text-2xs font-semibold flex items-center justify-center flex-shrink-0 text-fg-2">{it.label.slice(0, 1).toLocaleUpperCase('tr')}</span>}
          <span className="truncate">{it.label}</span>
        </button>
      ))}
    </div>
  )
})

/**
 * Suggestion config for the Mention node. `getItems` is read on every keystroke,
 * so the member list can arrive after the editor was created (the editor's
 * options are built once — see DescriptionEditor).
 */
export function mentionSuggestion(getItems: () => MentionItem[]): MentionSuggestion {
  return {
    char: '@',
    allowSpaces: false,
    items: ({ query }) => filterMentionItems(getItems(), query),
    render: () => {
      let renderer: ReactRenderer<ListHandle, ListProps> | null = null
      let host: HTMLDivElement | null = null
      const place = (props: SuggestionProps<MentionItem>) => {
        const rect = props.clientRect?.()
        if (!host || !rect) return
        const h = host.offsetHeight || 200
        const below = rect.bottom + 4 + h <= window.innerHeight
        host.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 292))}px`
        host.style.top = `${below ? rect.bottom + 4 : Math.max(8, rect.top - 4 - h)}px`
      }
      const close = () => { renderer?.destroy(); renderer = null; host?.remove(); host = null }
      return {
        onStart: (props) => {
          if (!getItems().length) return
          renderer = new ReactRenderer(MentionList, { props, editor: props.editor })
          host = document.createElement('div')
          host.className = 'fixed z-[9500]'
          host.appendChild(renderer.element)
          document.body.appendChild(host)
          place(props)
        },
        onUpdate: (props) => { renderer?.updateProps(props); place(props) },
        onKeyDown: (props) => {
          if (props.event.key === 'Escape') { markHandled(props.event); close(); return true }
          return renderer?.ref?.onKeyDown(props) ?? false
        },
        onExit: close,
      }
    },
  }
}
