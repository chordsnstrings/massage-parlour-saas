import { performanceRange } from '@spa/services'
import { ChartColumn } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/table'
import { adminPath } from '@/lib/paths'
import { formatAed, formatDate, todayDubai } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { allSpaPerformance, type SpaPerformance } from './data'
import { pct, RangePicker, sourceLabel } from './kit'

export const metadata: Metadata = { title: 'Performance' }

const SORTS = {
  name: (a: SpaPerformance, b: SpaPerformance) => a.name.localeCompare(b.name),
  revenue: (a: SpaPerformance, b: SpaPerformance) => b.revenue - a.revenue,
  bookings: (a: SpaPerformance, b: SpaPerformance) => b.bookings - a.bookings,
  clients: (a: SpaPerformance, b: SpaPerformance) => b.newClients - a.newClients,
  visits: (a: SpaPerformance, b: SpaPerformance) => b.visits - a.visits,
  conversion: (a: SpaPerformance, b: SpaPerformance) => (b.conversion ?? -1) - (a.conversion ?? -1),
} as const
type SortKey = keyof typeof SORTS

const num = 'text-right tabular-nums'

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; sort?: string }>
}) {
  await requirePlatformAdmin()
  const sp = await searchParams
  const range = performanceRange(sp.range, todayDubai())
  const sort: SortKey = sp.sort && sp.sort in SORTS ? (sp.sort as SortKey) : 'revenue'
  const rows = (await allSpaPerformance(range)).sort(SORTS[sort])
  const href = (q: { range?: string; sort?: string }) =>
    `${adminPath('/performance')}?${new URLSearchParams({ range: q.range ?? range.key, sort: q.sort ?? sort })}`
  const head = (key: SortKey, label: string) => (
    <Link
      href={href({ sort: key })}
      aria-current={sort === key ? 'true' : undefined}
      className={sort === key ? 'text-fg underline underline-offset-4' : 'hover:text-fg'}
    >
      {label}
    </Link>
  )
  const total = rows.reduce(
    (a, r) => ({
      revenue: a.revenue + r.revenue,
      bookings: a.bookings + r.bookings,
      visits: a.visits + r.visits,
      booked: a.booked + r.bookedSessions,
    }),
    { revenue: 0, bookings: 0, visits: 0, booked: 0 },
  )

  return (
    <>
      <PageHeader
        title="Performance"
        description={`Every spa, ${formatDate(`${range.from}T12:00:00Z`)} – ${formatDate(`${range.to}T12:00:00Z`)} (business dates). Aggregates only.`}
        actions={<RangePicker range={range} href={(key) => href({ range: key })} />}
      />
      <PageBody>
        <Stagger className="grid grid-cols-2 gap-[var(--ui-grid-gap,1rem)] lg:grid-cols-4">
          <StaggerItem>
            <StatCard label="Revenue, net" value={total.revenue} format="aed" hint="After refunds" />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Bookings" value={total.bookings} format="int" />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Website visits" value={total.visits} format="int" />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Online conversion"
              value={total.visits ? Math.round((total.booked / total.visits) * 1000) / 10 : 0}
              format="pct"
              hint="Visits that booked"
            />
          </StaggerItem>
        </Stagger>
        <Card>
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            empty={<EmptyState icon={<ChartColumn className="size-5" />} title="No spas yet" />}
            columns={[
              {
                key: 'name',
                header: head('name', 'Spa'),
                primary: true,
                cell: (r) => (
                  <Link
                    href={`${adminPath(`/performance/${r.id}`)}?range=${range.key}`}
                    className="group"
                    data-testid={`perf-${r.slug}`}
                  >
                    <span className="block font-medium group-hover:text-accent">{r.name}</span>
                    <span className="block text-xs text-muted">{r.slug}</span>
                  </Link>
                ),
              },
              {
                key: 'revenue',
                header: head('revenue', 'Revenue'),
                className: num,
                cell: (r) => formatAed(r.revenue),
              },
              {
                key: 'bookings',
                header: head('bookings', 'Bookings'),
                className: num,
                cell: (r) => (
                  <span data-testid="perf-bookings">
                    <span className="block">{r.bookings.toLocaleString('en')}</span>
                    <span className="block text-xs text-muted">
                      {r.completed} done · {r.cancelled + r.noShow} cxl/no-show
                    </span>
                  </span>
                ),
              },
              {
                key: 'clients',
                header: head('clients', 'New clients'),
                className: num,
                cell: (r) => r.newClients,
              },
              {
                key: 'visits',
                header: head('visits', 'Visits'),
                className: num,
                cell: (r) => r.visits.toLocaleString('en'),
              },
              {
                key: 'conversion',
                header: head('conversion', 'Conv.'),
                className: num,
                cell: (r) => pct(r.conversion),
              },
              {
                key: 'sources',
                header: 'Top sources',
                hideOnMobile: true,
                cell: (r) =>
                  r.bookingSources.length ? (
                    <span className="text-[13px] text-muted">
                      {r.bookingSources
                        .slice(0, 3)
                        .map((s) => `${sourceLabel(s.source)} ${s.count}`)
                        .join(' · ')}
                    </span>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'ai',
                header: 'AI (month)',
                className: num,
                hideOnMobile: true,
                cell: (r) => (
                  <span className={r.aiSpendUsd >= r.aiBudgetUsd ? 'text-danger' : undefined}>
                    ${r.aiSpendUsd.toFixed(2)}
                    <span className="text-muted"> / ${r.aiBudgetUsd.toFixed(0)}</span>
                  </span>
                ),
              },
            ]}
          />
        </Card>
      </PageBody>
    </>
  )
}
