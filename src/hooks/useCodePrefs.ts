import { useEffect } from 'react'
import { usePrefs, GLOBAL_SCOPE } from './usePrefs'
import { setCodeLineNumbers } from '../lib/codePrefs'

/**
 * Kod bloğu satır numarası tercihi (#58789618). Değeri döndürür (okuma
 * görünümü doğrudan kullanır) ve düzenleyicinin düğüm görünümünün okuduğu
 * modüle yazar — o taraf React dışında olduğu için köprü gerekiyor.
 */
export function useCodeLineNumbers(): boolean {
  const prefs = usePrefs(GLOBAL_SCOPE)
  const on = (prefs.prefs as { editor?: { lineNumbers?: unknown } }).editor?.lineNumbers === true
  useEffect(() => { setCodeLineNumbers(on) }, [on])
  return on
}
