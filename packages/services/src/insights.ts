// Numbers behind the weekly AI insights digest (P3): last 7 complete business days vs the 7 before,
// shaped into a compact, model-friendly table. All money AED, VAT-inclusive.
import { addDays, businessDateOf, businessDayWindow } from '@spa/core'
import type { Tx } from '@spa/db'
import { sql } from 'drizzle-orm'
import { type Kpis, kpis } from './reports'

export type WeekNumbers = {
  from: string
  to: string
  revenue: number
  averageTicket: number
  /** Non-cancelled bookings. */
  bookings: number
  completed: number
  noShows: number
  noShowRate: number | null
  utilisation: number | null
  topServices: Kpis['topServices']
  newClients: number
  returningClients: number
  onlineBookings: number
  onlineShare: number | null
  /** Unique website visitors (daily-rotating hash, summed per Dubai day). */
  visitors: number
}

async function one<T>(tx: Tx, query: ReturnType<typeof sql>) {
  return ((await tx.execute(query)).rows[0] ?? {}) as T
}

/** Week ranges for a run at `now`: the last 7 complete business days and the 7 before them. */
export function insightWeeks(now: Date, cutoff = '05:00') {
  const to = addDays(businessDateOf(now, cutoff), -1)
  const from = addDays(to, -6)
  return { thisWeek: { from, to }, lastWeek: { from: addDays(from, -7), to: addDays(from, -1) } }
}

export async function weekNumbers(
  tx: Tx,
  range: { from: string; to: string },
  cutoff = '05:00',
): Promise<WeekNumbers> {
  const k = await kpis(tx, range)
  const start = businessDayWindow(range.from, cutoff).start.toISOString()
  const live = k.bookings - (k.byStatus.cancelled ?? 0)
  const clients = await one<{ returning: number }>(
    tx,
    sql`select count(distinct b.client_id) filter (where c.first_visit_at < ${start}::timestamptz)::int as returning
      from bookings b join clients c on c.id = b.client_id
      where b.business_date between ${range.from}::date and ${range.to}::date
        and b.status not in ('cancelled', 'no_show')`,
  )
  const web = await one<{ visitors: number }>(
    tx,
    sql`select count(distinct (session_hash, (ts at time zone 'Asia/Dubai')::date))::int as visitors
      from web_events
      where ts >= (${range.from}::date::timestamp at time zone 'Asia/Dubai')
        and ts < ((${range.to}::date + 1)::timestamp at time zone 'Asia/Dubai')`,
  )
  const online = k.bySource.find((s) => s.source === 'online')?.count ?? 0
  return {
    from: range.from,
    to: range.to,
    revenue: k.revenue,
    averageTicket: k.averageTicket,
    bookings: live,
    completed: k.byStatus.completed ?? 0,
    noShows: k.byStatus.no_show ?? 0,
    noShowRate: k.noShowRate,
    utilisation: k.utilisation,
    topServices: k.topServices.slice(0, 3),
    newClients: k.newClients,
    returningClients: Number(clients.returning ?? 0),
    onlineBookings: online,
    onlineShare: live ? online / live : null,
    visitors: Number(web.visitors ?? 0),
  }
}

export type InsightMetric = {
  key: string
  label: string
  thisWeek: number | null
  lastWeek: number | null
  /** "+12%" for counts and money, "+3 pts" for rates, null when there's nothing to compare. */
  change: string | null
}

export type InsightsInput = {
  thisWeek: { from: string; to: string }
  lastWeek: { from: string; to: string }
  metrics: InsightMetric[]
  topServices: { thisWeek: Kpis['topServices']; lastWeek: Kpis['topServices'] }
  notes: string[]
  /** False when both weeks are empty — no point asking a model. */
  hasActivity: boolean
}

const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10)
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`

function change(kind: 'count' | 'rate', a: number | null, b: number | null) {
  if (a === null || b === null) return null
  if (kind === 'rate') return `${signed(Math.round((a - b) * 10) / 10)} pts`
  if (b === 0) return a === 0 ? '0%' : null
  return `${signed(Math.round(((a - b) / b) * 100))}%`
}

/** Pure: two weeks of numbers → the table the insights model sees (and the tests check). */
export function shapeInsightsInput(thisWeek: WeekNumbers, lastWeek: WeekNumbers): InsightsInput {
  const rows: [string, string, 'count' | 'rate', (w: WeekNumbers) => number | null][] = [
    ['revenue', 'Revenue (AED, VAT incl.)', 'count', (w) => w.revenue],
    ['bookings', 'Bookings (excl. cancelled)', 'count', (w) => w.bookings],
    ['average_ticket', 'Average ticket (AED)', 'count', (w) => w.averageTicket],
    ['utilisation', 'Therapist utilisation (%)', 'rate', (w) => pct(w.utilisation)],
    ['no_show_rate', 'No-show rate (%)', 'rate', (w) => pct(w.noShowRate)],
    ['no_shows', 'No-shows', 'count', (w) => w.noShows],
    ['new_clients', 'New clients', 'count', (w) => w.newClients],
    ['returning_clients', 'Returning clients', 'count', (w) => w.returningClients],
    ['online_share', 'Online booking share (%)', 'rate', (w) => pct(w.onlineShare)],
    ['visitors', 'Website visitors', 'count', (w) => w.visitors],
  ]
  const metrics = rows.map(([key, label, kind, get]) => {
    const a = get(thisWeek)
    const b = get(lastWeek)
    return { key, label, thisWeek: a, lastWeek: b, change: change(kind, a, b) }
  })
  const notes: string[] = []
  if (thisWeek.utilisation === null)
    notes.push('No shifts were scheduled this week, so utilisation is unknown.')
  if (thisWeek.visitors === 0 && lastWeek.visitors === 0)
    notes.push('The website recorded no visitors in either week (not published, or no traffic yet).')
  if (thisWeek.topServices.length === 0) notes.push('No paid service sales this week.')
  const busy = (w: WeekNumbers) => w.bookings > 0 || w.revenue > 0
  return {
    thisWeek: { from: thisWeek.from, to: thisWeek.to },
    lastWeek: { from: lastWeek.from, to: lastWeek.to },
    metrics,
    topServices: { thisWeek: thisWeek.topServices, lastWeek: lastWeek.topServices },
    notes,
    hasActivity: busy(thisWeek) || busy(lastWeek),
  }
}

/** The insights input for a tenant at `now` (default branch cutoff). */
export async function insightsInput(tx: Tx, now = new Date()) {
  const [row] = (
    await tx.execute(sql`select business_day_cutoff::text as cutoff from branches where is_default limit 1`)
  ).rows as { cutoff?: string }[]
  const cutoff = row?.cutoff?.slice(0, 5) ?? '05:00'
  const weeks = insightWeeks(now, cutoff)
  const [a, b] = [
    await weekNumbers(tx, weeks.thisWeek, cutoff),
    await weekNumbers(tx, weeks.lastWeek, cutoff),
  ]
  return shapeInsightsInput(a, b)
}
