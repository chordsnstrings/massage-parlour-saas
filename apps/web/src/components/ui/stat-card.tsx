import { Card } from './card'
import { NumberTicker } from './motion'

export function StatCard({
  label,
  value,
  format,
  hint,
}: {
  label: string
  value: number
  format?: 'aed' | 'int' | 'pct'
  hint?: string
}) {
  return (
    <Card className="h-full p-[var(--ui-stat-pad,1.25rem)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-soft sm:p-[var(--ui-stat-pad-sm,1.5rem)]">
      <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">{label}</p>
      <p className="mt-3 text-[length:var(--ui-stat-fs,26px)] font-semibold tracking-tight">
        <NumberTicker value={value} format={format} />
      </p>
      {hint && <p className="mt-1 text-[13px] text-muted">{hint}</p>}
    </Card>
  )
}
