// R36 spa dashboard home (owner 2026-10-21, PLAN §14.8 R36): "Today's bookings & sales" (one business date of
// bookings + the sales of that date not on one of its bookings), "From the website" (online bookings waiting for
// confirmation + new website enquiries) and a cheap fingerprint the page polls to refresh both. Permissions stay in
// the caller (money = dashboard.revenue or pos.use; actions their own).
import {
  bookingItems,
  bookings,
  clients,
  payments,
  saleLines,
  sales,
  siteEnquiries,
  staff,
  type Tx,
} from '@spa/db'
import { and, asc, type Column, eq, gte, inArray, ne, or, type SQL, sql } from 'drizzle-orm'
import { websiteHours } from './site-crm-feed'
import {
  type EnquiryHours,
  listSiteEnquiries,
  type SiteEnquiry,
  type SiteEnquiryBooked,
  siteEnquiryBookings,
} from './site-enquiries'

type BookingRow = typeof bookings.$inferSelect
export type TodayBookingStatus = BookingRow['status']

/** Filter chips in order (All comes first, on top of these). */
export const TODAY_STAGES = ['to_confirm', 'to_finish', 'not_paid', 'paid', 'cancelled'] as const
export type TodayStage = (typeof TODAY_STAGES)[number]

export type TodayMethods = { cash: number; card: number; other: number }

/** A row's live (non-void) sale. */
export type TodayOrderSale = {
  id: string
  number: number
  status: 'open' | 'paid' | 'refunded'
  totalAed: number
  businessDate: string
  /** When it was taken ("Finished 14:20"). */
  createdAt: Date
  /** 'here' = dated on the chosen date, 'other_day' = another business date ("Paid on …"), 'no' = still open. */
  paidOn: 'here' | 'other_day' | 'no'
  /** What was paid by method (card = own card terminal; other = bank transfer, gift card, package credit, other). */
  methods: TodayMethods
}

export type TodayOrderRow = {
  kind: 'booking' | 'sale'
  /** Unique row key ('b:{bookingId}' | 's:{saleId}'). */
  key: string
  /** Booking rows: the booking. Sale rows: the other day's booking the sale is on, else null (shop / walk-in sale). */
  bookingId: string | null
  refCode: string | null
  /** The booking's business date (another day on a sale row of an earlier / later booking). */
  bookingDate: string | null
  saleId: string | null
  saleNumber: number | null
  /** Booking start, or the sale's created time. */
  startsAt: Date
  endsAt: Date | null
  /** Booking ended by `now` (sale rows: true). */
  ended: boolean
  branchId: string
  /** First word of the client's name (no surnames on the dashboard), null = walk-in / no client. */
  clientFirstName: string | null
  /** Booking source (online = Website); null on sale rows. */
  source: BookingRow['source'] | null
  /** Booking status; null on sale rows. */
  status: TodayBookingStatus | null
  stage: TodayStage
  /** For the note line: when the booking was made ("Booked online 09:42"). Null on sale rows. */
  bookedAt: Date | null
  clientType: BookingRow['clientType'] | null
  cancelReason: string | null
  notes: string | null
  /** Booking items (minutes) or sale lines (minutes null). */
  services: { name: string; minutes: number | null }[]
  staff: string[]
  /** Booking: sum of booking_items.price_aed. Sale row: the sale total. 0 when money is hidden. */
  feeAed: number
  /** A booking item has no fee yet (R32 null price). */
  feeMissing: boolean
  sale: TodayOrderSale | null
}

export type TodayOrders = {
  date: string
  rows: TodayOrderRow[]
  totals: {
    /** Fees of bookings not cancelled / no-show. */
    booked: { aed: number; count: number }
    /** Paid sales of the date = the Revenue KPI for that one date (kpis(): status 'paid', sales.business_date). */
    paid: { aed: number; cash: number; card: number; other: number }
    /** Rows in stage not_paid (finished without a paid sale, or an open sale). */
    notPaid: { aed: number; count: number }
    /** Pending + confirmed / checked-in / in-service bookings without a sale. */
    toFinish: { aed: number; count: number }
  }
  counts: Record<TodayStage | 'all', number>
}

const fils = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100)
const aed = (f: number) => f / 100
const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null
const emptyMethods = (): TodayMethods => ({ cash: 0, card: 0, other: 0 })
const asDate = (d: string) => sql`${d}::date`

/** null = every branch (as kpis() without a branch); [] = none. */
const inBranches = (col: Column, ids: string[] | null): SQL | undefined =>
  ids === null ? undefined : ids.length ? inArray(col, ids) : sql`false`

/**
 * Stage of a row (R36 filter chips). Cancelled / no-show first; then the live sale: open = not paid, paid or
 * refunded = paid (the order is settled: a refunded sale shows as Refunded and, like the Revenue KPI, stays out of
 * the Paid total); no sale: pending = to confirm, completed = not paid, confirmed / checked-in / in service = to finish.
 */
export function todayStage(status: TodayBookingStatus | null, sale: { status: string } | null): TodayStage {
  if (status === 'cancelled' || status === 'no_show') return 'cancelled'
  if (sale) return sale.status === 'open' ? 'not_paid' : 'paid'
  if (status === 'pending') return 'to_confirm'
  if (status === 'completed') return 'not_paid'
  return 'to_finish'
}

/** Service lines + therapist names of bookings (in start order), and fee in fils, in two queries. */
async function bookingDetails(tx: Tx, bookingIds: string[], extraStaff: string[] = []) {
  const items = bookingIds.length
    ? await tx
        .select({
          bookingId: bookingItems.bookingId,
          name: bookingItems.serviceName,
          minutes: bookingItems.durationMin,
          priceAed: bookingItems.priceAed,
          staffIds: bookingItems.staffIds,
        })
        .from(bookingItems)
        .where(inArray(bookingItems.bookingId, bookingIds))
        .orderBy(asc(bookingItems.startsAt), asc(bookingItems.id))
    : []
  const ids = [...new Set([...items.flatMap((i) => i.staffIds), ...extraStaff])]
  const names = new Map(
    ids.length
      ? (
          await tx.select({ id: staff.id, name: staff.displayName }).from(staff).where(inArray(staff.id, ids))
        ).map((s) => [s.id, s.name])
      : [],
  )
  const of = new Map<
    string,
    { services: { name: string; minutes: number | null }[]; staff: string[]; fee: number; missing: boolean }
  >()
  for (const i of items) {
    const d = of.get(i.bookingId) ?? { services: [], staff: [], fee: 0, missing: false }
    d.services.push({ name: i.name, minutes: i.minutes })
    for (const id of i.staffIds) {
      const name = names.get(id)
      if (name && !d.staff.includes(name)) d.staff.push(name)
    }
    if (i.priceAed === null) d.missing = true
    d.fee += fils(i.priceAed)
    of.set(i.bookingId, d)
  }
  return { of, names }
}

/**
 * R36 "Today's bookings & sales" of one business date (branch cutoff already applied by the caller's `date`): one row
 * per booking of the date (every status) and one per live sale of the date that is not on one of those bookings
 * (shop / walk-in sales, or a sale of another day's booking), in time order. `branchIds` as the Revenue KPI's branch:
 * null = the whole spa, else those branches. `money: false` (no dashboard.revenue / pos.use) leaves out sale rows,
 * fees, sales and money totals (counts stay).
 */
export async function todayOrders(
  tx: Tx,
  o: { branchIds: string[] | null; date: string; now?: Date; money?: boolean },
): Promise<TodayOrders> {
  const { date } = o
  const now = o.now ?? new Date()
  const money = o.money ?? true
  const list = await tx
    .select({
      id: bookings.id,
      refCode: bookings.refCode,
      branchId: bookings.branchId,
      status: bookings.status,
      source: bookings.source,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      createdAt: bookings.createdAt,
      clientType: bookings.clientType,
      cancelReason: bookings.cancelReason,
      notes: bookings.notes,
      client: clients.name,
    })
    .from(bookings)
    .leftJoin(clients, eq(clients.id, bookings.clientId))
    .where(and(eq(bookings.businessDate, date), inBranches(bookings.branchId, o.branchIds)))
    .orderBy(asc(bookings.startsAt), asc(bookings.refCode))
  const bookingIds = list.map((b) => b.id)
  const onDay = new Set(bookingIds)

  // Live sales: those dated on the day in these branches (the KPI's), and the live sale of each booking of the day.
  const saleList = await tx
    .select({
      id: sales.id,
      number: sales.number,
      status: sales.status,
      totalAed: sales.totalAed,
      businessDate: sales.businessDate,
      branchId: sales.branchId,
      bookingId: sales.bookingId,
      createdAt: sales.createdAt,
      client: clients.name,
      bookingRef: bookings.refCode,
      bookingDate: bookings.businessDate,
    })
    .from(sales)
    .leftJoin(clients, eq(clients.id, sales.clientId))
    .leftJoin(bookings, eq(bookings.id, sales.bookingId))
    .where(
      and(
        ne(sales.status, 'void'),
        or(
          and(eq(sales.businessDate, date), inBranches(sales.branchId, o.branchIds)),
          bookingIds.length ? inArray(sales.bookingId, bookingIds) : undefined,
        ),
      ),
    )
    .orderBy(asc(sales.createdAt), asc(sales.number))
  const inScope = (s: (typeof saleList)[number]) =>
    s.businessDate === date && (o.branchIds === null || o.branchIds.includes(s.branchId))
  const saleIds = saleList.map((s) => s.id)
  const payRows = saleIds.length
    ? await tx
        .select({
          saleId: payments.saleId,
          method: payments.method,
          v: sql<string>`sum(${payments.amountAed})`,
        })
        .from(payments)
        .where(inArray(payments.saleId, saleIds))
        .groupBy(payments.saleId, payments.method)
    : []
  const methodsOf = new Map<string, TodayMethods>()
  for (const p of payRows) {
    const m = methodsOf.get(p.saleId) ?? emptyMethods()
    const f = fils(p.v)
    if (p.method === 'cash') m.cash += f
    else if (p.method === 'card_terminal') m.card += f
    else m.other += f
    methodsOf.set(p.saleId, m)
  }
  const saleOf = new Map<string, (typeof saleList)[number]>()
  for (const s of saleList) if (s.bookingId && onDay.has(s.bookingId)) saleOf.set(s.bookingId, s)
  const loose = saleList.filter((s) => inScope(s) && !(s.bookingId && onDay.has(s.bookingId)))
  const lines =
    money && loose.length
      ? await tx
          .select({
            saleId: saleLines.saleId,
            description: saleLines.description,
            staffId: saleLines.staffId,
          })
          .from(saleLines)
          .where(
            inArray(
              saleLines.saleId,
              loose.map((s) => s.id),
            ),
          )
          .orderBy(asc(saleLines.saleId), asc(saleLines.id))
      : []
  const { of: detail, names } = await bookingDetails(
    tx,
    bookingIds,
    lines.flatMap((l) => (l.staffId ? [l.staffId] : [])),
  )

  const saleOut = (s: (typeof saleList)[number]): TodayOrderSale => {
    const m = methodsOf.get(s.id) ?? emptyMethods()
    return {
      id: s.id,
      number: s.number,
      status: s.status as TodayOrderSale['status'],
      totalAed: aed(fils(s.totalAed)),
      businessDate: s.businessDate,
      createdAt: s.createdAt,
      paidOn: s.status === 'open' ? 'no' : inScope(s) ? 'here' : 'other_day',
      methods: { cash: aed(m.cash), card: aed(m.card), other: aed(m.other) },
    }
  }

  const fees = new Map<string, number>()
  const rows: TodayOrderRow[] = list.map((b) => {
    const d = detail.get(b.id)
    const s = saleOf.get(b.id) ?? null
    const key = `b:${b.id}`
    fees.set(key, d?.fee ?? 0)
    return {
      kind: 'booking',
      key,
      bookingId: b.id,
      refCode: b.refCode,
      bookingDate: date,
      saleId: money ? (s?.id ?? null) : null,
      saleNumber: money ? (s?.number ?? null) : null,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      ended: b.endsAt <= now,
      branchId: b.branchId,
      clientFirstName: firstName(b.client),
      source: b.source,
      status: b.status,
      stage: todayStage(b.status, s),
      bookedAt: b.createdAt,
      clientType: b.clientType,
      cancelReason: b.cancelReason,
      notes: b.notes,
      services: d?.services ?? [],
      staff: d?.staff ?? [],
      feeAed: money ? aed(d?.fee ?? 0) : 0,
      feeMissing: d?.missing ?? false,
      sale: money && s ? saleOut(s) : null,
    }
  })
  if (money)
    for (const s of loose) {
      const own = lines.filter((l) => l.saleId === s.id)
      const key = `s:${s.id}`
      fees.set(key, fils(s.totalAed))
      rows.push({
        kind: 'sale',
        key,
        bookingId: s.bookingId,
        refCode: s.bookingRef,
        bookingDate: s.bookingDate,
        saleId: s.id,
        saleNumber: s.number,
        startsAt: s.createdAt,
        endsAt: null,
        ended: true,
        branchId: s.branchId,
        clientFirstName: firstName(s.client),
        source: null,
        status: null,
        stage: todayStage(null, s),
        bookedAt: null,
        clientType: null,
        cancelReason: null,
        notes: null,
        services: own.map((l) => ({ name: l.description, minutes: null })),
        staff: [
          ...new Set(own.flatMap((l) => (l.staffId && names.get(l.staffId) ? [names.get(l.staffId)!] : []))),
        ],
        feeAed: aed(fils(s.totalAed)),
        feeMissing: false,
        sale: saleOut(s),
      })
    }
  rows.sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      (a.kind === b.kind ? 0 : a.kind === 'booking' ? -1 : 1) ||
      (a.refCode ?? '').localeCompare(b.refCode ?? '') ||
      (a.saleNumber ?? 0) - (b.saleNumber ?? 0),
  )

  const counts = { all: rows.length, to_confirm: 0, to_finish: 0, not_paid: 0, paid: 0, cancelled: 0 }
  const sum = { booked: 0, bookedN: 0, notPaid: 0, toFinish: 0 }
  for (const r of rows) {
    counts[r.stage] += 1
    const fee = money ? (fees.get(r.key) ?? 0) : 0
    if (r.kind === 'booking' && r.stage !== 'cancelled') {
      sum.booked += fee
      sum.bookedN += 1
    }
    if (r.stage === 'not_paid') sum.notPaid += fee
    if (r.stage === 'to_confirm' || r.stage === 'to_finish') sum.toFinish += fee
  }
  // Paid = the Revenue KPI for this date: sales with status 'paid' on the date in these branches.
  const paid = { aed: 0, ...emptyMethods() }
  if (money)
    for (const s of saleList)
      if (s.status === 'paid' && inScope(s)) {
        const m = methodsOf.get(s.id) ?? emptyMethods()
        paid.aed += fils(s.totalAed)
        paid.cash += m.cash
        paid.card += m.card
        paid.other += m.other
      }
  return {
    date,
    rows,
    totals: {
      booked: { aed: aed(sum.booked), count: sum.bookedN },
      paid: { aed: aed(paid.aed), cash: aed(paid.cash), card: aed(paid.card), other: aed(paid.other) },
      notPaid: { aed: aed(sum.notPaid), count: counts.not_paid },
      toFinish: { aed: aed(sum.toFinish), count: counts.to_confirm + counts.to_finish },
    },
    counts,
  }
}

/** An online booking waiting for confirmation (R36 "From the website"). */
export type PendingOnlineBooking = {
  bookingId: string
  refCode: string
  branchId: string
  businessDate: string
  startsAt: Date
  endsAt: Date
  /** When the visitor booked ("booked 09:42"). */
  bookedAt: Date
  clientFirstName: string | null
  services: { name: string; minutes: number | null }[]
  staff: string[]
  feeAed: number
  feeMissing: boolean
}

/** A new website enquiry with the booking made from it (not cancelled), as the Enquiries page's controls take it. */
export type InboxEnquiry = SiteEnquiry & { booked: SiteEnquiryBooked | null }

export type WebsiteInbox = {
  /** Soonest first, at most `limit`. */
  pendingOnline: PendingOnlineBooking[]
  pendingOnlineCount: number
  /** Newest first, at most `limit` (status new, like the Enquiries page's New filter). */
  enquiries: InboxEnquiry[]
  /** = the Inbox badge's enquiries count (status new). */
  enquiriesNewCount: number
  /** websiteHours(): dates small-hours requests (enquiryNight) and goes into siteEnquiryReplyText. */
  hours: EnquiryHours
}

/**
 * R36 "From the website": online bookings still pending from `today` (business date) on, in these branches (null =
 * every branch), and the newest new website enquiries (listSiteEnquiries + siteEnquiryBookings, as the Enquiries
 * page). `online` / `enquiries` false skip a section the viewer can't see.
 */
export async function websiteInbox(
  tx: Tx,
  o: { branchIds: string[] | null; today: string; limit?: number; online?: boolean; enquiries?: boolean },
): Promise<WebsiteInbox> {
  const limit = o.limit ?? 5
  let pendingOnline: PendingOnlineBooking[] = []
  let pendingOnlineCount = 0
  if (o.online ?? true) {
    const where = and(
      eq(bookings.source, 'online'),
      eq(bookings.status, 'pending'),
      gte(bookings.businessDate, o.today),
      inBranches(bookings.branchId, o.branchIds),
    )
    const list = await tx
      .select({
        id: bookings.id,
        refCode: bookings.refCode,
        branchId: bookings.branchId,
        businessDate: bookings.businessDate,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        createdAt: bookings.createdAt,
        client: clients.name,
        total: sql<number>`count(*) over ()::int`,
      })
      .from(bookings)
      .leftJoin(clients, eq(clients.id, bookings.clientId))
      .where(where)
      .orderBy(asc(bookings.startsAt), asc(bookings.refCode))
      .limit(limit)
    pendingOnlineCount = list[0]?.total ?? 0
    const { of } = await bookingDetails(
      tx,
      list.map((b) => b.id),
    )
    pendingOnline = list.map((b) => {
      const d = of.get(b.id)
      return {
        bookingId: b.id,
        refCode: b.refCode,
        branchId: b.branchId,
        businessDate: b.businessDate,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        bookedAt: b.createdAt,
        clientFirstName: firstName(b.client),
        services: d?.services ?? [],
        staff: d?.staff ?? [],
        feeAed: aed(d?.fee ?? 0),
        feeMissing: d?.missing ?? false,
      }
    })
  }
  let enquiries: InboxEnquiry[] = []
  let enquiriesNewCount = 0
  let hours: EnquiryHours = { openingHours: null, cutoff: null }
  if (o.enquiries ?? true) {
    const list = await listSiteEnquiries(tx, { status: 'new', limit })
    const made = await siteEnquiryBookings(tx, list.rows)
    hours = await websiteHours(tx)
    enquiriesNewCount = list.counts.new
    enquiries = list.rows.map((e) => {
      const k = e.booking?.bookingId ? made.get(e.booking.bookingId) : undefined
      return { ...e, booked: k && k.status !== 'cancelled' ? k : null }
    })
  }
  return { pendingOnline, pendingOnlineCount, enquiries, enquiriesNewCount, hours }
}

/**
 * R36: a short fingerprint (md5 hex) of everything the two dashboard cards show, in one query: the date's bookings
 * (status, client, items: fee, therapists, times), the live sales of the date or of those bookings (status, total,
 * payments), new website enquiries (and their booking's status) and pending online bookings from `today` (default
 * `date`) on. The page polls it and refreshes when it changes.
 */
export async function dashboardPulse(
  tx: Tx,
  o: { branchIds: string[] | null; date: string; today?: string },
): Promise<string> {
  const br = (col: SQL) =>
    o.branchIds === null ? sql`true` : o.branchIds.length ? sql`${col} in ${o.branchIds}` : sql`false`
  const today = o.today ?? o.date
  const dayBookings = sql`select b.id from ${bookings} b where b.business_date = ${asDate(o.date)} and ${br(sql`b.branch_id`)}`
  const res = await tx.execute<{ pulse: string }>(sql`select md5(concat_ws('|',
    coalesce((select string_agg(concat_ws(',', b.id, b.status, b.updated_at, b.client_id, c.name, b.notes, b.cancel_reason), ';' order by b.id)
      from ${bookings} b left join ${clients} c on c.id = b.client_id
      where b.business_date = ${asDate(o.date)} and ${br(sql`b.branch_id`)}), ''),
    coalesce((select string_agg(concat_ws(',', bi.id, bi.price_aed, bi.staff_ids::text, bi.starts_at, bi.duration_min, bi.service_name), ';' order by bi.id)
      from ${bookingItems} bi where bi.booking_id in (${dayBookings})), ''),
    coalesce((select string_agg(concat_ws(',', s.id, s.status, s.total_aed, s.business_date,
        (select string_agg(concat_ws(':', p.method, p.amount_aed), ',' order by p.id) from ${payments} p where p.sale_id = s.id)), ';' order by s.id)
      from ${sales} s where s.status <> 'void'
        and ((s.business_date = ${asDate(o.date)} and ${br(sql`s.branch_id`)}) or s.booking_id in (${dayBookings}))), ''),
    coalesce((select concat_ws(',', count(*), max(e.updated_at), string_agg(lb.status::text, ',' order by e.id))
      from ${siteEnquiries} e
      left join ${bookings} lb on lb.id = case when e.booking->>'bookingId' ~ '^[0-9a-fA-F-]{36}$' then (e.booking->>'bookingId')::uuid end
      where e.status = 'new'), ''),
    coalesce((select string_agg(concat_ws(',', b.id, b.updated_at), ';' order by b.id)
      from ${bookings} b where b.source = 'online' and b.status = 'pending' and b.business_date >= ${asDate(today)}
        and ${br(sql`b.branch_id`)}), '')
  )) as pulse`)
  return res.rows[0]?.pulse ?? ''
}
