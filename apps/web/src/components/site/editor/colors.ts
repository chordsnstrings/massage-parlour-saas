import type { PreflightColors } from '@spa/services/site-kit'
import type { SiteTheme } from '../theme'

/** The theme tokens preflight's contrast check needs (same in the publish dialog and on the server). */
export const preflightColors = (t: SiteTheme): PreflightColors => ({
  bg: t.bg,
  surface: t.surface,
  subtle: t.subtle,
  fg: t.fg,
  accent: t.accent,
  accentFg: t.accentFg,
  accentSoft: t.accentSoft,
  inverseBg: t.inverseBg,
  inverseFg: t.inverseFg,
})

/** Most text one "Translate with AI" request takes; the publish sheet sends bigger jobs in batches. */
export const TRANSLATE_BATCH = { items: 15, chars: 6000 } as const
