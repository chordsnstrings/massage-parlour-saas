import { cn } from '@/lib/utils'

const pct = (value: number, max: number) =>
  `${Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0))}%`

/**
 * Progress bar / meter (`.bar`). `value` of `max` (default 1). `label` names it for screen readers and, with
 * `showLabel`, renders above with `valueText` (preformatted, e.g. fmt.percent(0.62) or "12 / 20").
 */
export function Meter({
  value,
  max = 1,
  label,
  valueText,
  showLabel,
  tone,
  className,
}: {
  value: number
  max?: number
  label: string
  valueText?: string
  showLabel?: boolean
  tone?: 'ok' | 'warn' | 'bad'
  className?: string
}) {
  return (
    <div className={className}>
      {showLabel && (
        <div className="crm-meter-h">
          <span>{label}</span>
          {valueText && <span>{valueText}</span>}
        </div>
      )}
      <div
        className="crm-bar"
        data-tone={tone}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
      >
        <i style={{ width: pct(value, max) }} />
      </div>
    </div>
  )
}

export type BarDatum = { label: string; value: number; hi?: boolean; title?: string }

/**
 * Simple CSS bar chart (`.barchart`) — month revenue, sources… `label` is the chart's accessible name; each bar's
 * `title` (preformatted value) shows on hover and is read out. For richer charts use the chart lib (PLAN §12.5).
 */
export function BarChart({
  data,
  label,
  max,
  height,
  className,
}: {
  data: BarDatum[]
  label: string
  max?: number
  height?: number
  className?: string
}) {
  const top = max ?? Math.max(0, ...data.map((d) => d.value))
  return (
    <div
      className={cn('crm-barchart', className)}
      role="img"
      aria-label={label}
      style={height ? { height } : undefined}
    >
      {data.map((d) => (
        <div key={d.label} className="crm-bc" data-hi={d.hi || undefined} title={d.title}>
          <i style={{ height: pct(d.value, top) }} />
          <span>{d.label}</span>
        </div>
      ))}
    </div>
  )
}

export type LegendItem = { label: React.ReactNode; value?: React.ReactNode; color?: string }

/** Colour legend (`.legend`): swatch, label, end-aligned value. */
export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={cn('crm-legend', className)}>
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable list
        <li key={i} className="crm-lg">
          <span className="crm-sw" style={item.color ? { background: item.color } : undefined} aria-hidden />
          <span>{item.label}</span>
          {item.value !== undefined && <span className="crm-lv">{item.value}</span>}
        </li>
      ))}
    </ul>
  )
}

/** Journey segmented bar (`.segbar`): one coloured segment per stage, width ∝ value. Pair with <Legend>. */
export function SegBar({
  items,
  label,
  className,
}: {
  items: { value: number; color: string; title?: string }[]
  label: string
  className?: string
}) {
  return (
    <div className={cn('crm-segbar', className)} role="img" aria-label={label}>
      {items.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable list
        <i key={i} title={s.title} style={{ flexGrow: Math.max(s.value, 0), background: s.color }} />
      ))}
    </div>
  )
}

/** Stage colours for SegBar/Legend/charts, in design order. */
export const CHART_COLOURS = [
  'var(--crm-accent)',
  'var(--crm-tint3)',
  'var(--crm-tint1)',
  'var(--crm-green)',
  'var(--crm-amber)',
  'var(--crm-orange)',
  'var(--crm-violet)',
] as const
