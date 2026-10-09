import { businessDayWindow } from '@spa/core'
import type { Tx } from '@spa/db'
import { type SQL, sql } from 'drizzle-orm'

/**
 * Business KPIs (PLAN §9, MVP). Everything is a SQL aggregate over operational data. Ranges are
 * inclusive business dates (bookings.business_date / sales.business_date), so late-night shops roll
 * past-midnight work into the right day. Money is AED, VAT-inclusive.
 */
export type KpiRange = { branchId?: string; from: string; to: string }

export type BookingStatusKey =
  | 'pending'
  | 'confirmed'
  | 'checked_in'
  | 'in_service'
  | 'completed'
  | 'no_show'
  | 'cancelled'

export type Kpis = {
  from: string
  to: string
  revenue: number
  salesCount: number
  averageTicket: number
  tips: number
  bookings: number
  byStatus: Partial<Record<BookingStatusKey, number>>
  bySource: { source: string; count: number }[]
  /** F13: non-cancelled online bookings by website source (bookings.attribution; 'unknown' = booked before F13). */
  byAttribution: { source: string; count: number }[]
  newClients: number
  /** no-shows ÷ bookings that reached their time (completed, in progress or no-show); null when none. */
  noShowRate: number | null
  bookedMinutes: number
  shiftMinutes: number
  /** booked therapist minutes ÷ shift minutes; null without shifts. */
  utilisation: number | null
  /** revenue ÷ available (on-shift) therapist hours; null without shifts. */
  revenuePerAvailableHour: number | null
  topServices: { name: string; revenue: number; count: number }[]
  topTherapists: { staffId: string; name: string; color: string; revenue: number; count: number }[]
  /** Bookings starting in each Dubai hour of day (index 0–23). */
  byHour: number[]
  /** Bookings by Dubai weekday (0 = Sunday) × hour. */
  heatmap: number[][]
  /** One row per business date in range (gaps filled with zeros). */
  daily: { date: string; revenue: number; bookings: number }[]
}

const LIVE = sql`b.status not in ('cancelled', 'no_show')`
const n = (v: unknown) => Number(v ?? 0)
const r2 = (v: number) => Math.round(v * 100) / 100

async function rows<T>(tx: Tx, query: SQL) {
  return (await tx.execute(query)).rows as unknown as T[]
}

async function cutoffOf(tx: Tx, branchId?: string) {
  const [row] = await rows<{ cutoff: string }>(
    tx,
    sql`select business_day_cutoff::text as cutoff from branches
      where ${branchId ? sql`id = ${branchId}` : sql`is_default`} limit 1`,
  )
  return row?.cutoff?.slice(0, 5) ?? '05:00'
}

export async function kpis(tx: Tx, range: KpiRange): Promise<Kpis> {
  const { branchId, from, to } = range
  const sBranch = branchId ? sql`and s.branch_id = ${branchId}` : sql``
  const bBranch = branchId ? sql`and b.branch_id = ${branchId}` : sql``
  const shBranch = branchId ? sql`and sh.branch_id = ${branchId}` : sql``
  const sDates = sql`s.business_date between ${from}::date and ${to}::date`
  const bDates = sql`b.business_date between ${from}::date and ${to}::date`
  const cutoff = await cutoffOf(tx, branchId)
  const winStart = businessDayWindow(from, cutoff).start
  const winEnd = businessDayWindow(to, cutoff).end

  const [money] = await rows<{ revenue: string; n: number; tips: string }>(
    tx,
    sql`select coalesce(sum(s.total_aed), 0) as revenue, count(*)::int as n, coalesce(sum(s.tips_aed), 0) as tips
      from sales s where s.status = 'paid' and ${sDates} ${sBranch}`,
  )
  const statusRows = await rows<{ status: BookingStatusKey; n: number }>(
    tx,
    sql`select b.status, count(*)::int as n from bookings b where ${bDates} ${bBranch} group by 1`,
  )
  const sourceRows = await rows<{ source: string; n: number }>(
    tx,
    sql`select b.source, count(*)::int as n from bookings b
      where ${bDates} ${bBranch} and b.status <> 'cancelled' group by 1 order by 2 desc, 1`,
  )
  const attributionRows = await rows<{ source: string; n: number }>(
    tx,
    sql`select coalesce(b.attribution::text, 'unknown') as source, count(*)::int as n from bookings b
      where ${bDates} ${bBranch} and b.source = 'online' and b.status <> 'cancelled' group by 1 order by 2 desc, 1`,
  )
  const [fresh] = await rows<{ n: number }>(
    tx,
    sql`select count(*)::int as n from clients c
      where c.first_visit_at >= ${winStart.toISOString()}::timestamptz and c.first_visit_at < ${winEnd.toISOString()}::timestamptz
      ${branchId ? sql`and exists (select 1 from bookings b where b.client_id = c.id and b.branch_id = ${branchId})` : sql``}`,
  )
  const [booked] = await rows<{ minutes: number }>(
    tx,
    sql`select coalesce(sum(bi.duration_min * greatest(cardinality(bi.staff_ids), 1)), 0)::int as minutes
      from booking_items bi join bookings b on b.id = bi.booking_id
      where ${bDates} ${bBranch} and ${LIVE}`,
  )
  const [onShift] = await rows<{ minutes: number }>(
    tx,
    sql`select coalesce(sum(extract(epoch from
        least(sh.ends_at, ${winEnd.toISOString()}::timestamptz) - greatest(sh.starts_at, ${winStart.toISOString()}::timestamptz)
      ) / 60), 0)::int as minutes
      from shifts sh
      where sh.starts_at < ${winEnd.toISOString()}::timestamptz and sh.ends_at > ${winStart.toISOString()}::timestamptz ${shBranch}`,
  )
  const services = await rows<{ name: string; revenue: string; n: number }>(
    tx,
    sql`select coalesce(sv.name->>'en', l.description) as name, sum(l.line_total_aed) as revenue, sum(l.qty)::int as n
      from sale_lines l join sales s on s.id = l.sale_id
      left join service_variants v on v.id = l.ref_id
      left join services sv on sv.id = v.service_id
      where l.kind = 'service' and s.status = 'paid' and ${sDates} ${sBranch}
      group by 1 order by 2 desc, 1 limit 5`,
  )
  const therapists = await rows<{ id: string; name: string; color: string; revenue: string; n: number }>(
    tx,
    sql`select st.id, st.display_name as name, st.color, sum(l.line_total_aed) as revenue, count(*)::int as n
      from sale_lines l join sales s on s.id = l.sale_id join staff st on st.id = l.staff_id
      where s.status = 'paid' and ${sDates} ${sBranch}
      group by st.id order by 4 desc, 2 limit 5`,
  )
  const [heat, daily] = await Promise.all([peakHours(tx, range), revenueSeries(tx, range)])

  const revenue = n(money?.revenue)
  const salesCount = n(money?.n)
  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, n(r.n)])) as Kpis['byStatus']
  const reached =
    (byStatus.completed ?? 0) +
    (byStatus.no_show ?? 0) +
    (byStatus.checked_in ?? 0) +
    (byStatus.in_service ?? 0)
  const shiftMinutes = n(onShift?.minutes)
  const bookedMinutes = n(booked?.minutes)
  return {
    from,
    to,
    revenue: r2(revenue),
    salesCount,
    averageTicket: salesCount ? r2(revenue / salesCount) : 0,
    tips: r2(n(money?.tips)),
    bookings: statusRows.reduce((sum, r) => sum + n(r.n), 0),
    byStatus,
    bySource: sourceRows.map((r) => ({ source: r.source, count: n(r.n) })),
    byAttribution: attributionRows.map((r) => ({ source: r.source, count: n(r.n) })),
    newClients: n(fresh?.n),
    noShowRate: reached ? (byStatus.no_show ?? 0) / reached : null,
    bookedMinutes,
    shiftMinutes,
    utilisation: shiftMinutes ? bookedMinutes / shiftMinutes : null,
    revenuePerAvailableHour: shiftMinutes ? r2(revenue / (shiftMinutes / 60)) : null,
    topServices: services.map((r) => ({ name: r.name, revenue: r2(n(r.revenue)), count: n(r.n) })),
    topTherapists: therapists.map((r) => ({
      staffId: r.id,
      name: r.name,
      color: r.color,
      revenue: r2(n(r.revenue)),
      count: n(r.n),
    })),
    ...heat,
    daily,
  }
}

const filters = (branchId?: string) => ({
  s: branchId ? sql`and s.branch_id = ${branchId}` : sql``,
  b: branchId ? sql`and b.branch_id = ${branchId}` : sql``,
})

/** Revenue (paid sales) and non-cancelled bookings per business date, gaps filled with zeros. */
export async function revenueSeries(tx: Tx, { branchId, from, to }: KpiRange): Promise<Kpis['daily']> {
  const f = filters(branchId)
  const list = await rows<{ date: string; revenue: string; bookings: number }>(
    tx,
    sql`select to_char(d, 'YYYY-MM-DD') as date,
        coalesce((select sum(s.total_aed) from sales s where s.status = 'paid' and s.business_date = d::date ${f.s}), 0) as revenue,
        (select count(*) from bookings b where b.business_date = d::date and b.status <> 'cancelled' ${f.b})::int as bookings
      from generate_series(${from}::date, ${to}::date, interval '1 day') d order by d`,
  )
  return list.map((r) => ({ date: r.date, revenue: r2(n(r.revenue)), bookings: n(r.bookings) }))
}

/** Non-cancelled bookings by Dubai start hour, and by weekday (0 = Sunday) × hour. */
export async function peakHours(
  tx: Tx,
  { branchId, from, to }: KpiRange,
): Promise<Pick<Kpis, 'byHour' | 'heatmap'>> {
  const list = await rows<{ dow: number; hour: number; n: number }>(
    tx,
    sql`select extract(dow from b.starts_at at time zone 'Asia/Dubai')::int as dow,
        extract(hour from b.starts_at at time zone 'Asia/Dubai')::int as hour, count(*)::int as n
      from bookings b where b.business_date between ${from}::date and ${to}::date ${filters(branchId).b}
        and b.status <> 'cancelled' group by 1, 2`,
  )
  const byHour = Array.from({ length: 24 }, () => 0)
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  for (const h of list) {
    byHour[h.hour] = (byHour[h.hour] ?? 0) + n(h.n)
    heatmap[h.dow]![h.hour] = n(h.n)
  }
  return { byHour, heatmap }
}

export type AgendaItem = {
  bookingId: string
  itemId: string
  refCode: string
  status: BookingStatusKey
  startsAt: Date
  endsAt: Date
  serviceName: string
  durationMin: number
  clientName: string | null
  roomName: string | null
  therapists: string[]
}

/**
 * Booking items of one business date that haven't finished yet (in start order). Pass `staffId` for a
 * therapist's personal agenda. Cancelled, no-show and completed bookings are left out.
 */
export async function upcomingItems(
  tx: Tx,
  opts: { date: string; after: Date; branchId?: string; staffId?: string; limit?: number },
): Promise<AgendaItem[]> {
  const list = await rows<{
    booking_id: string
    item_id: string
    ref_code: string
    status: BookingStatusKey
    starts_at: string
    ends_at: string
    service_name: string
    duration_min: number
    client_name: string | null
    room_name: string | null
    therapists: string[] | null
  }>(
    tx,
    sql`select b.id as booking_id, bi.id as item_id, b.ref_code, b.status, bi.starts_at, bi.ends_at, bi.service_name,
        bi.duration_min, c.name as client_name, r.name as room_name,
        (select array_agg(st.display_name order by st.sort, st.display_name) from staff st where st.id = any(bi.staff_ids)) as therapists
      from booking_items bi join bookings b on b.id = bi.booking_id
      left join clients c on c.id = b.client_id
      left join rooms r on r.id = bi.room_id
      where b.business_date = ${opts.date}::date and bi.ends_at > ${opts.after.toISOString()}::timestamptz
        and b.status not in ('cancelled', 'no_show', 'completed')
        ${opts.branchId ? sql`and b.branch_id = ${opts.branchId}` : sql``}
        ${opts.staffId ? sql`and ${opts.staffId}::uuid = any(bi.staff_ids)` : sql``}
      order by bi.starts_at, b.ref_code limit ${opts.limit ?? 8}`,
  )
  return list.map((r) => ({
    bookingId: r.booking_id,
    itemId: r.item_id,
    refCode: r.ref_code,
    status: r.status,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    serviceName: r.service_name,
    durationMin: n(r.duration_min),
    clientName: r.client_name,
    roomName: r.room_name,
    therapists: r.therapists ?? [],
  }))
}
