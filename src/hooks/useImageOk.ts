import { useEffect, useState } from 'react'

/**
 * Whether an image URL is worth rendering. A picture whose file is gone (the
 * profile still points at it, the object was deleted) otherwise shows the
 * browser's broken-image icon — which is how the avatar bug (#7EFB0246) looked
 * to the user. On the first load error the caller falls back to its initials.
 *
 * The failed URL itself is remembered, so a new upload (the address carries a
 * `?t=` stamp) gets a fresh chance without remounting anything.
 */
export function useImageOk(src: string | null | undefined) {
  const [broken, setBroken] = useState<string | null>(null)
  useEffect(() => {
    setBroken((b) => (b && b !== src ? null : b))
  }, [src])
  return {
    ok: !!src && broken !== src,
    onError: () => setBroken(src ?? null),
  }
}
