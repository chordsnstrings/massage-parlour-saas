import { dubaiInstant } from '@spa/core'
import type { Tx } from '@spa/db'
import { type SQL, sql } from 'drizzle-orm'
import { aiMonth, aiUsageTotals } from './ai-usage'
import { campaignResults } from './campaigns'

/**
 * Super-admin performance view (PLAN §18.1): aggregate numbers per spa, read inside that spa's `withTenant()`
 * transaction (RLS still applies; the platform loops tenants). Aggregates only — no client names or records.
 * Revenue is AED net of refunds: sales (paid or later refunded) by sale business date − refunds by refund
 * business date. Web numbers come from the cookieless `web_events` (kept 90 days), so ranges are capped.
 */
export type PerformanceRangeKey = '7' | '30' | '90' | 'month' | 'last-month'
export type PerformanceRange = { key: PerformanceRangeKey; from: string; to: string; days: number }

export const PERFORMANCE_RANGES: { key: PerformanceRangeKey; label: string }[] = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: 'month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
]
export const PERFORMANCE_MAX_DAYS = 92

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1

/** Inclusive business-date range for a picker key, ending today (Dubai). Unknown keys → 30 days. */
export function performanceRange(key: string | undefined, today: string): PerformanceRange {
  const k = (PERFORMANCE_RANGES.some((r) => r.key === key) ? key : '30') as PerformanceRangeKey
  let from: string
  let to = today
  if (k === 'month') from = `${today.slice(0, 7)}-01`
  else if (k === 'last-month') {
    to = addDays(`${today.slice(0, 7)}-01`, -1)
    from = `${to.slice(0, 7)}-01`
  } else from = addDays(today, -(Number(k) - 1))
  const days = Math.min(daysBetween(from, to), PERFORMANCE_MAX_DAYS)
  return { key: k, from: addDays(to, -(days - 1)), to, days }
}

export type SourceCount = { source: string; count: number }
export type TenantPerformance = {
  /** Net of refunds (AED). */
  revenue: number
  grossSales: number
  refunds: number
  bookings: number
  completed: number
  cancelled: number
  noShow: number
  newClients: number
  /** Web sessions (daily-salted visitor hashes) on the spa site. */
  visits: number
  bookingStarts: number
  /** Sessions that completed an online booking. */
  bookedSessions: number
  /** bookedSessions ÷ visits; null without visits. */
  conversion: number | null
  /** Non-cancelled bookings by channel (walk_in, online, ai_agent, instagram, gbp, phone, whatsapp). */
  bookingSources: SourceCount[]
  /** Visitors by entry source (?src= ig/gbp/qr, referrer host or direct) and how many of them booked. */
  webSources: { source: string; sessions: number; booked: number }[]
  /** AI spend this Dubai calendar month (USD). */
  aiSpendUsd: number
}

const n = (v: unknown) => Number(v ?? 0)
const r2 = (v: number) => Math.round(v * 100) / 100

async function one<T>(tx: Tx, query: SQL) {
  return (await tx.execute(query)).rows[0] as unknown as T
}

const webWindow = (from: string, to: string) => ({
  start: dubaiInstant(from, 0).toISOString(),
  end: dubaiInstant(addDays(to, 1), 0).toISOString(),
})

/** One query per spa: money, bookings, new clients, web funnel, sources and month-to-date AI spend. */
export async function tenantPerformance(
  tx: Tx,
  { from, to }: Pick<PerformanceRange, 'from' | 'to'>,
  now = new Date(),
): Promise<TenantPerformance> {
  const w = webWindow(from, to)
  const dates = (col: SQL) => sql`${col} between ${from}::date and ${to}::date`
  const row = await one<{
    gross: string
    refunds: string
    bk: { total: number; completed: number; cancelled: number; no_show: number }
    new_clients: number
    web: { visits: number; started: number; booked: number }
    booking_sources: SourceCount[]
    web_sources: { source: string; sessions: number; booked: number }[]
  }>(
    tx,
    sql`with cut as (
        select coalesce((select business_day_cutoff from branches where is_default limit 1), time '05:00') as t
      ), win as (
        select (${from}::date + cut.t) at time zone 'Asia/Dubai' as s,
          ((${to}::date + 1) + cut.t) at time zone 'Asia/Dubai' as e from cut
      ), web as (
        select session_hash, type, source, ts from web_events
        where ts >= ${w.start}::timestamptz and ts < ${w.end}::timestamptz
      ), entry as (
        select distinct on (session_hash) session_hash, coalesce(source, 'direct') as src from web order by session_hash, ts
      )
      select
        (select coalesce(sum(total_aed), 0) from sales
          where status in ('paid', 'refunded') and ${dates(sql`business_date`)}) as gross,
        (select coalesce(sum(amount_aed), 0) from refunds where ${dates(sql`business_date`)}) as refunds,
        (select json_build_object('total', count(*), 'completed', count(*) filter (where status = 'completed'),
            'cancelled', count(*) filter (where status = 'cancelled'), 'no_show', count(*) filter (where status = 'no_show'))
          from bookings where ${dates(sql`business_date`)}) as bk,
        (select count(*)::int from clients c, win where c.first_visit_at >= win.s and c.first_visit_at < win.e) as new_clients,
        (select json_build_object('visits', count(distinct session_hash),
            'started', count(distinct session_hash) filter (where type = 'booking_start'),
            'booked', count(distinct session_hash) filter (where type = 'booking_complete')) from web) as web,
        (select coalesce(json_agg(json_build_object('source', x.source, 'count', x.n) order by x.n desc, x.source), '[]')
          from (select source::text as source, count(*)::int as n from bookings
            where ${dates(sql`business_date`)} and status <> 'cancelled' group by 1) x) as booking_sources,
        (select coalesce(json_agg(json_build_object('source', x.src, 'sessions', x.sessions, 'booked', x.booked)
            order by x.sessions desc, x.src), '[]')
          from (select e.src, count(distinct w.session_hash)::int as sessions,
              count(distinct w.session_hash) filter (where w.type = 'booking_complete')::int as booked
            from web w join entry e using (session_hash) group by 1 order by 2 desc limit 10) x) as web_sources`,
  )
  // This month's AI spend: the shared aggregation (RLS limits it to this spa).
  const [ai] = await aiUsageTotals(tx, aiMonth(0, now))
  const gross = n(row.gross)
  const refunds = n(row.refunds)
  const visits = n(row.web.visits)
  const booked = n(row.web.booked)
  return {
    revenue: r2(gross - refunds),
    grossSales: r2(gross),
    refunds: r2(refunds),
    bookings: n(row.bk.total),
    completed: n(row.bk.completed),
    cancelled: n(row.bk.cancelled),
    noShow: n(row.bk.no_show),
    newClients: n(row.new_clients),
    visits,
    bookingStarts: n(row.web.started),
    bookedSessions: booked,
    conversion: visits ? booked / visits : null,
    bookingSources: row.booking_sources.map((s) => ({ source: s.source, count: n(s.count) })),
    webSources: row.web_sources.map((s) => ({
      source: s.source,
      sessions: n(s.sessions),
      booked: n(s.booked),
    })),
    aiSpendUsd: r2(ai?.costUsd ?? 0),
  }
}

export type PerformanceDay = { date: string; revenue: number; bookings: number; visits: number }
export type TenantPerformanceDetail = {
  daily: PerformanceDay[]
  campaigns: {
    name: string
    status: string
    queuedAt: string | null
    reached: number
    bookedClients: number
    bookings: number
  }[]
  /** Published social posts in range, by platform (instagram / gbp / facebook). */
  posts: SourceCount[]
  /** New inbox conversations in range, by channel. */
  conversations: SourceCount[]
  /** New reviews in range, by source. */
  reviews: SourceCount[]
}

/** Trends + marketing activity for one spa (call inside its `withTenant()`). */
export async function tenantPerformanceDetail(
  tx: Tx,
  { from, to }: Pick<PerformanceRange, 'from' | 'to'>,
): Promise<TenantPerformanceDetail> {
  const w = webWindow(from, to)
  const inRange = (col: SQL) => sql`${col} >= ${w.start}::timestamptz and ${col} < ${w.end}::timestamptz`
  const counts = (table: SQL, key: SQL, col: SQL) =>
    sql`(select coalesce(json_agg(json_build_object('source', x.k, 'count', x.n) order by x.n desc, x.k), '[]')
      from (select ${key}::text as k, count(*)::int as n from ${table} where ${inRange(col)} group by 1) x)`
  const row = await one<{
    daily: PerformanceDay[]
    campaigns: { id: string; name: string; status: string; queued_at: string | null }[]
    posts: SourceCount[]
    conversations: SourceCount[]
    reviews: SourceCount[]
  }>(
    tx,
    sql`select
        (select json_agg(json_build_object('date', to_char(d, 'YYYY-MM-DD'),
            'revenue', coalesce((select sum(s.total_aed) from sales s
              where s.status in ('paid', 'refunded') and s.business_date = d::date), 0)
              - coalesce((select sum(r.amount_aed) from refunds r where r.business_date = d::date), 0),
            'bookings', (select count(*) from bookings b where b.business_date = d::date and b.status <> 'cancelled'),
            'visits', (select count(distinct e.session_hash) from web_events e
              where e.ts >= d at time zone 'Asia/Dubai' and e.ts < (d + interval '1 day') at time zone 'Asia/Dubai'))
            order by d)
          from generate_series(${from}::date, ${to}::date, interval '1 day') d) as daily,
        (select coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'status', c.status, 'queued_at', c.queued_at)
            order by c.queued_at desc), '[]')
          from (select id, name, status, queued_at from campaigns
            where queued_at is not null and ${inRange(sql`queued_at`)} order by queued_at desc limit 10) c) as campaigns,
        (select coalesce(json_agg(json_build_object('source', x.k, 'count', x.n) order by x.n desc, x.k), '[]')
          from (select platform::text as k, count(*)::int as n from social_posts
            where status = 'published' and ${inRange(sql`published_at`)} group by 1) x) as posts,
        ${counts(sql`conversations`, sql`channel`, sql`created_at`)} as conversations,
        ${counts(sql`reviews`, sql`source`, sql`created_at`)} as reviews`,
  )
  const results = await campaignResults(
    tx,
    row.campaigns.map((c) => c.id),
  )
  const toCounts = (list: SourceCount[]) => list.map((s) => ({ source: s.source, count: n(s.count) }))
  return {
    daily: (row.daily ?? []).map((d) => ({
      date: d.date,
      revenue: r2(n(d.revenue)),
      bookings: n(d.bookings),
      visits: n(d.visits),
    })),
    campaigns: row.campaigns.map((c) => {
      const res = results.get(c.id)
      return {
        name: c.name,
        status: c.status,
        queuedAt: c.queued_at,
        reached: n(res?.reached),
        bookedClients: n(res?.bookedClients),
        bookings: n(res?.bookings),
      }
    }),
    posts: toCounts(row.posts),
    conversations: toCounts(row.conversations),
    reviews: toCounts(row.reviews),
  }
}

/** Weekly buckets (7 days ending on the range's last day) from a daily series. */
export function weeklySeries(daily: PerformanceDay[]): PerformanceDay[] {
  const out: PerformanceDay[] = []
  for (let end = daily.length; end > 0; end -= 7) {
    const chunk = daily.slice(Math.max(0, end - 7), end)
    out.unshift({
      date: chunk[0]!.date,
      revenue: r2(chunk.reduce((a, d) => a + d.revenue, 0)),
      bookings: chunk.reduce((a, d) => a + d.bookings, 0),
      visits: chunk.reduce((a, d) => a + d.visits, 0),
    })
  }
  return out
}
