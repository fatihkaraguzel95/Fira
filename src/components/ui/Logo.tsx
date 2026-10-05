/**
 * Fira brand assets.
 *
 * The mark is a 3D ribbon render (design/brand/mark.png), so it ships as a PNG
 * rather than SVG: `public/brand/fira-mark.png`, tight-cropped, transparent.
 * The wordmark ships as an alpha mask (`public/brand/fira-wordmark.png`) and is
 * painted with `currentColor`, so it inherits the surrounding text colour in
 * both themes. Regenerate both with `node scripts/gen-icons.mjs`.
 */

/** Aspect ratios of the shipped assets — measured from the masters. */
const MARK_RATIO = 0.704 // width / height
const WORD_RATIO = 2.094 // width / height

/** Lockup proportions, measured on design/brand/lockup-on-light.png. */
const LOCKUP_WORD = 0.748 // wordmark height / mark height
const LOCKUP_GAP = 0.177 // gap / mark height

/** Position of the dot over the i, as a share of the wordmark box. */
const DOT = { left: 28.6, top: 5.9, width: 10.3, height: 21.1 }

/** Fira brand mark: the blue-to-violet ribbon "F". */
export function FiraMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/brand/fira-mark.png"
      width={Math.round(size * MARK_RATIO)}
      height={size}
      style={{ width: Math.round(size * MARK_RATIO), height: size }}
      className={`select-none ${className}`}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}

/**
 * Lowercase wordmark "fira". Sized from the current font-size, coloured with
 * `currentColor`, with the brand gradient kept on the dot of the i.
 */
export function FiraWordmark({ className = '', height }: { className?: string; height?: number }) {
  const mask = 'url(/brand/fira-wordmark.png) no-repeat center / contain'
  const h = height != null ? `${height}px` : '0.86em'
  const w = height != null ? `${Math.round(height * WORD_RATIO)}px` : `calc(0.86em * ${WORD_RATIO})`
  return (
    <span
      role="img"
      aria-label="fira"
      className={`relative inline-block align-baseline select-none ${className}`}
      style={{
        height: h,
        width: w,
        backgroundColor: 'currentColor',
        WebkitMask: mask,
        mask,
      }}
    >
      {/* Clipped by the mask, so it paints exactly the dot of the i. */}
      <span
        aria-hidden="true"
        className="absolute"
        style={{
          left: `${DOT.left - 1}%`,
          top: `${DOT.top - 2}%`,
          width: `${DOT.width + 2}%`,
          height: `${DOT.height + 4}%`,
          background: 'linear-gradient(135deg, #3B82F6 0%, #7C3AED 55%, #C05BF5 100%)',
        }}
      />
    </span>
  )
}

/** Mark + wordmark side by side, in the proportions of the master lockup. */
export function FiraLogo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center ${className}`} style={{ gap: Math.round(size * LOCKUP_GAP) }}>
      <FiraMark size={size} />
      <FiraWordmark height={Math.round(size * LOCKUP_WORD)} />
    </span>
  )
}
