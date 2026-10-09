import { cn } from '@/lib/utils'

/** Platform brand (spamanagement.co) — owner "SM" badge logo, public/brand/spamanagement-logo.svg. In spa dashboards
 *  only as the small platform badge at the sidebar foot (SpaShell, PLAN §18.6). */
const FONT = '"Helvetica Neue", Arial, "Inter Variable", sans-serif'
const LIME = '#D9F26A'
const INK = '#17181A'
const CREAM = '#F7F3EA'

type Tone = 'auto' | 'dark' | 'light'
// auto: "Spa Management" follows currentColor (light and dark pages); the badge keeps its lime + ink colours.
const TEXT: Record<Tone, string> = { auto: 'currentColor', dark: INK, light: CREAM }

function Badge() {
  return (
    <>
      <rect x="76" y="62" width="332" height="332" rx="88" fill={LIME} transform="rotate(-7 242 228)" />
      <text
        x="101"
        y="287"
        fill={INK}
        fontFamily={FONT}
        fontSize="198"
        fontStyle="italic"
        fontWeight="700"
        letterSpacing="-32"
        textLength="290"
        lengthAdjust="spacingAndGlyphs"
      >
        SM
      </text>
      <path d="M116 327h244" stroke={CREAM} strokeWidth="18" strokeLinecap="round" />
    </>
  )
}

/** Badge + two-line "Spa Management", viewBox cropped to the ink; size by height, e.g. `h-10`. */
export function Logo({ className, tone = 'auto' }: { className?: string; tone?: Tone }) {
  return (
    <svg
      viewBox="50 36 1205 384"
      role="img"
      aria-label="Spa Management"
      className={cn('h-10 w-auto shrink-0', className)}
    >
      <Badge />
      <g fill={TEXT[tone]} fontFamily={FONT} fontWeight="700">
        <text x="470" y="205" fontSize="132" letterSpacing="-5">
          Spa
        </text>
        <text
          x="470"
          y="347"
          fontSize="132"
          letterSpacing="-6"
          textLength="775"
          lengthAdjust="spacingAndGlyphs"
        >
          Management
        </text>
      </g>
    </svg>
  )
}

/** The "SM" badge alone for favicon-size spots; same art as public/icon.svg. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="50 36 384 384" className={cn('size-7 shrink-0', className)} aria-hidden="true">
      <Badge />
    </svg>
  )
}
