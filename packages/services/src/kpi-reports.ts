import { addDays, type OpeningHours, openIntervals } from '@spa/core'
import type { Tx } from '@spa/db'
import { type SQL, sql } from 'drizzle-orm'

/**
 * Extra KPIs (F31) for the spa Reports page and the console Performance detail. One query per KPI; every figure is
 * by business date (bookings / sales / refunds / time entries carry it; instants such as shifts or gift-card
 * movements use the branch cutoff — the default branch's when the whole spa is shown). Money is AED.
 * - Rebooking: completed visits (with a client) whose client has another non-cancelled booking starting later
 *   and dated within N days of the visit; by each therapist on the visit and overall.
 * - Retention: monthly cohorts by first completed visit; % of each cohort with a completed visit 1–6 months later.
 * - RevPATH: net treatment revenue ex VAT (service lines + package/membership sessions redeemed, − service refunds
 *   by refund date; voided sales excluded) ÷ available therapist hours (bookable staff: shifts, else time clock).
 * - Room utilisation: booked room minutes (bookings not cancelled / no-show) ÷ opening hours × rooms.
 * - Prepaid liability as of a date, rebuilt from movements and checked against ledger 2100 / 2110 (spa-wide).
 */
export type ReportRange = { branchId?: string; from: string; to: string }

const n = (v: unknown) => Number(v ?? 0)
const r2 = (v: number) => Math.round(v * 100) / 100
const ratio = (a: number, b: number) => (b ? a / b : null)

async function one<T>(tx: Tx, query: SQL) {
  return (await tx.execute(query)).rows[0] as unknown as T
}

/** `cut.t` = the business-day cutoff of the branch (or the default branch). */
const cutCte = (branchId?: string) =>
  sql`cut as (select coalesce((select business_day_cutoff from branches
    where ${branchId ? sql`id = ${branchId}` : sql`is_default`} limit 1), time '05:00') as t)`
/** Business date of a timestamptz column, given `cut` in scope. */
const businessDate = (col: SQL) => sql`((${col} at time zone 'Asia/Dubai') - cut.t::interval)::date`

// ---------------------------------------------------------------------------------------------------------------
// 1. Rebooking rate
// ---------------------------------------------------------------------------------------------------------------

export const REBOOK_WINDOWS = [30, 60, 90] as const
export type RebookWindow = (typeof REBOOK_WINDOWS)[number]
export const rebookWindow = (v: unknown): RebookWindow =>
  (REBOOK_WINDOWS as readonly number[]).includes(Number(v)) ? (Number(v) as RebookWindow) : 30

export type TherapistRebooking = {
  staffId: string
  name: string
  color: string
  visits: number
  rebooked: number
  rate: number | null
}
export type Rebooking = {
  windowDays: RebookWindow
  visits: number
  rebooked: number
  /** rebooked ÷ visits; null without visits. */
  rate: number | null
  /** Visits not rebooked yet whose window is still open (they can still count). */
  pending: number
  byTherapist: TherapistRebooking[]
}

export async function rebookingRate(
  tx: Tx,
  range: ReportRange & { windowDays?: number; today: string },
): Promise<Rebooking> {
  const days = rebookWindow(range.windowDays)
  const row = await one<{
    total: { visits: number; rebooked: number; pending: number }
    staff: Omit<TherapistRebooking, 'rate'>[]
  }>(
    tx,
    sql`with v as (
        select b.id, b.business_date,
          exists (select 1 from bookings x where x.client_id = b.client_id and x.id <> b.id
            and x.status <> 'cancelled' and x.starts_at > b.starts_at
            and x.business_date <= b.business_date + ${days}::int) as rebooked
        from bookings b
        where b.status = 'completed' and b.client_id is not null
          and b.business_date between ${range.from}::date and ${range.to}::date
          ${range.branchId ? sql`and b.branch_id = ${range.branchId}` : sql``}
      ), per as (
        select st.id, st.display_name as name, st.color, count(distinct v.id)::int as visits,
          count(distinct v.id) filter (where v.rebooked)::int as rebooked
        from v join booking_items bi on bi.booking_id = v.id
          cross join lateral unnest(bi.staff_ids) as sid(id)
          join staff st on st.id = sid.id
        group by st.id
      )
      select
        (select json_build_object('visits', count(*), 'rebooked', count(*) filter (where rebooked),
            'pending', count(*) filter (where not rebooked and business_date + ${days}::int > ${range.today}::date))
          from v) as total,
        (select coalesce(json_agg(json_build_object('staffId', id, 'name', name, 'color', color,
            'visits', visits, 'rebooked', rebooked) order by visits desc, name), '[]') from per) as staff`,
  )
  const visits = n(row.total.visits)
  const rebooked = n(row.total.rebooked)
  return {
    windowDays: days,
    visits,
    rebooked,
    rate: ratio(rebooked, visits),
    pending: n(row.total.pending),
    byTherapist: row.staff.map((s) => ({
      staffId: s.staffId,
      name: s.name,
      color: s.color,
      visits: n(s.visits),
      rebooked: n(s.rebooked),
      rate: ratio(n(s.rebooked), n(s.visits)),
    })),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Retention cohorts
// ---------------------------------------------------------------------------------------------------------------

export const COHORT_MONTHS = 12
export const COHORT_OFFSETS = 6

export type Cohort = {
  /** YYYY-MM of the first completed visit. */
  month: string
  size: number
  /** Clients of the cohort with a completed visit 1…6 months later; null = that month hasn't started. */
  returning: (number | null)[]
}

export const shiftMonth = (ym: string, months: number) => {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 7)
}

/**
 * The `months` cohorts ending with the month of `to`. A client's cohort is their first completed visit in scope (whole
 * spa: also their recorded first visit, so imported history keeps old clients out of new cohorts).
 */
export async function retentionCohorts(
  tx: Tx,
  range: { branchId?: string; to: string; today: string },
  months = COHORT_MONTHS,
): Promise<Cohort[]> {
  const end = range.to.slice(0, 7)
  const start = shiftMonth(end, 1 - months)
  const first = range.branchId
    ? sql`min(v.d)`
    : sql`least(min(v.d), min(${businessDate(sql`c.first_visit_at`)}))`
  const row = await one<{ cohorts: { month: string; size: number; ret: Record<string, number> }[] }>(
    tx,
    sql`with ${cutCte(range.branchId)}, v as (
        select b.client_id, b.business_date as d from bookings b
        where b.status = 'completed' and b.client_id is not null
          ${range.branchId ? sql`and b.branch_id = ${range.branchId}` : sql``}
      ), f as (
        select v.client_id, to_char(${first}, 'YYYY-MM') as cohort
        from v ${range.branchId ? sql`` : sql`join clients c on c.id = v.client_id cross join cut`}
        group by v.client_id
      ), r as (
        select f.cohort, v.client_id,
          (extract(year from v.d)::int * 12 + extract(month from v.d)::int)
            - (substr(f.cohort, 1, 4)::int * 12 + substr(f.cohort, 6, 2)::int) as k
        from f join v using (client_id)
        where f.cohort between ${start} and ${end} and v.d >= ${`${start}-01`}::date
      )
      select coalesce(json_agg(json_build_object('month', s.cohort, 'size', s.size, 'ret',
          coalesce((select json_object_agg(x.k, x.n) from (select r.k, count(distinct r.client_id)::int as n
            from r where r.cohort = s.cohort and r.k between 1 and ${COHORT_OFFSETS} group by 1) x), '{}'))
          order by s.cohort), '[]') as cohorts
      from (select cohort, count(*)::int as size from f where cohort between ${start} and ${end} group by 1) s`,
  )
  const byMonth = new Map(row.cohorts.map((c) => [c.month, c]))
  const now = range.today.slice(0, 7)
  return Array.from({ length: months }, (_, i) => {
    const month = shiftMonth(start, i)
    const c = byMonth.get(month)
    return {
      month,
      size: n(c?.size),
      returning: Array.from({ length: COHORT_OFFSETS }, (_, k) =>
        shiftMonth(month, k + 1) > now ? null : n(c?.ret[String(k + 1)]),
      ),
    }
  })
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Revenue per available treatment hour
// ---------------------------------------------------------------------------------------------------------------

export type TherapistRevPath = {
  staffId: string
  name: string
  color: string
  /** Net treatment revenue ex VAT credited to them (AED). */
  revenue: number
  /** Available hours (0 for staff who aren't bookable). */
  hours: number
  revPath: number | null
  source: 'shifts' | 'timeclock' | null
}
export type RevPath = {
  revenue: number
  hours: number
  revPath: number | null
  /** Revenue on lines without a therapist (counted in the total, not per person). */
  unassigned: number
  byTherapist: TherapistRevPath[]
}

const exVat = (gross: SQL, rate: SQL = sql`5`) => sql`(${gross} - round(${gross} * ${rate} / (100 + ${rate}), 2))`

export async function revPath(tx: Tx, range: ReportRange, now = new Date()): Promise<RevPath> {
  const { branchId, from, to } = range
  const dates = (col: SQL) => sql`${col} between ${from}::date and ${to}::date`
  const branch = (col: SQL) => (branchId ? sql`and ${col} = ${branchId}` : sql``)
  const nowTs = sql`${now.toISOString()}::timestamptz`
  // Prepaid session lines are priced 0; their redeemed value goes to the therapist on that line.
  const sessions = (table: SQL) => sql`select x.staff_id, ${exVat(sql`p.value_aed`)} as amt
    from ${table} p join sl on sl.id = p.sale_id
    left join lateral (select l.staff_id from sale_lines l join service_variants sv on sv.id = l.ref_id
      where l.sale_id = p.sale_id and l.kind = 'service' and l.line_total_aed = 0 and sv.service_id = p.service_id
      order by l.id limit 1) x on true`
  const row = await one<{
    staff: {
      id: string
      name: string
      color: string
      bookable: boolean
      revenue: string
      shift_min: string | null
      clock_min: string | null
    }[]
    total: string
    unassigned: string
  }>(
    tx,
    sql`with ${cutCte(branchId)}, win as (
        select (${from}::date + cut.t) at time zone 'Asia/Dubai' as s,
          ((${to}::date + 1) + cut.t) at time zone 'Asia/Dubai' as e from cut
      ), sl as (
        select s.id from sales s where s.status in ('paid', 'refunded') and ${dates(sql`s.business_date`)}
          ${branch(sql`s.branch_id`)}
      ), rev as (
        select l.staff_id, ${exVat(sql`l.line_total_aed`, sql`l.vat_rate`)} as amt
          from sale_lines l join sl on sl.id = l.sale_id where l.kind = 'service'
        union all ${sessions(sql`package_redemptions`)}
        union all ${sessions(sql`membership_redemptions`)}
        union all
        select l.staff_id, -(rl.amount_aed - rl.vat_aed) from refunds r
          join refund_lines rl on rl.refund_id = r.id join sale_lines l on l.id = rl.sale_line_id
          where l.kind = 'service' and ${dates(sql`r.business_date`)} ${branch(sql`r.branch_id`)}
      ), rv as (
        select staff_id, sum(amt) as amt from rev group by 1
      ), sh as (
        select sh.staff_id, sum(extract(epoch from least(sh.ends_at, win.e) - greatest(sh.starts_at, win.s)) / 60) as m
        from shifts sh, win where sh.starts_at < win.e and sh.ends_at > win.s ${branch(sql`sh.branch_id`)}
        group by 1
      ), tc as (
        select te.staff_id, sum(extract(epoch from
            greatest(coalesce(te.clock_out, least(${nowTs}, win.e)), te.clock_in) - te.clock_in) / 60) as m
        from time_entries te, win where ${dates(sql`te.business_date`)} ${branch(sql`te.branch_id`)}
        group by 1
      ), people as (
        select st.id, st.display_name as name, st.color, st.bookable, coalesce(rv.amt, 0) as revenue,
          sh.m as shift_min, tc.m as clock_min
        from staff st left join rv on rv.staff_id = st.id left join sh on sh.staff_id = st.id
          left join tc on tc.staff_id = st.id
        where rv.amt is not null or (st.bookable and (sh.m > 0 or tc.m > 0))
      )
      select
        (select coalesce(json_agg(people order by people.revenue desc, people.name), '[]') from people) as staff,
        (select coalesce(sum(amt), 0) from rv) as total,
        (select coalesce(sum(amt), 0) from rv where staff_id is null) as unassigned`,
  )
  const byTherapist = row.staff.map((s): TherapistRevPath => {
    const shift = n(s.shift_min)
    const clock = n(s.clock_min)
    const source = !s.bookable ? null : shift > 0 ? 'shifts' : clock > 0 ? 'timeclock' : null
    const hours = source === 'shifts' ? shift / 60 : source === 'timeclock' ? clock / 60 : 0
    const revenue = r2(n(s.revenue))
    return {
      staffId: s.id,
      name: s.name,
      color: s.color,
      revenue,
      hours: r2(hours),
      revPath: hours ? r2(revenue / hours) : null,
      source,
    }
  })
  const revenue = r2(n(row.total))
  const hours = r2(byTherapist.reduce((sum, s) => sum + s.hours, 0))
  return {
    revenue,
    hours,
    revPath: hours ? r2(revenue / hours) : null,
    unassigned: r2(n(row.unassigned)),
    byTherapist,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Room utilisation
// ---------------------------------------------------------------------------------------------------------------

export type RoomUse = {
  roomId: string
  name: string
  openMinutes: number
  bookedMinutes: number
  utilisation: number | null
}
export type BranchRoomUse = Omit<RoomUse, 'roomId'> & { branchId: string; rooms: RoomUse[] }
export type RoomUtilisation = {
  openMinutes: number
  bookedMinutes: number
  utilisation: number | null
  branches: BranchRoomUse[]
}

/** Minutes the branch is open over the business dates (opening hours; close before open runs past midnight). */
export function openMinutes(hours: OpeningHours | null | undefined, from: string, to: string) {
  let total = 0
  for (let d = from; d <= to; d = addDays(d, 1))
    for (const i of openIntervals(d, hours)) total += (i.end.getTime() - i.start.getTime()) / 60_000
  return total
}

export async function roomUtilisation(tx: Tx, range: ReportRange): Promise<RoomUtilisation> {
  const { branchId, from, to } = range
  const row = await one<{
    rooms: {
      id: string
      name: string
      branch_id: string
      branch: string
      hours: OpeningHours | null
      booked: number
    }[]
  }>(
    tx,
    sql`with used as (
        select bi.room_id, sum(bi.duration_min)::int as minutes
        from booking_items bi join bookings b on b.id = bi.booking_id
        where bi.room_id is not null and b.status not in ('cancelled', 'no_show')
          and b.business_date between ${from}::date and ${to}::date
          ${branchId ? sql`and b.branch_id = ${branchId}` : sql``}
        group by 1
      )
      select coalesce(json_agg(json_build_object('id', r.id, 'name', r.name, 'branch_id', br.id, 'branch', br.name,
          'hours', br.opening_hours, 'booked', coalesce(u.minutes, 0))
          order by br.is_default desc, br.name, r.sort, r.name), '[]') as rooms
      from rooms r join branches br on br.id = r.branch_id left join used u on u.room_id = r.id
      where ((r.active and br.active) or u.minutes > 0) ${branchId ? sql`and r.branch_id = ${branchId}` : sql``}`,
  )
  const branches: BranchRoomUse[] = []
  const openByBranch = new Map<string, number>()
  for (const r of row.rooms) {
    let b = branches.find((x) => x.branchId === r.branch_id)
    if (!b) {
      b = { branchId: r.branch_id, name: r.branch, openMinutes: 0, bookedMinutes: 0, utilisation: null, rooms: [] }
      branches.push(b)
      openByBranch.set(r.branch_id, openMinutes(r.hours, from, to))
    }
    const open = openByBranch.get(r.branch_id) ?? 0
    const booked = n(r.booked)
    b.rooms.push({ roomId: r.id, name: r.name, openMinutes: open, bookedMinutes: booked, utilisation: ratio(booked, open) })
    b.openMinutes += open
    b.bookedMinutes += booked
  }
  for (const b of branches) b.utilisation = ratio(b.bookedMinutes, b.openMinutes)
  const open = branches.reduce((s, b) => s + b.openMinutes, 0)
  const booked = branches.reduce((s, b) => s + b.bookedMinutes, 0)
  return { openMinutes: open, bookedMinutes: booked, utilisation: ratio(booked, open), branches }
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Outstanding prepaid liability
// ---------------------------------------------------------------------------------------------------------------

export type PrepaidLiability = {
  asOf: string
  giftCards: { count: number; value: number; pastExpiry: number }
  packages: { count: number; value: number }
  memberships: { count: number; value: number }
  total: number
  /** Ledger balances (credit − debit) through `asOf`: 2100 gift cards, 2110 packages & memberships. */
  ledger: { giftCards: number; packagesMemberships: number; total: number }
  /** Ledger − item balances (0 = consistent). */
  difference: { giftCards: number; packagesMemberships: number; total: number }
}

/**
 * Unused prepaid value at the end of business date `asOf` (spa-wide: prepaid value is used at any branch), rebuilt
 * from movements: gift cards = Σ card movements (sale / refund / cutoff dates); packages and memberships = price
 * paid − sessions redeemed through `asOf`, 0 once refunded or expired (the dates their ledger entries carry).
 */
export async function prepaidLiability(tx: Tx, asOf: string): Promise<PrepaidLiability> {
  const refundedOn = (id: SQL) => sql`(select min(r.business_date) from refund_lines rl
    join refunds r on r.id = rl.refund_id where rl.ref_id = ${id})`
  const entryOn = (type: string, id: SQL) => sql`(select min(je.entry_date) from journal_entries je
    where je.source_type = ${type} and je.source_id = ${id} and je.reverses_id is null)`
  const redeemed = (table: SQL, fk: SQL, id: SQL) => sql`coalesce((select sum(x.value_aed) from ${table} x
    left join sales xs on xs.id = x.sale_id
    where x.${fk} = ${id} and coalesce(xs.business_date, ${businessDate(sql`x.created_at`)}) <= ${asOf}::date), 0)`
  const row = await one<{
    gc: { count: number; value: string; past: string }
    pk: { count: number; value: string }
    mb: { count: number; value: string }
    l2100: string
    l2110: string
  }>(
    tx,
    sql`with ${cutCte()}, gc as (
        select g.id, g.expires_at, sum(t.amount_aed) as bal
        from gift_cards g join gift_card_txns t on t.gift_card_id = g.id
          left join sales s on s.id = t.sale_id and t.kind in ('issue', 'redeem')
          cross join cut
        where coalesce(s.business_date, case when t.kind = 'refund' then ${refundedOn(sql`g.id`)} end,
          ${businessDate(sql`t.created_at`)}) <= ${asOf}::date
        group by g.id
      ), pk as (
        select p.price_paid_aed - ${redeemed(sql`package_redemptions`, sql`client_package_id`, sql`p.id`)} as v,
          coalesce(s.business_date, ${businessDate(sql`p.purchased_at`)}) as sold,
          least(${refundedOn(sql`p.id`)}, ${entryOn('package_expiry', sql`p.id`)},
            case when p.status = 'refunded' then (select min(r.business_date) from refunds r where r.sale_id = p.sale_id) end
          ) as closed
        from client_packages p left join sales s on s.id = p.sale_id cross join cut
      ), mb as (
        select m.price_paid_aed - ${redeemed(sql`membership_redemptions`, sql`client_membership_id`, sql`m.id`)} as v,
          coalesce(s.business_date, ${businessDate(sql`m.created_at`)}) as sold,
          least(${refundedOn(sql`m.id`)}, ${entryOn('membership_expiry', sql`m.id`)}) as closed
        from client_memberships m left join sales s on s.id = m.sale_id cross join cut
      ), led as (
        select la.code, sum(jl.credit_aed - jl.debit_aed) as bal
        from journal_lines jl join journal_entries je on je.id = jl.entry_id
          join ledger_accounts la on la.id = jl.account_id
        where la.code in ('2100', '2110') and je.entry_date <= ${asOf}::date
        group by 1
      )
      select
        (select json_build_object('count', count(*) filter (where bal > 0), 'value', coalesce(sum(bal), 0),
            'past', coalesce(sum(bal) filter (where bal > 0 and expires_at < ((${asOf}::date + 1) + cut.t) at time zone 'Asia/Dubai'), 0))
          from gc, cut) as gc,
        (select json_build_object('count', count(*), 'value', coalesce(sum(v), 0)) from pk
          where sold <= ${asOf}::date and (closed is null or closed > ${asOf}::date) and v <> 0) as pk,
        (select json_build_object('count', count(*), 'value', coalesce(sum(v), 0)) from mb
          where sold <= ${asOf}::date and (closed is null or closed > ${asOf}::date) and v <> 0) as mb,
        (select coalesce(sum(bal), 0) from led where code = '2100') as l2100,
        (select coalesce(sum(bal), 0) from led where code = '2110') as l2110`,
  )
  const gift = r2(n(row.gc.value))
  const pkg = r2(n(row.pk.value))
  const mem = r2(n(row.mb.value))
  const l2100 = r2(n(row.l2100))
  const l2110 = r2(n(row.l2110))
  return {
    asOf,
    giftCards: { count: n(row.gc.count), value: gift, pastExpiry: r2(n(row.gc.past)) },
    packages: { count: n(row.pk.count), value: pkg },
    memberships: { count: n(row.mb.count), value: mem },
    total: r2(gift + pkg + mem),
    ledger: { giftCards: l2100, packagesMemberships: l2110, total: r2(l2100 + l2110) },
    difference: {
      giftCards: r2(l2100 - gift),
      packagesMemberships: r2(l2110 - pkg - mem),
      total: r2(l2100 + l2110 - gift - pkg - mem),
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Console Performance (aggregates only: no therapist, room or client names)
// ---------------------------------------------------------------------------------------------------------------

export type TenantOperations = {
  rebooking: Pick<Rebooking, 'windowDays' | 'visits' | 'rebooked' | 'rate'>
  revPath: Pick<RevPath, 'revenue' | 'hours' | 'revPath'>
  rooms: Pick<RoomUtilisation, 'openMinutes' | 'bookedMinutes' | 'utilisation'>
  liability: Pick<PrepaidLiability, 'asOf' | 'total' | 'ledger' | 'difference'>
}

/** Whole-spa operational KPIs for one spa (call inside its `withTenant()`). */
export async function tenantOperations(
  tx: Tx,
  range: { from: string; to: string; today: string },
  now = new Date(),
): Promise<TenantOperations> {
  const rb = await rebookingRate(tx, { ...range, windowDays: 30 })
  const rp = await revPath(tx, range, now)
  const ru = await roomUtilisation(tx, range)
  const li = await prepaidLiability(tx, range.to)
  return {
    rebooking: { windowDays: rb.windowDays, visits: rb.visits, rebooked: rb.rebooked, rate: rb.rate },
    revPath: { revenue: rp.revenue, hours: rp.hours, revPath: rp.revPath },
    rooms: { openMinutes: ru.openMinutes, bookedMinutes: ru.bookedMinutes, utilisation: ru.utilisation },
    liability: { asOf: li.asOf, total: li.total, ledger: li.ledger, difference: li.difference },
  }
}
