import { platformDb, tenants, withTenant } from '@spa/db'
import { performanceRange, tenantPerformance, tenantPerformanceDetail, weeklySeries } from '@spa/services'
import { eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/table'
import { adminPath } from '@/lib/paths'
import { formatAed, formatDate, todayDubai } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { BarChart, pct, RangePicker, ShareList, sourceLabel } from '../kit'

export const metadata: Metadata = { title: 'Spa performance' }

const UUID = /^[0-9a-f-]{36}$/i
const num = 'text-right tabular-nums'
const day = (d: string) => formatDate(`${d}T12:00:00Z`)

export default async function SpaPerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ range?: string }>
}) {
  await requirePlatformAdmin()
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const [spa] = await platformDb()
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, aiBudgetUsd: tenants.aiBudgetUsd })
    .from(tenants)
    .where(eq(tenants.id, id))
  if (!spa) notFound()
  const range = performanceRange((await searchParams).range, todayDubai())
  const { p, d } = await withTenant(spa.id, async (tx) => ({
    p: await tenantPerformance(tx, range),
    d: await tenantPerformanceDetail(tx, range),
  }))
  const weekly = range.days > 31
  const series = weekly ? weeklySeries(d.daily) : d.daily
  const label = (date: string) => (weekly ? `Week of ${day(date)}` : day(date))
  const base = adminPath(`/performance/${spa.id}`)
  const activity = [
    ...d.posts.map((s) => ({ label: `${sourceLabel(s.source)} posts published`, value: s.count })),
    ...d.conversations.map((s) => ({ label: `${sourceLabel(s.source)} conversations`, value: s.count })),
    ...d.reviews.map((s) => ({ label: `${sourceLabel(s.source)} reviews`, value: s.count })),
  ]

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`${adminPath('/performance')}?range=${range.key}`} className="hover:text-fg">
            ← Performance
          </Link>
        }
        title={spa.name}
        description={`${day(range.from)} – ${day(range.to)} · aggregates only, no client records.`}
        actions={<RangePicker range={range} href={(key) => `${base}?range=${key}`} />}
      />
      <PageBody>
        <Stagger className="grid grid-cols-2 gap-[var(--ui-grid-gap,1rem)] lg:grid-cols-4">
          <StaggerItem>
            <StatCard
              label="Revenue, net"
              value={p.revenue}
              format="aed"
              hint={`${formatAed(p.grossSales)} sales − ${formatAed(p.refunds)} refunds`}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Bookings"
              value={p.bookings}
              format="int"
              hint={`${p.completed} completed · ${p.cancelled} cancelled · ${p.noShow} no-show`}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="New clients" value={p.newClients} format="int" />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="AI spend (month)"
              value={Math.round(p.aiSpendUsd)}
              format="int"
              hint={`USD ${p.aiSpendUsd.toFixed(2)} of ${Number(spa.aiBudgetUsd).toFixed(0)} budget`}
            />
          </StaggerItem>
        </Stagger>

        <div className="grid gap-[var(--ui-grid-gap,1rem)] lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Revenue"
              description={weekly ? 'Per week, net of refunds' : 'Per day, net of refunds'}
            />
            <CardBody>
              <BarChart
                label={`Revenue ${weekly ? 'per week' : 'per day'}`}
                points={series.map((s) => ({ label: label(s.date), value: Math.max(0, s.revenue) }))}
                format={formatAed}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Bookings"
              description={weekly ? 'Per week, excluding cancelled' : 'Per day, excluding cancelled'}
            />
            <CardBody>
              <BarChart
                label={`Bookings ${weekly ? 'per week' : 'per day'}`}
                points={series.map((s) => ({ label: label(s.date), value: s.bookings }))}
                format={(v) => v.toLocaleString('en')}
              />
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-[var(--ui-grid-gap,1rem)] lg:grid-cols-3">
          <Card>
            <CardHeader
              title="Booking funnel"
              description={`${pct(p.conversion)} of website visits booked online`}
            />
            <CardBody>
              <ShareList
                rows={[
                  { label: 'Website visits', value: p.visits },
                  {
                    label: 'Booking started',
                    value: p.bookingStarts,
                    note: pct(p.visits ? p.bookingStarts / p.visits : null),
                  },
                  { label: 'Booked online', value: p.bookedSessions, note: pct(p.conversion) },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Website sources"
              description="Visitors by entry source (?src= ig, gbp, qr or referrer)"
            />
            <CardBody>
              <ShareList
                rows={p.webSources.map((s) => ({
                  label: sourceLabel(s.source),
                  value: s.sessions,
                  note: s.booked ? `${s.booked} booked` : undefined,
                }))}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Booking channels" description="Non-cancelled bookings by source" />
            <CardBody>
              <ShareList
                rows={p.bookingSources.map((s) => ({ label: sourceLabel(s.source), value: s.count }))}
              />
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-[var(--ui-grid-gap,1rem)] lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Campaigns"
              description="WhatsApp campaigns queued in this period (14-day booking attribution)"
            />
            <DataTable
              rows={d.campaigns}
              rowKey={(c) => `${c.name}-${c.queuedAt}`}
              empty={<CardBody className="text-sm text-muted">No campaigns in this period</CardBody>}
              columns={[
                {
                  key: 'name',
                  header: 'Campaign',
                  primary: true,
                  cell: (c) => (
                    <span>
                      <span className="block font-medium">{c.name}</span>
                      <span className="block text-xs text-muted">
                        {c.queuedAt ? formatDate(c.queuedAt) : c.status}
                      </span>
                    </span>
                  ),
                },
                { key: 'reached', header: 'Reached', className: num, cell: (c) => c.reached },
                { key: 'clients', header: 'Booked clients', className: num, cell: (c) => c.bookedClients },
                { key: 'bookings', header: 'Bookings', className: num, cell: (c) => c.bookings },
              ]}
            />
          </Card>
          <Card>
            <CardHeader
              title="Social & reviews"
              description="Instagram / Google Business activity in this period"
            />
            <CardBody>
              <ShareList rows={activity} empty="No posts, conversations or reviews in this period" />
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title={weekly ? 'Weekly figures' : 'Daily figures'} />
          <DataTable
            rows={[...series].reverse()}
            rowKey={(s) => s.date}
            columns={[
              { key: 'date', header: weekly ? 'Week' : 'Date', primary: true, cell: (s) => label(s.date) },
              { key: 'revenue', header: 'Revenue', className: num, cell: (s) => formatAed(s.revenue) },
              { key: 'bookings', header: 'Bookings', className: num, cell: (s) => s.bookings },
              { key: 'visits', header: 'Visits', className: num, cell: (s) => s.visits },
            ]}
          />
        </Card>
      </PageBody>
    </>
  )
}
