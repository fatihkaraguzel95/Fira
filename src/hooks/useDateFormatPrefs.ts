import { useEffect } from 'react'
import { usePrefs, GLOBAL_SCOPE } from './usePrefs'
import {
  DEFAULT_DATE_FORMAT, getDateFormat, sanitizeDateFormat, setDateFormat, useDateFormat,
  type DateFormatPrefs,
} from '../lib/time'

/**
 * Bridges the stored date-format preference into the module-level store the
 * formatters read (`src/lib/time.ts`).
 *
 * The `loaded` guard is the lesson from #1c92b701: `usePrefs` resolves the user
 * asynchronously, and pushing `{}` before the real value arrives would apply the
 * defaults and then never correct them on a client-side navigation. Nothing is
 * pushed until the prefs for this scope are actually here.
 */
export function useDateFormatSync() {
  const { prefs, loaded } = usePrefs(GLOBAL_SCOPE)
  useEffect(() => {
    if (!loaded) return
    setDateFormat(sanitizeDateFormat(prefs.dateFormat))
  }, [loaded, prefs.dateFormat])
}

/** Read + write the preference from the settings screen. */
export function useDateFormatSetting() {
  const { prefs, loaded, patch } = usePrefs(GLOBAL_SCOPE)
  const value = useDateFormat()          // repaints the previews on every change
  const set = (next: Partial<DateFormatPrefs>) => {
    const merged = { ...getDateFormat(), ...next }
    setDateFormat(merged)                // instant, so the preview never lags
    patch({ dateFormat: merged })        // debounced write-through
  }
  const reset = () => { setDateFormat(DEFAULT_DATE_FORMAT); patch({ dateFormat: null }) }
  return { value: loaded ? value : sanitizeDateFormat(prefs.dateFormat), set, reset }
}
