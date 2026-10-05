/**
 * @mentions (#3461B7F0).
 *
 * In the text a mention is a markdown link `[@Name](fira://u/<user id>)`: any
 * markdown renderer shows "@Name", the server finds the id (076 `mention_user_ids`)
 * and the editor turns the link into a mention chip on load. Only the id is
 * authoritative — the label is whatever the name was when the mention was made.
 */
import { Mention, type MentionNodeAttrs } from '@tiptap/extension-mention'
import { mergeAttributes } from '@tiptap/core'
import type { SuggestionOptions } from '@tiptap/suggestion'

export const MENTION_HREF = 'fira://u/'

export interface MentionItem { id: string; label: string; avatar?: string | null }

/** `[@Name](fira://u/id)` — brackets in a name would end the link early, so they are dropped. */
export const mentionMarkdown = (id: string, label: string) => `[@${label.replace(/[[\]()]/g, '')}](${MENTION_HREF}${id})`

/** The user id behind a mention link, or null for any other href. */
export const mentionIdFromHref = (href: string | null | undefined): string | null =>
  href && href.startsWith(MENTION_HREF) ? href.slice(MENTION_HREF.length) : null

/** Every user id mentioned in a markdown text (the same regex the server uses). */
export const mentionIdsIn = (text: string): string[] =>
  Array.from(new Set(Array.from(text.matchAll(/fira:\/\/u\/([0-9a-fA-F-]{36})/g), (m) => m[1].toLowerCase())))

/** Markdown's `<a href="fira://u/…">@Name</a>` → the mention node the editor knows. */
function linksToMentions(root: HTMLElement) {
  root.querySelectorAll<HTMLAnchorElement>(`a[href^="${MENTION_HREF}"]`).forEach((a) => {
    const id = mentionIdFromHref(a.getAttribute('href'))
    if (!id) return
    const span = document.createElement('span')
    span.setAttribute('data-type', 'mention')
    span.setAttribute('data-id', id)
    span.setAttribute('data-label', (a.textContent ?? '').replace(/^@/, ''))
    span.textContent = a.textContent
    a.replaceWith(span)
  })
}

type MdState = { write(s: string): void }

/**
 * The editor node. `suggestion` is supplied by the editor (it needs the
 * component's member list and popup); serialization to markdown lives here.
 */
export const MentionNode = Mention.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: MdState, node: { attrs: MentionNodeAttrs }) {
          state.write(mentionMarkdown(String(node.attrs.id ?? ''), String(node.attrs.label ?? node.attrs.id ?? '')))
        },
        parse: {
          updateDOM(element: HTMLElement) { linksToMentions(element) },
        },
      },
    }
  },
}).configure({
  HTMLAttributes: { class: 'mention' },
  renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
  renderHTML: ({ options, node }) => [
    'span',
    mergeAttributes({ 'data-type': 'mention', 'data-id': node.attrs.id, 'data-label': node.attrs.label }, options.HTMLAttributes),
    `@${node.attrs.label ?? node.attrs.id}`,
  ],
  deleteTriggerWithBackspace: true,
})

/** Case- and accent-insensitive prefix/substring match on the name ("ali" finds "Ali İlker"). */
export function filterMentionItems(items: MentionItem[], query: string): MentionItem[] {
  const fold = (s: string) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '')
  const q = fold(query.trim())
  if (!q) return items.slice(0, 8)
  const starts = items.filter((i) => fold(i.label).split(/\s+/).some((w) => w.startsWith(q)))
  const contains = items.filter((i) => !starts.includes(i) && fold(i.label).includes(q))
  return [...starts, ...contains].slice(0, 8)
}

export type MentionSuggestion = Omit<SuggestionOptions<MentionItem, MentionNodeAttrs>, 'editor'>
