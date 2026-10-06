import { withTenant } from '@spa/db'
import { sql } from 'drizzle-orm'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { type Column, DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { Bars } from './bars'

export const metadata: Metadata = { title: 'Website analytics' }

const RANGES = { '7': 7, '30': 30, '90': 90 } as const
type Row = { key: string; views: number; clicks: number; sessions: number; conversions: number }

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0)
const SOURCE_LABELS: Record<string, string> = {
  direct: 'Direct',
  google: 'Google search',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  gbp: 'Google Business Profile',
  referral: 'Other websites',
}

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ range?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'reports.view')) notFound()
  const { range: rangeParam } = await searchParams
  const days = RANGES[(rangeParam ?? '30') as keyof typeof RANGES] ?? 30
  const since = sql`(date_trunc('day', now() at time zone 'Asia/Dubai') - ${days - 1} * interval '1 day') at time zone 'Asia/Dubai'`
  const day = sql`to_char(ts at time zone 'Asia/Dubai', 'YYYY-MM-DD')`

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const q = async (query: ReturnType<typeof sql>) => (await tx.execute(query)).rows as unknown as Row[]
    const [totals] = await q(sql`select '' as key,
        count(*) filter (where type = 'pageview')::int as views,
        count(*) filter (where type = 'wa_click')::int as clicks,
        count(distinct session_hash)::int as sessions,
        count(*) filter (where type = 'booking_complete')::int as conversions
      from web_events where ts >= ${since}`)
    const daily =
      await q(sql`select ${day} as key, count(distinct session_hash)::int as sessions, 0 as views, 0 as clicks, 0 as conversions
      from web_events where ts >= ${since} group by 1 order by 1`)
    const funnel =
      await q(sql`select type as key, count(distinct session_hash)::int as sessions, 0 as views, 0 as clicks, 0 as conversions
      from web_events where ts >= ${since} and type in ('pageview', 'booking_start', 'booking_complete', 'wa_click') group by 1`)
    const pages = await q(sql`select path as key, count(*) filter (where type = 'pageview')::int as views,
        count(*) filter (where type in ('click', 'wa_click', 'ig_click', 'booking_start'))::int as clicks,
        count(distinct session_hash)::int as sessions, count(*) filter (where type = 'booking_complete')::int as conversions
      from web_events where ts >= ${since} group by 1 having count(*) filter (where type = 'pageview') > 0 order by 2 desc limit 12`)
    const sources =
      // Each visitor is attributed to the source of their first event of the day.
      await q(sql`with entry as (select distinct on (session_hash) session_hash, coalesce(source, 'direct') as src
          from web_events where ts >= ${since} order by session_hash, ts)
        select entry.src as key, count(*) filter (where e.type = 'pageview')::int as views,
          count(*) filter (where e.type in ('wa_click', 'ig_click'))::int as clicks, count(distinct e.session_hash)::int as sessions,
          count(distinct e.session_hash) filter (where e.type = 'booking_complete')::int as conversions
        from web_events e join entry using (session_hash) where e.ts >= ${since} group by 1 order by 4 desc limit 10`)
    const devices =
      await q(sql`select coalesce(device, 'desktop') as key, count(distinct session_hash)::int as sessions, 0 as views, 0 as clicks, 0 as conversions
      from web_events where ts >= ${since} group by 1 order by 2 desc`)
    const blocks =
      await q(sql`select block_id || '|' || coalesce(max(block_type), '') || '|' || min(path) as key,
        count(distinct session_hash) filter (where type = 'block_view')::int as views,
        count(*) filter (where type in ('click', 'wa_click', 'ig_click', 'booking_start'))::int as clicks,
        count(distinct session_hash)::int as sessions, 0 as conversions
      from web_events where ts >= ${since} and block_id is not null group by block_id order by 2 desc limit 15`)
    return { totals: totals!, daily, funnel, pages, sources, devices, blocks }
  })

  const byDay = new Map(data.daily.map((d) => [d.key, d.sessions]))
  const chart = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() + 4 * 3600_000 - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10)
    return { label: d.slice(5).replace('-', '/'), value: byDay.get(d) ?? 0 }
  })
  const f = Object.fromEntries(data.funnel.map((r) => [r.key, r.sessions])) as Record<string, number>
  const visitors = data.totals.sessions
  const deviceTotal = data.devices.reduce((a, d) => a + d.sessions, 0)
  const base = appPath(`/${ctx.tenant.slug}/analytics`)

  const pageCols: Column<Row>[] = [
    { key: 'path', header: 'Page', primary: true, cell: (r) => <span className="font-medium">{r.key}</span> },
    { key: 'views', header: 'Views', className: 'text-right tabular-nums', cell: (r) => r.views },
    { key: 'visitors', header: 'Visitors', className: 'text-right tabular-nums', cell: (r) => r.sessions },
    { key: 'clicks', header: 'Clicks', className: 'text-right tabular-nums', cell: (r) => r.clicks },
    { key: 'booked', header: 'Bookings', className: 'text-right tabular-nums', cell: (r) => r.conversions },
  ]
  const blockCols: Column<Row>[] = [
    {
      key: 'block',
      header: 'Section',
      primary: true,
      cell: (r) => {
        const [id, type, path] = r.key.split('|')
        return (
          <span className="flex flex-col">
            <span className="font-medium">{type || id}</span>
            <span className="text-xs text-muted">
              {path} · {id}
            </span>
          </span>
        )
      },
    },
    {
      key: 'seen',
      header: 'Seen by',
      className: 'text-right tabular-nums',
      cell: (r) => `${pct(r.views, visitors)}%`,
    },
    { key: 'clicks', header: 'Clicks', className: 'text-right tabular-nums', cell: (r) => r.clicks },
    {
      key: 'ctr',
      header: 'Click rate',
      className: 'text-right tabular-nums',
      cell: (r) => `${pct(r.clicks, r.views)}%`,
    },
  ]

  return (
    <>
      <PageHeader
        title="Website analytics"
        description="Cookieless and private: no personal data is stored, visitors are counted with a daily rotating hash."
        actions={
          <nav className="inline-flex rounded-full border bg-surface p-1 text-sm" aria-label="Date range">
            {Object.keys(RANGES).map((r) => (
              <Link
                key={r}
                href={`${base}?range=${r}`}
                aria-current={String(days) === r ? 'page' : undefined}
                className={cn(
                  'rounded-full px-3.5 py-1.5 transition-colors',
                  String(days) === r ? 'bg-fg text-bg' : 'text-muted hover:text-fg',
                )}
              >
                {r} days
              </Link>
            ))}
          </nav>
        }
      />
      <PageBody>
        {visitors === 0 ? (
          <Card>
            <EmptyState
              title="No visits yet"
              description="Analytics start automatically once your website gets visitors. Share your site link on Instagram and WhatsApp to get going."
            />
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
              <StatCard label="Visitors" value={visitors} format="int" hint={`last ${days} days`} />
              <StatCard label="Page views" value={data.totals.views} format="int" />
              <StatCard
                label="Online bookings"
                value={data.totals.conversions}
                format="int"
                hint={`${pct(f.booking_complete ?? 0, visitors)}% of visitors`}
              />
              <StatCard label="WhatsApp taps" value={data.totals.clicks} format="int" />
            </div>

            <Card>
              <CardHeader title="Visitors per day" description="Unique visitors, Dubai time." />
              <CardBody className="pt-8">
                <Bars data={chart} />
              </CardBody>
            </Card>

            <div className="grid gap-6 lg:grid-cols-12">
              <Card className="lg:col-span-7">
                <CardHeader title="Booking funnel" description="How many visitors moved to each step." />
                <CardBody className="space-y-4">
                  {[
                    { label: 'Visited the site', n: f.pageview ?? visitors },
                    { label: 'Started a booking', n: f.booking_start ?? 0 },
                    { label: 'Completed a booking', n: f.booking_complete ?? 0 },
                    { label: 'Tapped WhatsApp', n: f.wa_click ?? 0 },
                  ].map((s) => (
                    <div key={s.label} className="space-y-1.5">
                      <div className="flex items-baseline justify-between text-sm">
                        <span>{s.label}</span>
                        <span className="tabular-nums text-muted">
                          {s.n} · {pct(s.n, visitors)}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-subtle">
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-700"
                          style={{ width: `${Math.max(1, pct(s.n, visitors))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </CardBody>
              </Card>
              <Card className="lg:col-span-5">
                <CardHeader title="Where visitors come from" />
                <CardBody className="space-y-3">
                  {data.sources.map((s) => (
                    <div key={s.key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate">{SOURCE_LABELS[s.key] ?? s.key}</span>
                      <span className="shrink-0 tabular-nums text-muted">
                        {s.sessions} visitors{s.conversions ? ` · ${s.conversions} booked` : ''}
                      </span>
                    </div>
                  ))}
                  <div className="flex gap-2 border-t pt-4 text-xs text-muted">
                    {data.devices.map((d) => (
                      <span key={d.key} className="rounded-full bg-subtle px-2.5 py-1 capitalize">
                        {d.key} {pct(d.sessions, deviceTotal)}%
                      </span>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader title="Top pages" />
              <div className="pb-2">
                <DataTable columns={pageCols} rows={data.pages} rowKey={(r) => r.key} />
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Sections"
                description="Which parts of each page people actually see and tap — use it to move what works higher up."
              />
              <div className="pb-2">
                <DataTable
                  columns={blockCols}
                  rows={data.blocks}
                  rowKey={(r) => r.key}
                  empty={<p className="px-6 pb-6 text-sm text-muted">No section data yet.</p>}
                />
              </div>
            </Card>
          </>
        )}
      </PageBody>
    </>
  )
}
