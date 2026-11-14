// Multi-day calendar (Week / Month views) and the sidebar's count badges. Tenant-scoped through the caller's `tx`
// (RLS); permission + own-only decisions are the caller's, passed in as filters.
import { addDays, businessDayWindow } from '@spa/core'
import {
  bookingItems,
  bookings,
  branches,
  clients,
  conversations,
  outbox,
  shifts,
  siteEnquiries,
  type Tx,
} from '@spa/db'
import { and, asc, between, eq, gt, inArray, lt, type SQL, sql } from 'drizzle-orm'
import { DomainError } from './errors'
import { campaignConsentWithdrawn } from './growth'
import { outboxBookingLive } from './outbox'
import { CHANNELS } from './social'

/** Statuses that don't occupy the day (excluded from counts, revenue and occupancy). */
const DROPPED = ['cancelled', 'no_show']
const MAX_DAYS = 62

export type RangeItem = {
  itemId: string
  bookingId: string
  refCode: string
  status: (typeof bookings.$inferSelect)['status']
  source: (typeof bookings.$inferSelect)['source']
  /** Business date of the booking (branch cutoff applied when it was booked / moved). */
  businessDate: string
  startsAt: Date
  endsAt: Date
  staffIds: string[]
  roomId: string | null
  serviceName: string
  priceAed: string | null
  clientName: string | null
  notes: string | null
}

export type RangeDay = {
  date: string
  /** Bookings that still happen (not cancelled / no-show). */
  bookings: number
  pending: number
  revenueAed: number
  /** Therapist-minutes booked vs. scheduled shift minutes inside the business day (occupancy hint). */
  bookedMin: number
  shiftMin: number
}

/**
 * Bookings of one branch for the business dates `from`…`to` (inclusive) in one query, plus per-day totals.
 * `staffId` limits everything to that therapist (therapists see only their own bookings and shifts).
 */
export async function loadCalendarRange(
  tx: Tx,
  q: { branchId: string; from: string; to: string; staffId?: string | null },
): Promise<{ cutoff: string; items: RangeItem[]; days: RangeDay[] }> {
  if (q.from > q.to || addDays(q.from, MAX_DAYS) < q.to) throw new DomainError('Invalid date range')
  const [branch] = await tx
    .select({ cutoff: branches.businessDayCutoff })
    .from(branches)
    .where(eq(branches.id, q.branchId))
  if (!branch) throw new DomainError('Branch not found', 'not_found')
  const cutoff = branch.cutoff.slice(0, 5)
  const own = q.staffId ? sql`${q.staffId}::uuid = any(${bookingItems.staffIds})` : undefined

  const rows = await tx
    .select({
      itemId: bookingItems.id,
      bookingId: bookings.id,
      refCode: bookings.refCode,
      status: bookings.status,
      source: bookings.source,
      attribution: bookings.attribution,
      businessDate: bookings.businessDate,
      startsAt: bookingItems.startsAt,
      endsAt: bookingItems.endsAt,
      staffIds: bookingItems.staffIds,
      roomId: bookingItems.roomId,
      serviceName: bookingItems.serviceName,
      priceAed: bookingItems.priceAed,
      clientName: clients.name,
      notes: bookings.notes,
    })
    .from(bookingItems)
    .innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
    .leftJoin(clients, eq(clients.id, bookings.clientId))
    .where(and(eq(bookings.branchId, q.branchId), between(bookings.businessDate, q.from, q.to), own))
    .orderBy(asc(bookingItems.startsAt))

  // Shift capacity, clipped to each business-day window [date cutoff, next date cutoff).
  const start = businessDayWindow(q.from, cutoff).start
  const end = businessDayWindow(q.to, cutoff).end
  const shiftRows = await tx
    .select({ start: shifts.startsAt, end: shifts.endsAt })
    .from(shifts)
    .where(
      and(
        eq(shifts.branchId, q.branchId),
        lt(shifts.startsAt, end),
        gt(shifts.endsAt, start),
        q.staffId ? eq(shifts.staffId, q.staffId) : undefined,
      ),
    )

  const days = new Map<string, RangeDay>()
  for (let d = q.from; d <= q.to; d = addDays(d, 1))
    days.set(d, { date: d, bookings: 0, pending: 0, revenueAed: 0, bookedMin: 0, shiftMin: 0 })
  const counted = new Set<string>()
  for (const r of rows) {
    const day = days.get(r.businessDate)
    if (!day || DROPPED.includes(r.status)) continue
    if (!counted.has(r.bookingId)) {
      counted.add(r.bookingId)
      day.bookings++
      if (r.status === 'pending') day.pending++
    }
    day.revenueAed += Number(r.priceAed ?? 0)
    day.bookedMin +=
      ((r.endsAt.getTime() - r.startsAt.getTime()) / 60_000) * Math.max(1, q.staffId ? 1 : r.staffIds.length)
  }
  for (const day of days.values()) {
    const w = businessDayWindow(day.date, cutoff)
    for (const s of shiftRows) {
      const ms = Math.min(s.end.getTime(), w.end.getTime()) - Math.max(s.start.getTime(), w.start.getTime())
      if (ms > 0) day.shiftMin += ms / 60_000
    }
    day.revenueAed = Math.round(day.revenueAed * 100) / 100
  }
  return { cutoff, items: rows, days: [...days.values()] }
}

export type NavCountsQuery = {
  now?: Date
  /** Branches the member works in; null = all. */
  branchIds: string[] | null
  /** Own-only calendar (therapist): only bookings with the staff profile linked to this member. */
  ownMemberId?: string | null
  /** Own-only applies only when that member has a linked staff profile (non-managers; therapists are strict). */
  ownIfLinked?: boolean
  /** Which counts the viewer may see (others come back 0 without being queried). */
  calendar: boolean
  outbox: boolean
  instagram: boolean
  /** F28: the viewer's member id — due messages assigned to them are counted as `outboxMine`. */
  assigneeMemberId?: string | null
  /** F15: new website enquiries (clients.view). */
  enquiries?: boolean
}

export type NavCounts = {
  /** Today's bookings (business date per branch cutoff), not cancelled / no-show. */
  today: number
  /** Today's bookings still pending confirmation. */
  pending: number
  /** WhatsApp messages due to send now. */
  outboxDue: number
  /** Instagram threads with an unread customer message. */
  igUnread: number
  /** WhatsApp messages due now that are assigned to the viewer (F28). */
  outboxMine: number
  /** New (unanswered) website enquiries (F15). */
  enquiriesNew: number
}

/** Sidebar badges in one round trip (scalar subqueries; disabled parts are literal zeros). */
export async function navCounts(tx: Tx, q: NavCountsQuery): Promise<NavCounts> {
  const now = (q.now ?? new Date()).toISOString()
  const zero = sql`0`
  const inBranches = (col: SQL) =>
    q.branchIds === null ? sql`true` : q.branchIds.length ? sql`${col} in ${q.branchIds}` : sql`false`

  let today: SQL = zero
  let pending: SQL = zero
  if (q.calendar) {
    const mine = sql`exists (select 1 from booking_items bi join staff s on s.id = any(bi.staff_ids)
          where bi.booking_id = b.id and s.member_id = ${q.ownMemberId}::uuid)`
    const own = !q.ownMemberId
      ? sql``
      : q.ownIfLinked
        ? sql`and (not exists (select 1 from staff where member_id = ${q.ownMemberId}::uuid) or ${mine})`
        : sql`and ${mine}`
    const day = sql`from bookings b join branches br on br.id = b.branch_id
      where b.business_date = ((${now}::timestamptz at time zone 'Asia/Dubai') - br.business_day_cutoff::interval)::date
        and ${inBranches(sql`b.branch_id`)} ${own}`
    today = sql`(select count(*) ${day} and b.status not in ('cancelled', 'no_show'))`
    pending = sql`(select count(*) ${day} and b.status = 'pending')`
  }
  const dueWhere = and(
    inArray(outbox.status, ['queued', 'opened']),
    sql`${outbox.dueAt} <= ${now}::timestamptz`,
    sql`not ${campaignConsentWithdrawn()}`,
    outboxBookingLive(),
    q.branchIds === null
      ? undefined
      : sql`(${outbox.branchId} is null or ${inBranches(sql`${outbox.branchId}`)})`,
  )
  const outboxDue = q.outbox ? sql`(select count(*) from ${outbox} where ${dueWhere})` : zero
  const outboxMine =
    q.outbox && q.assigneeMemberId
      ? sql`(select count(*) from ${outbox} where ${and(dueWhere, eq(outbox.assignedTo, q.assigneeMemberId))})`
      : zero
  const igUnread = q.instagram
    ? sql`(select count(*) from ${conversations} where ${and(
        inArray(conversations.channel, CHANNELS),
        sql`${conversations.lastCustomerMsgAt} is not null`,
        sql`(${conversations.readAt} is null or ${conversations.lastCustomerMsgAt} > ${conversations.readAt})`,
      )})`
    : zero
  const enquiriesNew = q.enquiries
    ? sql`(select count(*) from ${siteEnquiries} where ${eq(siteEnquiries.status, 'new')})`
    : zero
  const res = await tx.execute(
    sql`select ${today}::int as today, ${pending}::int as pending, ${outboxDue}::int as outbox, ${igUnread}::int as ig,
      ${outboxMine}::int as mine, ${enquiriesNew}::int as enquiries`,
  )
  const row = res.rows[0] as
    | { today: number; pending: number; outbox: number; ig: number; mine: number; enquiries: number }
    | undefined
  return {
    today: Number(row?.today ?? 0),
    pending: Number(row?.pending ?? 0),
    outboxDue: Number(row?.outbox ?? 0),
    igUnread: Number(row?.ig ?? 0),
    outboxMine: Number(row?.mine ?? 0),
    enquiriesNew: Number(row?.enquiries ?? 0),
  }
}
