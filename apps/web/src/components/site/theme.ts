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
}

/** Latin + Arabic-capable stacks (system fonts; Inter is already self-hosted by the app). */
export const FONT_STACKS = {
  sans: '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans Arabic", "Geeza Pro", Tahoma, sans-serif',
  serif:
    '"Cormorant Garamond", "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Noto Naskh Arabic", "Amiri", "Times New Roman", serif',
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
  }
}

const RADIUS = { none: '0px', soft: '12px', round: '22px' } as const
const BUTTON_RADIUS = { square: '0px', rounded: '10px', pill: '999px' } as const
const DENSITY = { compact: '0.75', comfortable: '1', airy: '1.25' } as const

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
    '--font-heading': FONT_STACKS[theme.headingFont],
    '--font-body': FONT_STACKS[theme.bodyFont],
    '--heading-weight': String(theme.headingWeight),
    '--heading-case': theme.headingCase,
    '--heading-tracking': `${theme.headingTracking}em`,
    '--radius': RADIUS[theme.radius],
    '--radius-btn': BUTTON_RADIUS[theme.buttonShape],
    '--density': DENSITY[theme.density],
  } as CSSProperties
}
