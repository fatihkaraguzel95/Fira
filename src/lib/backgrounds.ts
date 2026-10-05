/**
 * List backgrounds.
 *
 * The brief was "find a free service and suggest 20 minimalist, engineering and
 * design flavoured images, with a refresh for 20 more". Photo services were a
 * dead end here: Unsplash and Pexels need an API key, and picsum.photos is not
 * reachable from this network — a background that fails to load is worse than
 * none. So the suggestions are generated instead: deterministic SVG patterns
 * (blueprint grids, isometric meshes, contour lines…) over muted palettes.
 * Free, no key, no attribution, no outside request at view time, and an endless
 * supply — every refresh seeds a new set. Anyone who wants a photo can still
 * upload their own file.
 *
 * A chosen background is uploaded to storage as a file, so the board only ever
 * renders a URL and does not depend on this generator staying the same.
 */

export interface BackgroundSuggestion {
  id: string
  label: string
  /** Inline SVG markup — used both for the preview and for what gets uploaded. */
  svg: string
}

interface Palette { name: string; bg: string; ink: string; accent: string }

const PALETTES: Palette[] = [
  { name: 'Gece mavisi', bg: '#0f172a', ink: '#1e40af', accent: '#38bdf8' },
  { name: 'Grafit', bg: '#111827', ink: '#374151', accent: '#9ca3af' },
  { name: 'Mürekkep', bg: '#1e1b4b', ink: '#4338ca', accent: '#a78bfa' },
  { name: 'Okyanus', bg: '#082f49', ink: '#0e7490', accent: '#22d3ee' },
  { name: 'Orman', bg: '#052e2b', ink: '#0f766e', accent: '#5eead4' },
  { name: 'Kağıt', bg: '#f8fafc', ink: '#cbd5e1', accent: '#94a3b8' },
  { name: 'Kum', bg: '#fdf6ec', ink: '#e7d3b3', accent: '#c8a97e' },
  { name: 'Mermer', bg: '#f5f5f4', ink: '#d6d3d1', accent: '#a8a29e' },
  { name: 'Buz', bg: '#f0f9ff', ink: '#bae6fd', accent: '#7dd3fc' },
  { name: 'Gül kurusu', bg: '#fff1f2', ink: '#fecdd3', accent: '#fb7185' },
  { name: 'Bakır', bg: '#1c1917', ink: '#7c2d12', accent: '#fdba74' },
  { name: 'Zeytin', bg: '#f7f8f3', ink: '#d9e0cd', accent: '#84a07a' },
]

type PatternFn = (p: Palette, r: () => number) => string

/** Every pattern paints the full 1600×1000 canvas; they are meant to sit behind content. */
const PATTERNS: { name: string; draw: PatternFn }[] = [
  {
    name: 'Teknik çizim',
    draw: (p) => `
      <rect width="1600" height="1000" fill="${p.bg}"/>
      <defs>
        <pattern id="fine" width="72" height="72" patternUnits="userSpaceOnUse">
          <path d="M72 0H0V72" fill="none" stroke="${p.ink}" stroke-width="2" opacity="0.55"/>
        </pattern>
        <pattern id="coarse" width="288" height="288" patternUnits="userSpaceOnUse">
          <path d="M288 0H0V288" fill="none" stroke="${p.accent}" stroke-width="3.5" opacity="0.5"/>
        </pattern>
      </defs>
      <rect width="1600" height="1000" fill="url(#fine)"/>
      <rect width="1600" height="1000" fill="url(#coarse)"/>`,
  },
  {
    name: 'İzometrik ızgara',
    draw: (p) => `
      <rect width="1600" height="1000" fill="${p.bg}"/>
      <defs>
        <pattern id="iso" width="140" height="80" patternUnits="userSpaceOnUse">
          <path d="M0 80 L70 0 L140 80 M0 0 L70 80 L140 0" fill="none" stroke="${p.ink}" stroke-width="2.2" opacity="0.6"/>
        </pattern>
      </defs>
      <rect width="1600" height="1000" fill="url(#iso)"/>`,
  },
  {
    name: 'Nokta matrisi',
    draw: (p) => `
      <rect width="1600" height="1000" fill="${p.bg}"/>
      <defs>
        <pattern id="dots" width="72" height="72" patternUnits="userSpaceOnUse">
          <circle cx="36" cy="36" r="5" fill="${p.ink}" opacity="0.75"/>
        </pattern>
      </defs>
      <rect width="1600" height="1000" fill="url(#dots)"/>`,
  },
  {
    name: 'Eş yükselti',
    draw: (p, r) => {
      const lines = Array.from({ length: 16 }, (_, i) => {
        const y = 60 + i * 60 + r() * 20
        const a = 30 + r() * 50
        return `<path d="M-50 ${y} C 300 ${y - a}, 600 ${y + a}, 900 ${y - a / 2} S 1400 ${y + a}, 1650 ${y - a / 3}" fill="none" stroke="${i % 4 === 0 ? p.accent : p.ink}" stroke-width="${i % 4 === 0 ? 4 : 2.4}" opacity="0.6"/>`
      }).join('')
      return `<rect width="1600" height="1000" fill="${p.bg}"/>${lines}`
    },
  },
  {
    name: 'Tarama',
    draw: (p) => `
      <rect width="1600" height="1000" fill="${p.bg}"/>
      <defs>
        <pattern id="hatch" width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="36" stroke="${p.ink}" stroke-width="4" opacity="0.55"/>
        </pattern>
      </defs>
      <rect width="1600" height="1000" fill="url(#hatch)"/>`,
  },
  {
    name: 'Petek',
    draw: (p) => `
      <rect width="1600" height="1000" fill="${p.bg}"/>
      <defs>
        <pattern id="hex" width="150" height="87" patternUnits="userSpaceOnUse">
          <path d="M37 0 L112 0 L150 43 L112 87 L37 87 L0 43 Z" fill="none" stroke="${p.ink}" stroke-width="2.4" opacity="0.6"/>
        </pattern>
      </defs>
      <rect width="1600" height="1000" fill="url(#hex)"/>`,
  },
  {
    name: 'Radar',
    draw: (p, r) => {
      const cx = 200 + r() * 1200
      const cy = 200 + r() * 600
      const rings = Array.from({ length: 9 }, (_, i) =>
        `<circle cx="${cx}" cy="${cy}" r="${80 + i * 90}" fill="none" stroke="${i % 3 === 0 ? p.accent : p.ink}" stroke-width="2.6" opacity="0.55"/>`).join('')
      return `<rect width="1600" height="1000" fill="${p.bg}"/>${rings}`
    },
  },
  {
    name: 'Yumuşak geçiş',
    draw: (p, r) => {
      const blob = (i: number) => {
        const cx = 200 + r() * 1200, cy = 100 + r() * 800, rad = 260 + r() * 320
        return `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="url(#g${i})" opacity="0.55"/>`
      }
      const defs = [p.accent, p.ink, p.accent].map((c, i) =>
        `<radialGradient id="g${i}"><stop offset="0" stop-color="${c}" stop-opacity="0.9"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`).join('')
      return `<rect width="1600" height="1000" fill="${p.bg}"/><defs>${defs}</defs>${[0, 1, 2].map(blob).join('')}`
    },
  },
  {
    name: 'Dalga',
    draw: (p, r) => {
      const waves = Array.from({ length: 10 }, (_, i) => {
        const y = 120 + i * 90
        const amp = 20 + r() * 30
        return `<path d="M0 ${y} Q 200 ${y - amp}, 400 ${y} T 800 ${y} T 1200 ${y} T 1600 ${y}" fill="none" stroke="${p.ink}" stroke-width="3" opacity="0.55"/>`
      }).join('')
      return `<rect width="1600" height="1000" fill="${p.bg}"/>${waves}`
    },
  },
  {
    name: 'Artı işaretleri',
    draw: (p) => `
      <rect width="1600" height="1000" fill="${p.bg}"/>
      <defs>
        <pattern id="plus" width="90" height="90" patternUnits="userSpaceOnUse">
          <path d="M45 32v26M32 45h26" stroke="${p.ink}" stroke-width="3.2" opacity="0.7" stroke-linecap="round"/>
        </pattern>
      </defs>
      <rect width="1600" height="1000" fill="url(#plus)"/>`,
  },
  {
    name: 'Devre',
    draw: (p, r) => {
      const paths = Array.from({ length: 22 }, () => {
        const x = Math.round(r() * 1500 / 20) * 20
        const y = Math.round(r() * 900 / 20) * 20
        const dx = (r() > 0.5 ? 1 : -1) * (60 + Math.round(r() * 8) * 20)
        const dy = (r() > 0.5 ? 1 : -1) * (40 + Math.round(r() * 6) * 20)
        return `<path d="M${x} ${y} h${dx} v${dy}" fill="none" stroke="${p.ink}" stroke-width="2.8" opacity="0.6"/><circle cx="${x}" cy="${y}" r="6" fill="${p.accent}" opacity="0.75"/>`
      }).join('')
      return `<rect width="1600" height="1000" fill="${p.bg}"/>${paths}`
    },
  },
  {
    name: 'Kesişen çizgiler',
    draw: (p, r) => {
      const lines = Array.from({ length: 18 }, () => {
        const x1 = r() * 1600, y1 = r() * 1000, x2 = r() * 1600, y2 = r() * 1000
        return `<line x1="${x1.toFixed(0)}" y1="${y1.toFixed(0)}" x2="${x2.toFixed(0)}" y2="${y2.toFixed(0)}" stroke="${p.ink}" stroke-width="2.2" opacity="0.5"/>`
      }).join('')
      return `<rect width="1600" height="1000" fill="${p.bg}"/>${lines}`
    },
  },
]

/** Small deterministic PRNG so a seed always yields the same 20 suggestions. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function generateBackgrounds(seed: number, count = 20): BackgroundSuggestion[] {
  const r = rng(seed || 1)
  const out: BackgroundSuggestion[] = []
  const used = new Set<string>()
  let guard = 0
  while (out.length < count && guard++ < count * 12) {
    const pat = PATTERNS[Math.floor(r() * PATTERNS.length)]
    const pal = PALETTES[Math.floor(r() * PALETTES.length)]
    const key = `${pat.name}|${pal.name}`
    if (used.has(key)) continue
    used.add(key)
    const body = pat.draw(pal, r)
    out.push({
      id: `${seed}-${out.length}`,
      label: `${pat.name} · ${pal.name}`,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="1600" height="1000" preserveAspectRatio="xMidYMid slice">${body}</svg>`,
    })
  }
  return out
}

export const svgDataUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
