import { PERFORMANCE_RANGES, type PerformanceRange } from '@spa/services'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/** Labels for booking channels, web entry sources (?src= tags from QR codes, Instagram bio, GBP) and online bookings'
 * website sources (bookings.attribution, F13). */
const SOURCE_LABELS: Record<string, string> = {
  walk_in: 'Walk-in',
  online: 'Online',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  phone: 'Staff / phone',
  ai_agent: 'AI agent',
  gbp: 'Google Business',
  ig: 'Instagram',
  qr: 'QR code',
  google: 'Google',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  direct: 'Direct',
  widget: 'Booking widget',
  campaign: 'Campaign link',
  referral: 'Other websites',
  unknown: 'Not recorded',
}
export const sourceLabel = (key: string) => SOURCE_LABELS[key] ?? key

export const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 1000) / 10}%`)

/** Period picker: plain links (server-rendered, keeps other query params). */
export function RangePicker({ range, href }: { range: PerformanceRange; href: (key: string) => string }) {
  return (
    <nav aria-label="Period" className="flex flex-wrap gap-1 rounded-full border bg-surface p-1">
      {PERFORMANCE_RANGES.map((r) => (
        <Link
          key={r.key}
          href={href(r.key)}
          aria-current={r.key === range.key ? 'page' : undefined}
          className={cn(
            'rounded-full px-3 py-1.5 text-[13px] transition-colors',
            r.key === range.key ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-subtle hover:text-fg',
          )}
        >
          {r.label}
        </Link>
      ))}
    </nav>
  )
}

/**
 * Single-series bar chart (server-rendered SVG). Each bar carries a native tooltip (<title>); the page shows the
 * same numbers in a table, so the chart is never the only way to read them.
 */
export function BarChart({
  points,
  label,
  format,
}: {
  points: { label: string; value: number }[]
  label: string
  format: (v: number) => string
}) {
  const W = 600
  const H = 140
  const max = Math.max(1, ...points.map((p) => p.value))
  const slot = W / Math.max(1, points.length)
  const bw = Math.max(2, slot - 2)
  const total = points.reduce((a, p) => a + p.value, 0)
  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-32 w-full"
        role="img"
        aria-label={label}
      >
        <line
          x1={0}
          x2={W}
          y1={H - 0.5}
          y2={H - 0.5}
          stroke="var(--color-border)"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => {
          const h = p.value > 0 ? Math.max(2, (p.value / max) * (H - 6)) : 0
          return (
            <g key={p.label}>
              <title>{`${p.label}: ${format(p.value)}`}</title>
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              {h > 0 && (
                <rect
                  x={i * slot + (slot - bw) / 2}
                  y={H - h}
                  width={bw}
                  height={h}
                  rx={Math.min(4, bw / 2)}
                  fill="var(--color-accent)"
                  fillOpacity={0.75}
                />
              )}
            </g>
          )
        })}
      </svg>
      {points.length > 1 && (
        <figcaption className="flex justify-between text-xs text-muted">
          <span>{points[0]!.label}</span>
          <span className="tabular-nums">Total {format(total)}</span>
          <span>{points.at(-1)!.label}</span>
        </figcaption>
      )}
    </figure>
  )
}

/** Horizontal proportion rows (sources, funnel steps). */
export function ShareList({
  rows,
  empty = 'No data in this period',
}: {
  rows: { label: string; value: number; note?: string }[]
  empty?: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>{r.label}</span>
            <span className="tabular-nums">
              {r.value.toLocaleString('en')}
              {r.note && <span className="ms-2 text-xs text-muted">{r.note}</span>}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-accent/70"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
