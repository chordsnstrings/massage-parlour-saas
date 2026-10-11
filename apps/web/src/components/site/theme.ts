import type { CSSProperties } from 'react'

/** Theme tokens stored in `sites.theme` (PLAN §11.3 layer 1). Switching template swaps these, never content. */
export type SiteTheme = {
  bg: string
  surface: string
  subtle: string
  border: string
  fg: string
  muted: string
  accent: string
  accentFg: string
  accentSoft: string
  inverseBg: string
  inverseFg: string
  headingFont: 'serif' | 'sans'
  bodyFont: 'serif' | 'sans'
  headingWeight: number
  headingCase: 'none' | 'uppercase'
  /** Letter spacing in em. */
  headingTracking: number
  radius: 'none' | 'soft' | 'round'
  buttonShape: 'square' | 'rounded' | 'pill'
  density: 'compact' | 'comfortable' | 'airy'
  motion: 'none' | 'subtle' | 'expressive'
  /** Subtle background pattern on tinted bands (P2 templates). */
  pattern: 'none' | 'lattice' | 'arabesque' | 'leaf'
  /** Arabic heading face used in RTL: Naskh (classic), Kufi (geometric display) or plain sans. */
  arabicFont: 'naskh' | 'kufi' | 'sans' | 'amiri'
  /** Image block corners: theme radius, Arabic arch, or soft organic shape. */
  imageShape: 'theme' | 'arch' | 'organic'
  /** Named Latin heading face (R5 design templates); 'theme' uses the serif/sans stack of `headingFont`. */
  headingFace?: HeadingFace
  /** Decorative hero background drawn in CSS (no images): hairlines, rings, marble, rays, skyline… */
  backdrop?: Backdrop
  /** Hero emblem built from the spa name (seal, numeral, flap board…); shown where the hero has no photo. */
  emblem?: Emblem
  /** How `*words*` in headlines are set off: italic accent, muted second tone, or underline. */
  emphasis?: 'italic' | 'muted' | 'underline'
}

export const HEADING_FACES = {
  theme: '',
  cormorant: '"Cormorant Garamond Variable", "Cormorant Garamond"',
  playfair: '"Playfair Display Variable", "Playfair Display"',
  bodoni: '"Bodoni Moda Variable", "Bodoni Moda"',
  marcellus: 'Marcellus',
  dmserif: '"DM Serif Display"',
  baskerville: '"Libre Baskerville"',
  fraunces: '"Fraunces Variable", Fraunces',
  manrope: '"Manrope Variable", Manrope',
  sora: '"Sora Variable", Sora',
  intertight: '"Inter Tight Variable", "Inter Tight"',
  jakarta: '"Plus Jakarta Sans Variable", "Plus Jakarta Sans"',
  nunito: '"Nunito Variable", Nunito',
  grotesk: '"Space Grotesk Variable", "Space Grotesk"',
} as const
export type HeadingFace = keyof typeof HEADING_FACES
export const BACKDROPS = [
  'none',
  'hairlines',
  'rings',
  'marble',
  'sheen',
  'rays',
  'skyline',
  'monogram',
  'glow',
  'strata',
  'aurora',
  'grid',
  'dunes',
  'blobs',
] as const
export type Backdrop = (typeof BACKDROPS)[number]
export const EMBLEMS = [
  'none',
  'seal',
  'numeral',
  'tile',
  'glass',
  'arch',
  'flap',
  'bento',
  'monogram',
] as const
export type Emblem = (typeof EMBLEMS)[number]

/** Latin + Arabic-capable stacks (system fonts; Inter is already self-hosted by the app). */
export const FONT_STACKS = {
  sans: '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", "IBM Plex Sans Arabic", "Noto Sans Arabic", "Geeza Pro", Tahoma, sans-serif',
  serif:
    '"Cormorant Garamond Variable", "Cormorant Garamond", "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Noto Naskh Arabic", "Amiri", "Times New Roman", serif',
} as const

/** Arabic heading stacks (system fonts; Latin glyphs fall through to the Latin stack's fonts). */
export const ARABIC_STACKS = {
  naskh: '"Noto Naskh Arabic Variable", "Noto Naskh Arabic", "Amiri", "Geeza Pro", "Times New Roman", serif',
  kufi: '"Noto Kufi Arabic Variable", "Noto Kufi Arabic", "Reem Kufi", "Al Bayan", "Geeza Pro", "Segoe UI", Tahoma, sans-serif',
  sans: '"IBM Plex Sans Arabic", "Noto Sans Arabic", "Geeza Pro", "Segoe UI", Tahoma, sans-serif',
  amiri: 'Amiri, "Noto Naskh Arabic Variable", "Geeza Pro", "Times New Roman", serif',
} as const

export const DEFAULT_THEME: SiteTheme = {
  bg: '#fafaf8',
  surface: '#ffffff',
  subtle: '#f3f2ef',
  border: '#e7e5e0',
  fg: '#1c1c1a',
  muted: '#6b6a66',
  accent: '#5e7d6b',
  accentFg: '#ffffff',
  accentSoft: '#e8eeea',
  inverseBg: '#1c1c1a',
  inverseFg: '#fafaf8',
  headingFont: 'sans',
  bodyFont: 'sans',
  headingWeight: 600,
  headingCase: 'none',
  headingTracking: -0.02,
  radius: 'soft',
  buttonShape: 'pill',
  density: 'comfortable',
  motion: 'subtle',
  pattern: 'none',
  arabicFont: 'sans',
  imageShape: 'theme',
  headingFace: 'theme',
  backdrop: 'none',
  emblem: 'none',
  emphasis: 'italic',
}

const HEX = /^#[0-9a-f]{3,8}$/i
const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

/** Validates stored tokens (jsonb) and fills gaps from the default theme. */
export function normalizeTheme(tokens: Record<string, unknown> | null | undefined): SiteTheme {
  const t = tokens ?? {}
  const color = (k: keyof SiteTheme) =>
    typeof t[k] === 'string' && HEX.test(t[k] as string) ? (t[k] as string) : (DEFAULT_THEME[k] as string)
  const num = (k: keyof SiteTheme, min: number, max: number) => {
    const n = Number(t[k])
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : (DEFAULT_THEME[k] as number)
  }
  return {
    bg: color('bg'),
    surface: color('surface'),
    subtle: color('subtle'),
    border: color('border'),
    fg: color('fg'),
    muted: color('muted'),
    accent: color('accent'),
    accentFg: color('accentFg'),
    accentSoft: color('accentSoft'),
    inverseBg: color('inverseBg'),
    inverseFg: color('inverseFg'),
    headingFont: pick(t.headingFont, ['serif', 'sans'], DEFAULT_THEME.headingFont),
    bodyFont: pick(t.bodyFont, ['serif', 'sans'], DEFAULT_THEME.bodyFont),
    headingWeight: num('headingWeight', 300, 700),
    headingCase: pick(t.headingCase, ['none', 'uppercase'], DEFAULT_THEME.headingCase),
    headingTracking: num('headingTracking', -0.05, 0.3),
    radius: pick(t.radius, ['none', 'soft', 'round'], DEFAULT_THEME.radius),
    buttonShape: pick(t.buttonShape, ['square', 'rounded', 'pill'], DEFAULT_THEME.buttonShape),
    density: pick(t.density, ['compact', 'comfortable', 'airy'], DEFAULT_THEME.density),
    motion: pick(t.motion, ['none', 'subtle', 'expressive'], DEFAULT_THEME.motion),
    pattern: pick(t.pattern, ['none', 'lattice', 'arabesque', 'leaf'], DEFAULT_THEME.pattern),
    // Themes saved before the token existed keep the face that matches their Latin headings.
    arabicFont: pick(
      t.arabicFont,
      ['naskh', 'kufi', 'sans', 'amiri'],
      t.headingFont === 'serif' ? 'naskh' : 'sans',
    ),
    imageShape: pick(t.imageShape, ['theme', 'arch', 'organic'], DEFAULT_THEME.imageShape),
    headingFace: pick(t.headingFace, Object.keys(HEADING_FACES) as HeadingFace[], 'theme'),
    backdrop: pick(t.backdrop, BACKDROPS, 'none'),
    emblem: pick(t.emblem, EMBLEMS, 'none'),
    emphasis: pick(t.emphasis, ['italic', 'muted', 'underline'] as const, 'italic'),
  }
}

const RADIUS = { none: '0px', soft: '12px', round: '22px' } as const
const BUTTON_RADIUS = { square: '0px', rounded: '10px', pill: '999px' } as const
const DENSITY = { compact: '0.75', comfortable: '1', airy: '1.25' } as const
const IMAGE_RADIUS = {
  theme: 'var(--radius)',
  arch: '999px 999px var(--radius) var(--radius)',
  organic: '42% 58% 46% 54% / 38% 44% 56% 62%',
} as const

/** Tiled SVG motifs drawn in the accent colour at low opacity (no external assets). */
function patternUrl(pattern: SiteTheme['pattern'], color: string): string {
  if (pattern === 'none') return 'none'
  const c = color
  const svg = {
    // Teak fretwork: a diamond lattice with small joints.
    lattice: `<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'><path d='M22 0L44 22L22 44L0 22Z' fill='none' stroke='${c}' stroke-opacity='.12'/><circle cx='22' cy='22' r='2' fill='${c}' fill-opacity='.12'/></svg>`,
    // Eight-point star (khatam) tiling.
    arabesque: `<svg xmlns='http://www.w3.org/2000/svg' width='56' height='56'><g fill='none' stroke='${c}' stroke-opacity='.13'><rect x='16' y='16' width='24' height='24'/><rect x='16' y='16' width='24' height='24' transform='rotate(45 28 28)'/><circle cx='0' cy='0' r='6'/><circle cx='56' cy='56' r='6'/><circle cx='56' cy='0' r='6'/><circle cx='0' cy='56' r='6'/></g></svg>`,
    // Loose leaf sprigs.
    leaf: `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><g fill='${c}' fill-opacity='.08'><path d='M14 30c8-14 22-16 30-14-4 10-16 20-30 14z'/><path d='M50 66c6-10 16-12 22-10-3 8-12 14-22 10z'/></g></svg>`,
  }[pattern]
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/**
 * Theme → CSS variables on the site root. The app's semantic tokens (--bg, --fg, --accent…) are overridden too,
 * so the shared token utilities (bg-bg, text-muted, bg-accent…) follow the tenant's palette inside the site.
 */
export function themeVars(theme: SiteTheme): CSSProperties {
  return {
    '--bg': theme.bg,
    '--surface': theme.surface,
    '--subtle': theme.subtle,
    '--border': theme.border,
    '--fg': theme.fg,
    '--muted': theme.muted,
    '--accent': theme.accent,
    '--accent-fg': theme.accentFg,
    '--accent-soft': theme.accentSoft,
    '--brand': theme.accent,
    '--brand-fg': theme.accentFg,
    '--inverse-bg': theme.inverseBg,
    '--inverse-fg': theme.inverseFg,
    '--font-heading':
      theme.headingFace && theme.headingFace !== 'theme'
        ? `${HEADING_FACES[theme.headingFace]}, ${FONT_STACKS[theme.headingFont]}`
        : FONT_STACKS[theme.headingFont],
    '--font-body': FONT_STACKS[theme.bodyFont],
    '--heading-weight': String(theme.headingWeight),
    '--heading-case': theme.headingCase,
    '--heading-tracking': `${theme.headingTracking}em`,
    '--radius': RADIUS[theme.radius],
    '--radius-btn': BUTTON_RADIUS[theme.buttonShape],
    '--density': DENSITY[theme.density],
    '--font-heading-ar': ARABIC_STACKS[theme.arabicFont],
    '--pattern': patternUrl(theme.pattern, theme.accent),
    '--img-radius': IMAGE_RADIUS[theme.imageShape],
  } as CSSProperties
}
