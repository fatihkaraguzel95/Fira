import { useState, type ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { useLang, useT } from '../../i18n'
import { useTextHash } from '../../hooks/useReading'
import { langName, translationFor, type Reading, type TranslationRow } from '../../lib/reading'

/**
 * A text and, when the reader does not read its language, its translation (113, #fa4b05e9).
 *
 * The caller draws the text (`children(text, translated)`); this decides which text and adds the
 * line underneath that says a model translated it and switches to the original and back. The
 * translation is shown only when it was made for exactly this text (`translationFor`): until the
 * hash of the text is known, and after the text changes, the reader sees the text itself.
 *
 *   preferOriginal  start on the original (the reader put the cursor in the text before the
 *                   translation arrived); the line still offers the translation
 *   locked          the original and nothing else: there is an unsaved edit, and replacing the
 *                   editor under it would hide what the person is writing
 */
export function Translated({ original, row, reading, preferOriginal = false, locked = false, children }: {
  original: string
  row: TranslationRow | undefined
  reading: Reading
  preferOriginal?: boolean
  locked?: boolean
  children: (text: string, translated: boolean) => ReactNode
}) {
  const t = useT()
  const lang = useLang()
  const hash = useTextHash(original, !!row)
  const translation = translationFor(row, hash, reading)
  const [choice, setChoice] = useState<'original' | 'translated' | null>(null)
  if (translation == null || locked) return <>{children(original, false)}</>
  const translated = choice ? choice === 'translated' : !preferOriginal
  const from = langName(row?.source_lang, lang)
  return (
    <>
      {children(translated ? translation : original, translated)}
      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-fg-muted" data-translation-note={translated ? 'translated' : 'original'}>
        <Icon name="language" className="text-fg-faint" />
        <span>
          {translated
            ? (from ? t('ticketExtra.translation.byAi', { lang: from }) : t('ticketExtra.translation.byAiNoLang'))
            : (from ? t('ticketExtra.translation.original', { lang: from }) : t('ticketExtra.translation.originalNoLang'))}
        </span>
        <button
          type="button"
          onClick={() => setChoice(translated ? 'original' : 'translated')}
          className="font-medium text-primary-600 dark:text-primary-400 hover:underline cursor-pointer"
          data-translation-toggle
        >
          {translated ? t('ticketExtra.translation.showOriginal') : t('ticketExtra.translation.showTranslation')}
        </button>
      </p>
    </>
  )
}
