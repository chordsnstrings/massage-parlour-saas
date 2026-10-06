import type { AgendaItem } from '@spa/services'
import { Bar } from '@/components/kpis/bar'
import { Badge, statusTone } from '@/components/ui/badge'
import { NumberTicker } from '@/components/ui/motion'
import { cn, formatAed } from '@/lib/utils'

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Dubai',
})
export const formatTime = (d: Date) => timeFmt.format(d)
const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || 'Walk-in'
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  in_service: 'In service',
}

/** Compact secondary metrics: two columns on phones, four from tablet up. */
export function MetricStrip({
  items,
}: {
  items: { label: string; value: number; format?: 'aed' | 'int' | 'pct'; hint?: string; empty?: boolean }[]
}) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-4">
      {items.map((m) => (
        <div key={m.label} className="bg-surface px-5 py-4 sm:px-6 sm:py-5">
          <dt className="text-xs font-medium text-muted">{m.label}</dt>
          <dd className="mt-1.5 text-lg font-semibold tracking-tight">
            {m.empty ? (
              <span className="text-muted">—</span>
            ) : (
              <NumberTicker value={m.value} format={m.format} />
            )}
          </dd>
          {m.hint && <dd className="mt-0.5 truncate text-xs text-muted">{m.hint}</dd>}
        </div>
      ))}
    </dl>
  )
}

/** Ranked rows with a hairline proportion bar under each. */
export function RankedList({
  rows,
  money,
  unit,
}: {
  rows: { key: string; label: string; value: number; sub?: string; color?: string }[]
  money: boolean
  unit?: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ol className="space-y-4">
      {rows.map((r, i) => (
        <li key={r.key} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="w-4 shrink-0 text-xs text-muted tabular">{i + 1}</span>
              {r.color && (
                <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
              )}
              <span className="truncate">{r.label}</span>
            </span>
            <span className="shrink-0 font-medium tabular">
              {money ? formatAed(r.value) : `${r.value.toLocaleString('en-AE')}${unit ? ` ${unit}` : ''}`}
            </span>
          </div>
          <div className="ms-6">
            <Bar pct={(r.value / max) * 100} delay={i * 0.06} />
          </div>
          {r.sub && <p className="ms-6 text-xs text-muted">{r.sub}</p>}
        </li>
      ))}
    </ol>
  )
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`

/**
 * Weekday × hour heatmap. Hours run from the business-day cutoff (late-night shops read left to right)
 * and are trimmed to the span that has bookings, never narrower than 10:00–22:00.
 */
export function PeakHeatmap({ heatmap, cutoffHour = 5 }: { heatmap: number[][]; cutoffHour?: number }) {
  const order = Array.from({ length: 24 }, (_, i) => (cutoffHour + i) % 24)
  const busy = order.map((h) => heatmap.some((row) => (row[h] ?? 0) > 0))
  const lo = Math.min(order.indexOf(10), busy.indexOf(true) === -1 ? 99 : busy.indexOf(true))
  const hi = Math.max(order.indexOf(22), busy.lastIndexOf(true))
  const hours = order.slice(lo, hi + 1)
  const max = Math.max(1, ...heatmap.flat())
  let peak = { d: -1, h: -1, n: 0 }
  for (const [d, row] of heatmap.entries()) {
    for (const [h, n] of row.entries()) if (n > peak.n) peak = { d, h, n }
  }
  // Week starts on Monday in the UAE work calendar.
  const days = [1, 2, 3, 4, 5, 6, 0]

  return (
    <div className="space-y-4">
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `2.25rem repeat(${hours.length}, minmax(0, 1fr))` }}
      >
        {days.map((d) => (
          <div key={d} className="contents">
            <span className="self-center text-[11px] text-muted">{DAYS[d]}</span>
            {hours.map((h) => {
              const n = heatmap[d]?.[h] ?? 0
              return (
                <span
                  key={h}
                  title={`${DAYS[d]} ${hh(h)} · ${n} booking${n === 1 ? '' : 's'}`}
                  className={cn('h-3 rounded-[3px] sm:h-5', n ? 'bg-accent' : 'bg-subtle')}
                  style={n ? { opacity: 0.18 + (0.82 * n) / max } : undefined}
                />
              )
            })}
          </div>
        ))}
        <span />
        {hours.map((h, i) => (
          <span key={h} className="text-center text-[10px] text-muted tabular">
            {i % 3 === 0 ? String(h).padStart(2, '0') : ''}
          </span>
        ))}
      </div>
      <p className="text-sm text-muted">
        {peak.n ? (
          <>
            Busiest: <span className="text-fg">{`${DAYS[peak.d]} ${hh(peak.h)}`}</span> · {peak.n} booking
            {peak.n === 1 ? '' : 's'}
          </>
        ) : (
          'Peak hours appear once bookings come in.'
        )}
      </p>
    </div>
  )
}

/** Time-ordered agenda rows (client first name only — no phone numbers on the dashboard). */
export function AgendaList({
  items,
  showTherapist = true,
}: {
  items: AgendaItem[]
  showTherapist?: boolean
}) {
  return (
    <ul className="divide-y">
      {items.map((it) => (
        <li key={it.itemId} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
          <div className="w-12 shrink-0">
            <p className="text-sm font-semibold tabular">{formatTime(it.startsAt)}</p>
            <p className="text-xs text-muted tabular">{it.durationMin}m</p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{firstName(it.clientName)}</p>
            <p className="truncate text-xs text-muted">
              {[it.serviceName, showTherapist ? it.therapists.join(' & ') : it.roomName]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {it.status !== 'confirmed' && (
            <Badge tone={statusTone(it.status)} className="shrink-0">
              {STATUS_LABEL[it.status] ?? it.status}
            </Badge>
          )}
        </li>
      ))}
    </ul>
  )
}
