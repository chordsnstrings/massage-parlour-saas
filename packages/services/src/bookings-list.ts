// Bookings list + detail for the spa dashboard (PLAN §14.8 R2). Callers pass the branches the member may see.
import { bookingCommissions, bookingItems, bookings, branches, clients, staff, type Tx } from '@spa/db'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { commissionTotals } from './booking-commissions'

type BookingRow = typeof bookings.$inferSelect

export type BookingListFilter = {
  from: string
  to: string
  branchIds: string[]
  statuses?: BookingRow['status'][]
  source?: BookingRow['source']
  staffId?: string
  /** Completed bookings with therapists but no commission entered yet (e.g. completed by a POS checkout). */
  commissionMissing?: boolean
  page?: number
  pageSize?: number
}

/** Bookings by business date range (newest first) with client, services, therapists and recorded commission. */
export async function listBookings(tx: Tx, f: BookingListFilter) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100)
  const page = Math.max(f.page ?? 1, 1)
  if (!f.branchIds.length) return { rows: [], total: 0, page, pageSize }
  const hasStaff = sql`exists (select 1 from ${bookingItems} bi where bi.booking_id = ${bookings.id} and cardinality(bi.staff_ids) > 0)`
  const entered = sql`exists (select 1 from ${bookingCommissions} bc where bc.booking_id = ${bookings.id})`
  const where = and(
    inArray(bookings.branchId, f.branchIds),
    sql`${bookings.businessDate} between ${f.from} and ${f.to}`,
    f.statuses?.length ? inArray(bookings.status, f.statuses) : undefined,
    f.source ? eq(bookings.source, f.source) : undefined,
    f.staffId
      ? sql`exists (select 1 from ${bookingItems} bi where bi.booking_id = ${bookings.id} and ${f.staffId}::uuid = any(bi.staff_ids))`
      : undefined,
    f.commissionMissing ? and(eq(bookings.status, 'completed'), hasStaff, sql`not ${entered}`) : undefined,
  )
  const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(bookings).where(where)
  const rows = await tx
    .select({
      id: bookings.id,
      refCode: bookings.refCode,
      status: bookings.status,
      source: bookings.source,
      attribution: bookings.attribution,
      businessDate: bookings.businessDate,
      startsAt: bookings.startsAt,
      branchId: bookings.branchId,
      branchName: branches.name,
      clientName: clients.name,
      services: sql<
        string[]
      >`(select coalesce(array_agg(bi.service_name order by bi.starts_at), '{}') from ${bookingItems} bi where bi.booking_id = ${bookings.id})`,
      staffIds: sql<
        string[]
      >`(select coalesce(array_agg(distinct s), '{}') from ${bookingItems} bi, unnest(bi.staff_ids) s where bi.booking_id = ${bookings.id})`,
      totalAed: sql<string>`(select coalesce(sum(bi.price_aed), 0) from ${bookingItems} bi where bi.booking_id = ${bookings.id})`,
      commissionAed: sql<
        string | null
      >`(select sum(bc.amount_aed) from ${bookingCommissions} bc where bc.booking_id = ${bookings.id})`,
      needsStaff: sql<boolean>`${hasStaff}`,
    })
    .from(bookings)
    .innerJoin(branches, eq(branches.id, bookings.branchId))
    .leftJoin(clients, eq(clients.id, bookings.clientId))
    .where(where)
    .orderBy(sql`${bookings.startsAt} desc`, bookings.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  return {
    rows: rows.map(({ needsStaff, ...r }) => ({
      ...r,
      commissionMissing: r.status === 'completed' && needsStaff && r.commissionAed === null,
    })),
    total: count?.total ?? 0,
    page,
    pageSize,
  }
}

/** One booking with its items, therapists and the current commission per item + therapist (null = not entered). */
export async function bookingDetail(tx: Tx, bookingId: string) {
  const [b] = await tx
    .select({
      booking: bookings,
      branchName: branches.name,
      clientName: clients.name,
      clientPhone: clients.phoneE164,
    })
    .from(bookings)
    .innerJoin(branches, eq(branches.id, bookings.branchId))
    .leftJoin(clients, eq(clients.id, bookings.clientId))
    .where(eq(bookings.id, bookingId))
  if (!b) return null
  const items = await tx
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, bookingId))
    .orderBy(asc(bookingItems.startsAt))
  const totals = await commissionTotals(tx, bookingId)
  const staffIds = [...new Set(items.flatMap((i) => i.staffIds))]
  const people = staffIds.length
    ? await tx
        .select({ id: staff.id, name: staff.displayName, color: staff.color, photoUrl: staff.photoUrl })
        .from(staff)
        .where(inArray(staff.id, staffIds))
    : []
  return {
    ...b.booking,
    branchName: b.branchName,
    clientName: b.clientName,
    clientPhone: b.clientPhone,
    commissionEntered: totals.size > 0,
    items: items.map((i) => ({
      id: i.id,
      serviceName: i.serviceName,
      durationMin: i.durationMin,
      priceAed: i.priceAed,
      startsAt: i.startsAt,
      therapists: i.staffIds.map((id) => {
        const p = people.find((x) => x.id === id)
        const v = totals.get(`${i.id}:${id}`)
        return {
          staffId: id,
          name: p?.name ?? null,
          color: p?.color ?? null,
          photoUrl: p?.photoUrl ?? null,
          commissionAed: v === undefined ? null : v / 100,
        }
      }),
    })),
  }
}
