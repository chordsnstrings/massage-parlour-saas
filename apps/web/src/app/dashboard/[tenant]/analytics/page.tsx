import { withTenant } from '@spa/db'
import { sql } from 'drizzle-orm'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Grid, Legend, Meter, Pill, Seg, Stat } from '@/components/crm'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { type Column, DataTable } from '@/components/ui/table'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { Bars } from './bars'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('analytics.title') }
}

const RANGES = { '7': 7, '30': 30, '90': 90 } as const
type Row = { key: string; views: number; clicks: number; sessions: number; conversions: number }

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0)

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ range?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'reports.view')) notFound()
  const { t, fmt } = await getI18n()
  const p = (n: number, d: number) => fmt.percent(pct(n, d) / 100)
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
    return { label: fmt.dateShort(`${d}T12:00:00Z`), value: byDay.get(d) ?? 0 }
  })
  const f = Object.fromEntries(data.funnel.map((r) => [r.key, r.sessions])) as Record<string, number>
  const visitors = data.totals.sessions
  const deviceTotal = data.devices.reduce((a, d) => a + d.sessions, 0)
  const base = appPath(`/${ctx.tenant.slug}/analytics`)
  const num = 'text-right tabular-nums'
  const sourceLabel = (k: string) => t.maybe(`analytics.source.${k}`) ?? k
  const deviceLabel = (k: string) => t.maybe(`analytics.device.${k}`) ?? k

  const pageCols: Column<Row>[] = [
    {
      key: 'path',
      header: t('analytics.colPage'),
      primary: true,
      cell: (r) => <span className="font-medium">{r.key}</span>,
    },
    { key: 'views', header: t('analytics.colViews'), className: num, cell: (r) => fmt.number(r.views) },
    {
      key: 'visitors',
      header: t('analytics.colVisitors'),
      className: num,
      cell: (r) => fmt.number(r.sessions),
    },
    { key: 'clicks', header: t('analytics.colClicks'), className: num, cell: (r) => fmt.number(r.clicks) },
    {
      key: 'booked',
      header: t('analytics.colBookings'),
      className: num,
      cell: (r) => fmt.number(r.conversions),
    },
  ]
  const blockCols: Column<Row>[] = [
    {
      key: 'block',
      header: t('analytics.colSection'),
      primary: true,
      cell: (r) => {
        const [id, type, path] = r.key.split('|')
        return (
          <span className="flex flex-col">
            <span className="font-medium">{type || id}</span>
            <span className="crm-muted text-xs">
              {path} · {id}
            </span>
          </span>
        )
      },
    },
    { key: 'seen', header: t('analytics.colSeen'), className: num, cell: (r) => p(r.views, visitors) },
    { key: 'clicks', header: t('analytics.colClicks'), className: num, cell: (r) => fmt.number(r.clicks) },
    { key: 'ctr', header: t('analytics.colRate'), className: num, cell: (r) => p(r.clicks, r.views) },
  ]
  const steps = [
    { label: t('analytics.stepVisited'), n: f.pageview ?? visitors },
    { label: t('analytics.stepStarted'), n: f.booking_start ?? 0 },
    { label: t('analytics.stepCompleted'), n: f.booking_complete ?? 0 },
    { label: t('analytics.stepWhatsapp'), n: f.wa_click ?? 0 },
  ]

  return (
    <>
      <PageHeader
        title={t('analytics.title')}
        description={t('analytics.description')}
        actions={
          <Seg
            label={t('analytics.rangeLabel')}
            value={String(days)}
            items={Object.keys(RANGES).map((r) => ({
              value: r,
              label: t('analytics.range', { n: r }),
              href: `${base}?range=${r}`,
            }))}
          />
        }
      />
      <PageBody>
        {visitors === 0 ? (
          <Card>
            <EmptyState title={t('analytics.emptyTitle')} description={t('analytics.emptyBody')} />
          </Card>
        ) : (
          <>
            <Grid cols="g4">
              <Stat
                label={t('analytics.visitors')}
                value={fmt.number(visitors)}
                change={{ text: t('analytics.lastDays', { n: days }) }}
              />
              <Stat label={t('analytics.pageViews')} value={fmt.number(data.totals.views)} />
              <Stat
                label={t('analytics.onlineBookings')}
                value={fmt.number(data.totals.conversions)}
                change={{ text: t('analytics.ofVisitors', { pct: p(f.booking_complete ?? 0, visitors) }) }}
              />
              <Stat label={t('analytics.waTaps')} value={fmt.number(data.totals.clicks)} />
            </Grid>

            <Card title={t('analytics.perDay')} sub={t('analytics.perDaySub')}>
              <Bars data={chart} label={t('analytics.perDay')} />
            </Card>

            <Grid cols="col-2">
              <Card title={t('analytics.funnel')} sub={t('analytics.funnelSub')}>
                <div className="crm-stack">
                  {steps.map((s) => (
                    <Meter
                      key={s.label}
                      showLabel
                      label={s.label}
                      value={s.n}
                      max={Math.max(1, visitors)}
                      valueText={`${fmt.number(s.n)} · ${p(s.n, visitors)}`}
                    />
                  ))}
                </div>
              </Card>
              <Card title={t('analytics.sources')}>
                <Legend
                  items={data.sources.map((s) => ({
                    label: sourceLabel(s.key),
                    value: s.conversions
                      ? t('analytics.sourceVisitorsBooked', { count: s.sessions, booked: s.conversions })
                      : t('analytics.sourceVisitors', { count: s.sessions }),
                  }))}
                />
                <p className="crm-ey mt-4">{t('analytics.devices')}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {data.devices.map((d) => (
                    <Pill key={d.key}>
                      {deviceLabel(d.key)} {p(d.sessions, deviceTotal)}
                    </Pill>
                  ))}
                </div>
              </Card>
            </Grid>

            <Card title={t('analytics.topPages')} flush>
              <DataTable columns={pageCols} rows={data.pages} rowKey={(r) => r.key} />
            </Card>

            <Card title={t('analytics.sections')} sub={t('analytics.sectionsSub')} flush>
              <DataTable
                columns={blockCols}
                rows={data.blocks}
                rowKey={(r) => r.key}
                empty={<p className="crm-muted px-6 pb-6 text-sm">{t('analytics.noSections')}</p>}
              />
            </Card>
          </>
        )}
      </PageBody>
    </>
  )
}
