/**
 * "Paylaş" — a task's address in a form that survives a paste into Teams,
 * Outlook or any other rich-text box (#81EE7B5E).
 *
 * Two flavours go on the clipboard at once:
 *  - `text/html`: a real anchor, so a chat box shows a clickable "#81EE7B Başlık".
 *  - `text/plain`: **the bare address**. Markdown used to go here, but a
 *    `[başlık](adres)` pasted into a browser bar or a plain chat box is not a
 *    link, it is punctuation (kullanıcı, 28 Eyl). The label survives wherever
 *    rich text does; everywhere else the address is what is useful.
 *
 * Kopyalama sessiz kalmasın diye her yol bir bildirim düşürür — düğmeye basılıp
 * basılmadığı anlaşılmıyordu (aynı gün, aynı istek).
 *
 * The address is built from the page's own origin, exactly like the API base
 * (`/api`), so a link copied from the IP and one copied from the domain both
 * keep working for whoever opens them.
 */
import { emitToast } from './errorToast'
import { t } from '../i18n'
export const shortTicketId = (id: string) => id.slice(0, 6).toUpperCase()

export const ticketUrl = (id: string) => `${window.location.origin}/ticket/${id}`
/** Sayfanın adresi; `anchor` verilirse sayfa o bloğa kayar (#d46f6d70). */
export const pageUrl = (id: string, anchor?: string | null) =>
  `${window.location.origin}/page/${id}${anchor ? `#${anchor}` : ''}`
/** Bir listenin (pano) adresi: açan kişide o liste seçili gelir. */
export const listUrl = (id: string, view?: 'board' | 'list' | null) =>
  `${window.location.origin}/list/${id}${view ? `?view=${view}` : ''}`

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** `title` rides along in the link text — "#81EE7B Paylaşma, link olarak" reads in a chat; a bare id does not (kullanıcı, 15 Eyl). */
export function ticketLinkParts(id: string, title?: string | null) {
  const url = ticketUrl(id)
  const clean = (title ?? '').replace(/\s+/g, ' ').trim()
  const label = clean ? `#${shortTicketId(id)} ${clean}` : `#${shortTicketId(id)}`
  return {
    url,
    label,
    /** Düz metin: adresin kendisi (yapıştırıldığı yerde tıklanabilir olsun). */
    text: url,
    html: `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`,
  }
}

/**
 * Puts the link on the clipboard in both flavours. Falls back to plain text
 * wherever `ClipboardItem` is missing or refused (older browser, clipboard
 * permission, insecure context) — the markdown form still pastes fine.
 */
export async function copyTicketLink(id: string, title?: string | null): Promise<boolean> {
  const { text, html } = ticketLinkParts(id, title)
  return copyBoth(text, html)
}

/**
 * Herhangi bir adresi aynı iki biçimde panoya koyar: sohbet kutusunda
 * tıklanabilir bir bağlantı, düz metinde markdown bağlantısı.
 */
export async function copyLink(url: string, label: string): Promise<boolean> {
  const clean = (label || url).replace(/\s+/g, ' ').trim()
  return copyBoth(url, `<a href="${escapeHtml(url)}">${escapeHtml(clean)}</a>`)
}

async function copyBoth(text: string, html: string): Promise<boolean> {
  const ok = await writeBoth(text, html)
  // Tek satırlık geri bildirim: kopyalandı mı, nereye gittiği belli olsun.
  if (ok) emitToast(t('common.linkCopied'), text)
  return ok
}

async function writeBoth(text: string, html: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
      return true
    }
  } catch {
    /* fall through to plain text */
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Non-secure context: the old textarea trick, plain text only.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
