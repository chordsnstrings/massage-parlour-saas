import { enumLabel } from '@spa/core/i18n'
import type { AgendaItem } from '@spa/services'
import { Pill, statusTone, TName } from '@/components/crm'
import { Bar } from '@/components/kpis/bar'
import { getI18n } from '@/i18n/server'
import { cn } from '@/lib/utils'

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || null

/** Ranked rows with a hairline proportion bar under each. `display` is the preformatted value (fmt / t). */
export function RankedList({
  rows,
}: {
  rows: { key: string; label: string; value: number; display: string; color?: string }[]
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ol className="space-y-3.5">
      {rows.map((r, i) => (
        <li key={r.key} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="crm-muted w-4 shrink-0 text-xs tabular">{i + 1}</span>
              {r.color && (
                <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
              )}
              <span className="truncate">{r.label}</span>
            </span>
            <span className="shrink-0 font-medium tabular">{r.display}</span>
          </div>
          <div className="ms-6">
            <Bar pct={(r.value / max) * 100} delay={i * 0.06} />
          </div>
        </li>
      ))}
    </ol>
  )
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`

/**
 * Weekday × hour heatmap. Hours run from the business-day cutoff (late-night shops read left to right)
 * and are trimmed to the span that has bookings, never narrower than 10:00–22:00.
 */
export async function PeakHeatmap({ heatmap, cutoffHour = 5 }: { heatmap: number[][]; cutoffHour?: number }) {
  const { t } = await getI18n()
  const day = (d: number) => t(`overview.peak.days.${DAY_KEYS[d]!}`)
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
        style={{ gridTemplateColumns: `2.5rem repeat(${hours.length}, minmax(0, 1fr))` }}
      >
        {days.map((d) => (
          <div key={d} className="contents">
            <span className="crm-muted self-center text-xs">{day(d)}</span>
            {hours.map((h) => {
              const n = heatmap[d]?.[h] ?? 0
              return (
                <span
                  key={h}
                  title={t('overview.peak.cell', { day: day(d), hour: hh(h), count: n })}
                  className={cn('h-3 rounded-[3px] sm:h-5', n ? 'bg-accent' : 'bg-subtle')}
                  style={n ? { opacity: 0.18 + (0.82 * n) / max } : undefined}
                />
              )
            })}
          </div>
        ))}
        <span />
        {hours.map((h, i) => (
          <span key={h} className="crm-muted text-center text-[10px] tabular">
            {i % 3 === 0 ? String(h).padStart(2, '0') : ''}
          </span>
        ))}
      </div>
      <p className="crm-muted text-sm">
        {peak.n ? (
          <>
            {t('overview.peak.busiest')}{' '}
            <span className="text-fg">{`${day(peak.d)} ${hh(peak.h)}`}</span> ·{' '}
            {t('overview.peak.busiestCount', { count: peak.n })}
          </>
        ) : (
          t('overview.peak.empty')
        )}
      </p>
    </div>
  )
}

/**
 * Up-next table (crm-spec §5.1 "Priority bookings"): client first name only — no surnames or phone numbers on the
 * dashboard. `tomorrow` marks rows from the next business date.
 */
export async function UpNextTable({ items }: { items: (AgendaItem & { tomorrow?: boolean })[] }) {
  const { t, fmt } = await getI18n()
  const h = {
    client: t('overview.upNext.client'),
    service: t('overview.upNext.service'),
    therapist: t('overview.upNext.therapist'),
    when: t('overview.upNext.when'),
    status: t('overview.upNext.status'),
  }
  return (
    <div className="crm-tbl-wrap">
      <table className="crm-tbl" data-stack="true">
        <thead>
          <tr>
            <th>{h.client}</th>
            <th>{h.service}</th>
            <th>{h.therapist}</th>
            <th>{h.when}</th>
            <th>{h.status}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const name = firstName(it.clientName) ?? t('overview.upNext.walkIn')
            const time = fmt.time(it.startsAt)
            return (
              <tr key={it.itemId}>
                <td data-label={h.client}>
                  <TName name={name} />
                </td>
                <td data-label={h.service} className="crm-muted">
                  {t('overview.upNext.serviceLine', { service: it.serviceName, min: it.durationMin })}
                </td>
                <td data-label={h.therapist} className="crm-muted">
                  {it.therapists.join(' & ') || '—'}
                </td>
                <td data-label={h.when} className="crm-num-c crm-muted">
                  {t(it.tomorrow ? 'overview.upNext.tomorrow' : 'overview.upNext.today', { time })}
                </td>
                <td data-label={h.status}>
                  <Pill tone={statusTone(it.status)} dot>
                    {enumLabel(t, 'bookingStatus', it.status)}
                  </Pill>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Time-ordered agenda rows for a therapist's own day (client first name only). */
export async function AgendaList({ items }: { items: AgendaItem[] }) {
  const { t, fmt } = await getI18n()
  return (
    <ul className="divide-y">
      {items.map((it) => (
        <li key={it.itemId} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
          <div className="w-12 shrink-0">
            <p className="text-sm font-semibold tabular">{fmt.time(it.startsAt)}</p>
            <p className="crm-muted text-xs tabular">
              {t('overview.therapist.minutes', { min: it.durationMin })}
            </p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {firstName(it.clientName) ?? t('overview.therapist.walkIn')}
            </p>
            <p className="crm-muted truncate text-xs">
              {[it.serviceName, it.roomName].filter(Boolean).join(' · ')}
            </p>
          </div>
          {it.status !== 'confirmed' && (
            <Pill tone={statusTone(it.status)} className="shrink-0">
              {enumLabel(t, 'bookingStatus', it.status)}
            </Pill>
          )}
        </li>
      ))}
    </ul>
  )
}
