import { cn } from '@/lib/utils'

/** Platform brand (spamanagement.co) — owner "Continuum" wordmark, public/brand/spamanagement-wordmark.svg. Not for spa dashboards. */
const FONT = '"Inter Variable", "Helvetica Neue", Arial, sans-serif'
const DOT = '#F04B2F'

type Tone = 'auto' | 'dark' | 'light'
// auto: ink follows currentColor (works on light and dark pages); "management" is a step lighter, as in the file.
const TONES: Record<Tone, { ink: string; soft: string; softOpacity: number }> = {
  auto: { ink: 'currentColor', soft: 'currentColor', softOpacity: 0.82 },
  dark: { ink: '#17181A', soft: '#333438', softOpacity: 1 },
  light: { ink: '#F7F3EA', soft: '#F7F3EA', softOpacity: 0.82 },
}

/** "Continuum" wordmark, viewBox cropped to the ink (the source file pads to 3.8:1); size by height, e.g. `h-6`. */
export function Logo({ className, tone = 'auto' }: { className?: string; tone?: Tone }) {
  const t = TONES[tone]
  return (
    <svg
      viewBox="64 118 1476 206"
      role="img"
      aria-label="spamanagement.co"
      className={cn('h-6 w-auto shrink-0', className)}
    >
      <g fontFamily={FONT}>
        <text
          x="80"
          y="255"
          fontSize="158"
          fontWeight="600"
          letterSpacing="-7"
          fill={t.ink}
          textLength="320"
          lengthAdjust="spacingAndGlyphs"
        >
          spa
        </text>
        <text
          x="420"
          y="255"
          fontSize="158"
          fontWeight="400"
          letterSpacing="-6"
          fill={t.soft}
          fillOpacity={t.softOpacity}
          textLength="870"
          lengthAdjust="spacingAndGlyphs"
        >
          management
        </text>
        <text x="1330" y="255" fontSize="158" fontWeight="500" letterSpacing="-5" fill={t.ink}>
          co
        </text>
      </g>
      <path d="M86 302 H1282" stroke={t.ink} strokeWidth="5" strokeLinecap="round" />
      <circle cx="1308" cy="229" r="13" fill={DOT} />
      <circle cx="1308" cy="302" r="8" fill={DOT} />
    </svg>
  )
}

/** Compact square mark ("s" + orange dot) for favicon-size spots; same art as public/icon.svg. */
export function LogoMark({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  const [bg, ink] = tone === 'dark' ? ['#18191B', '#F7F3EA'] : ['#F7F3EA', '#18191B']
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7 shrink-0', className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill={bg} />
      <text x="7.2" y="21" fill={ink} fontFamily={FONT} fontWeight="600" fontSize="21" letterSpacing="-1">
        s
      </text>
      <path d="M8 25.2 H19.5" stroke={ink} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="22" cy="19" r="2.1" fill={DOT} />
      <circle cx="22" cy="25.2" r="1.4" fill={DOT} />
    </svg>
  )
}
