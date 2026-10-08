import { cn } from '@/lib/utils'

/** Platform brand (spamanagement.co) — owner wordmark, public/brand/spamanagement-wordmark.svg. Not for spa dashboards. */
const FONT = '"Inter Variable", "Helvetica Neue", Arial, sans-serif'
const DOT = '#F04B2F'

type Tone = 'auto' | 'dark' | 'light'
// auto: text follows currentColor, wave cut-out matches the page background token.
const TONES: Record<Tone, { ink: string; cut: string }> = {
  auto: { ink: 'currentColor', cut: 'var(--brand-cut, var(--bg, #F7F3EA))' },
  dark: { ink: '#18191B', cut: 'var(--brand-cut, #F7F3EA)' },
  light: { ink: '#F7F3EA', cut: 'var(--brand-cut, #18191B)' },
}

/** Full wordmark, viewBox cropped to the ink (≈ 7.7:1, the source file pads to 3.8:1); size by height, e.g. `h-6`. */
export function Logo({ className, tone = 'auto' }: { className?: string; tone?: Tone }) {
  const t = TONES[tone]
  return (
    <svg
      viewBox="64 132 1476 192"
      role="img"
      aria-label="spamanagement.co"
      className={cn('h-6 w-auto shrink-0', className)}
    >
      <g fill={t.ink} fontFamily={FONT} fontWeight="500">
        <text
          x="80"
          y="270"
          fontSize="168"
          letterSpacing="-8"
          textLength="1220"
          lengthAdjust="spacingAndGlyphs"
        >
          spamanagement
        </text>
        <text x="1330" y="270" fontSize="168" letterSpacing="-7">
          co
        </text>
      </g>
      <circle cx="1308" cy="244" r="14" fill={DOT} />
      <path
        d="M286 218 C316 178 344 178 374 218 C404 258 432 258 462 218"
        fill="none"
        stroke={t.cut}
        strokeWidth="12"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Compact square mark ("s" + orange dot) for favicon-size spots; same art as public/icon.svg. */
export function LogoMark({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  const [bg, ink] = tone === 'dark' ? ['#18191B', '#F7F3EA'] : ['#F7F3EA', '#18191B']
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7 shrink-0', className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill={bg} />
      <text x="7.2" y="23" fill={ink} fontFamily={FONT} fontWeight="500" fontSize="22" letterSpacing="-1">
        s
      </text>
      <circle cx="21.5" cy="20.6" r="2.4" fill={DOT} />
    </svg>
  )
}
