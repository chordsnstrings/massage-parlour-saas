// Bookings list + detail for the spa dashboard (PLAN §14.8 R2). Callers pass the branches the member may see.
import {
  bookingCommissions,
  bookingItems,
  bookingPartners,
  bookings,
  branches,
  clients,
  payments,
  saleLines,
  sales,
  staff,
  type Tx,
} from '@spa/db'
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
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

/** R45: the booking's live sale (Finish / Complete & pay); null = not paid yet. */
export type RowSale = { id: string; number: number; totalAed: string; status: string; methods: string[] }

/** Live (not void) sales of these bookings + their payment methods, by booking id. */
async function liveSales(tx: Tx, bookingIds: string[]) {
  const out = new Map<string, RowSale>()
  if (!bookingIds.length) return out
  const rows = await tx
    .select({
      id: sales.id,
      bookingId: sales.bookingId,
      number: sales.number,
      totalAed: sales.totalAed,
      status: sales.status,
    })
    .from(sales)
    .where(and(inArray(sales.bookingId, bookingIds), ne(sales.status, 'void')))
  const methods = await paymentMethods(
    tx,
    rows.map((r) => r.id),
  )
  for (const r of rows)
    out.set(r.bookingId!, {
      id: r.id,
      number: r.number,
      totalAed: r.totalAed,
      status: r.status,
      methods: methods.get(r.id) ?? [],
    })
  return out
}

async function paymentMethods(tx: Tx, saleIds: string[]) {
  const out = new Map<string, string[]>()
  if (!saleIds.length) return out
  const rows = await tx
    .selectDistinct({ saleId: payments.saleId, method: payments.method })
    .from(payments)
    .where(inArray(payments.saleId, saleIds))
  for (const r of rows) out.set(r.saleId, [...(out.get(r.saleId) ?? []), r.method])
  return out
}

/** Bookings by business date range (newest first) with client, services, therapists and recorded commission. */
export async function listBookings(tx: Tx, f: BookingListFilter) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100)
  const page = Math.max(f.page ?? 1, 1)
  const { rows, total } = await bookingRows(tx, f, { limit: pageSize, offset: (page - 1) * pageSize })
  return { rows, total, page, pageSize }
}

async function bookingRows(tx: Tx, f: BookingListFilter, w: { limit: number; offset: number }) {
  if (!f.branchIds.length) return { rows: [], total: 0 }
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
    .limit(w.limit)
    .offset(w.offset)
  const sold = await liveSales(
    tx,
    rows.map((r) => r.id),
  )
  return {
    rows: rows.map(({ needsStaff, ...r }) => ({
      ...r,
      commissionMissing: r.status === 'completed' && needsStaff && r.commissionAed === null,
      sale: sold.get(r.id) ?? null,
    })),
    total: count?.total ?? 0,
  }
}

export type BookingListRow = Awaited<ReturnType<typeof bookingRows>>['rows'][number]

/** R45: a sale made at the counter without a booking (products, gift cards, packages, memberships, walk-in sales). */
export type CounterSaleRow = {
  id: string
  number: number
  createdAt: Date
  businessDate: string
  branchName: string
  clientName: string | null
  items: string[]
  staffIds: string[]
  totalAed: string
  status: string
  methods: string[]
}

async function counterSales(
  tx: Tx,
  f: Pick<BookingListFilter, 'from' | 'to' | 'branchIds'>,
  w: { limit: number; offset: number },
) {
  if (!f.branchIds.length) return { rows: [] as CounterSaleRow[], total: 0 }
  const where = and(
    isNull(sales.bookingId),
    inArray(sales.branchId, f.branchIds),
    sql`${sales.businessDate} between ${f.from} and ${f.to}`,
  )
  const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(sales).where(where)
  const rows = await tx
    .select({
      id: sales.id,
      number: sales.number,
      createdAt: sales.createdAt,
      businessDate: sales.businessDate,
      branchName: branches.name,
      clientName: clients.name,
      totalAed: sales.totalAed,
      status: sales.status,
    })
    .from(sales)
    .innerJoin(branches, eq(branches.id, sales.branchId))
    .leftJoin(clients, eq(clients.id, sales.clientId))
    .where(where)
    .orderBy(desc(sales.createdAt), sales.id)
    .limit(w.limit)
    .offset(w.offset)
  const ids = rows.map((r) => r.id)
  const lines = ids.length
    ? await tx
        .select({ saleId: saleLines.saleId, description: saleLines.description, staffId: saleLines.staffId })
        .from(saleLines)
        .where(inArray(saleLines.saleId, ids))
        .orderBy(asc(saleLines.id))
    : []
  const methods = await paymentMethods(tx, ids)
  return {
    rows: rows.map(
      (r): CounterSaleRow => ({
        ...r,
        items: lines.filter((l) => l.saleId === r.id).map((l) => l.description),
        staffIds: [...new Set(lines.flatMap((l) => (l.saleId === r.id && l.staffId ? [l.staffId] : [])))],
        methods: methods.get(r.id) ?? [],
      }),
    ),
    total: count?.total ?? 0,
  }
}

export type BookingsAndSalesRow = ({ kind: 'booking' } & BookingListRow) | ({ kind: 'sale' } & CounterSaleRow)

/**
 * R45 "Bookings & sales" (owner 2026-11-02: our sales are the bookings): the bookings of the range, each with its
 * sale, and — when no booking filter is set (status, source, therapist, commission missing) — the counter sales
 * without a booking, newest first in one list (bookings by start time, counter sales by the time they were made).
 */
export async function listBookingsAndSales(tx: Tx, f: BookingListFilter) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100)
  const page = Math.max(f.page ?? 1, 1)
  const withCounter = !f.statuses?.length && !f.source && !f.staffId && !f.commissionMissing
  if (!withCounter) {
    const r = await bookingRows(tx, f, { limit: pageSize, offset: (page - 1) * pageSize })
    return {
      rows: r.rows.map((x): BookingsAndSalesRow => ({ kind: 'booking', ...x })),
      total: r.total,
      page,
      pageSize,
    }
  }
  // Both lists are newest first: the first page × size of each holds every row of this page of the merge.
  const window = { limit: page * pageSize, offset: 0 }
  const [b, c] = [await bookingRows(tx, f, window), await counterSales(tx, f, window)]
  const merged: BookingsAndSalesRow[] = [
    ...b.rows.map((x) => ({ kind: 'booking' as const, ...x })),
    ...c.rows.map((x) => ({ kind: 'sale' as const, ...x })),
  ].sort((x, y) => when(y) - when(x))
  return {
    rows: merged.slice((page - 1) * pageSize, page * pageSize),
    total: b.total + c.total,
    page,
    pageSize,
  }
}

const when = (r: BookingsAndSalesRow) => (r.kind === 'booking' ? r.startsAt : r.createdAt).getTime()

/**
 * R45 money of a business-date range (the dashboard's rule: paid sales by their business date): revenue, sales,
 * tips, paid by method, and the completed bookings with no live sale ("Not paid").
 */
export async function rangeMoney(tx: Tx, f: Pick<BookingListFilter, 'from' | 'to' | 'branchIds'>) {
  const empty = {
    revenueAed: 0,
    salesCount: 0,
    tipsAed: 0,
    byMethod: {} as Record<string, number>,
    notPaid: 0,
  }
  if (!f.branchIds.length) return empty
  const inRange = and(
    eq(sales.status, 'paid'),
    inArray(sales.branchId, f.branchIds),
    sql`${sales.businessDate} between ${f.from} and ${f.to}`,
  )
  const [money] = await tx
    .select({
      revenue: sql<string>`coalesce(sum(${sales.totalAed}), 0)`,
      n: sql<number>`count(*)::int`,
      tips: sql<string>`coalesce(sum(${sales.tipsAed}), 0)`,
    })
    .from(sales)
    .where(inRange)
  const methods = await tx
    .select({ method: payments.method, v: sql<string>`sum(${payments.amountAed})` })
    .from(payments)
    .innerJoin(sales, eq(sales.id, payments.saleId))
    .where(inRange)
    .groupBy(payments.method)
  const [unpaid] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, 'completed'),
        inArray(bookings.branchId, f.branchIds),
        sql`${bookings.businessDate} between ${f.from} and ${f.to}`,
        sql`not exists (select 1 from ${sales} s where s.booking_id = ${bookings.id} and s.status <> 'void')`,
      ),
    )
  return {
    revenueAed: Number(money?.revenue ?? 0),
    salesCount: money?.n ?? 0,
    tipsAed: Number(money?.tips ?? 0),
    byMethod: Object.fromEntries(methods.map((m) => [m.method, Number(m.v)])),
    notPaid: unpaid?.n ?? 0,
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
      /** F16: the partner poster the online booker came through. */
      partnerName: bookingPartners.name,
    })
    .from(bookings)
    .innerJoin(branches, eq(branches.id, bookings.branchId))
    .leftJoin(clients, eq(clients.id, bookings.clientId))
    .leftJoin(bookingPartners, eq(bookingPartners.id, bookings.partnerId))
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
    partnerName: b.partnerName,
    clientName: b.clientName,
    clientPhone: b.clientPhone,
    commissionEntered: totals.size > 0,
    items: items.map((i) => ({
      id: i.id,
      serviceName: i.serviceName,
      durationMin: i.durationMin,
      priceAed: i.priceAed,
      startsAt: i.startsAt,
      /** R32: the treatment (last-terms prefill), the planned commission and whether the terms were typed. */
      serviceVariantId: i.serviceVariantId,
      plannedCommissionAed: i.commissionAed,
      termsSet: i.termsSetAt !== null,
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
