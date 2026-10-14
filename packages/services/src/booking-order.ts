// R32 booking ↔ sale = one order (owner 2026-10-14, PLAN §14.8 R32). Confirm sets the fee (`booking_items.price_aed`)
// and the planned commission (`booking_items.commission_aed`, off the ledger); Finish = checkout of the booking
// (createSale + recordBookingCommissions in one transaction); Correct payment = void + re-create on the same business
// date (append-only ledger). Permission, day-lock and audit checks are the caller's (web server/day-lock.ts).
import { BOOKING_CLIENT_TYPES, type BookingClientType, isPhoneLine } from '@spa/core'
import { bookingItems, bookings, payments, saleLines, sales, staff, type Tx, tips } from '@spa/db'
import { and, asc, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { type CommissionInput, commissionTotals, recordBookingCommissions } from './booking-commissions'
import { termsAmount } from './bookings'
import { DomainError } from './errors'
import {
  branchBusinessDate,
  createSale,
  DAY_CLOSED,
  isDayClosed,
  type NewSale,
  type NewSaleLine,
  voidSale,
} from './sales'

/** Fee + planned commission of one booking item; `commissionAed` undefined = keep what is stored. */
export type ItemTerms = { bookingItemId: string; feeAed: number; commissionAed?: number | null }
type Booking = typeof bookings.$inferSelect
type Sale = typeof sales.$inferSelect

const num = (v: string | number | null | undefined) => (v == null ? null : Number(v))
const fils = (n: number) => Math.round(n * 100)
const DEAD = ['cancelled', 'no_show']

async function lockBooking(tx: Tx, bookingId: string) {
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update')
  if (!b) throw new DomainError('Booking not found', 'not_found')
  return b
}

const refuseDead = (b: Booking) => {
  if (DEAD.includes(b.status)) throw new DomainError(`Can't change a ${b.status.replace('_', ' ')} booking`)
}

/** The booking's live (not void) sale, if any. */
export async function liveSale(tx: Tx, bookingId: string): Promise<Sale | null> {
  const [s] = await tx
    .select()
    .from(sales)
    .where(and(eq(sales.bookingId, bookingId), ne(sales.status, 'void')))
  return s ?? null
}

/** Latest typed fee + per-therapist commission per variant (distinct on variant, terms_set_at desc). */
export async function lastBookingTerms(
  tx: Tx,
  variantIds: string[],
): Promise<Map<string, { feeAed: number | null; commissionAed: number | null }>> {
  const ids = [...new Set(variantIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const rows = await tx
    .selectDistinctOn([bookingItems.serviceVariantId], {
      variantId: bookingItems.serviceVariantId,
      fee: bookingItems.priceAed,
      commission: bookingItems.commissionAed,
    })
    .from(bookingItems)
    .where(and(inArray(bookingItems.serviceVariantId, ids), isNotNull(bookingItems.termsSetAt)))
    .orderBy(bookingItems.serviceVariantId, desc(bookingItems.termsSetAt))
  return new Map(rows.map((r) => [r.variantId!, { feeAed: num(r.fee), commissionAed: num(r.commission) }]))
}

const termsOf = (i: typeof bookingItems.$inferSelect): ItemTerms => ({
  bookingItemId: i.id,
  feeAed: num(i.priceAed) ?? 0,
  commissionAed: num(i.commissionAed),
})

/** Before Finish only: sets the fee (price_aed) + planned commission on the items. Locks the booking. */
export async function setBookingTerms(tx: Tx, i: { bookingId: string; items: ItemTerms[]; now?: Date }) {
  const booking = await lockBooking(tx, i.bookingId)
  refuseDead(booking)
  if (await liveSale(tx, booking.id))
    throw new DomainError('This booking was checked out — correct the payment instead')
  const items = await tx
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, booking.id))
    .orderBy(asc(bookingItems.startsAt), asc(bookingItems.id))
  const before: ItemTerms[] = []
  const after: ItemTerms[] = []
  const now = i.now ?? new Date()
  for (const t of i.items) {
    const item = items.find((x) => x.id === t.bookingItemId)
    if (!item) throw new DomainError('Treatment not found', 'not_found')
    const fee = termsAmount(t.feeAed, 'fee')
    const commission =
      t.commissionAed === undefined ? item.commissionAed : termsAmount(t.commissionAed, 'commission')
    before.push(termsOf(item))
    await tx
      .update(bookingItems)
      .set({ priceAed: fee, commissionAed: commission, termsSetAt: now })
      .where(eq(bookingItems.id, item.id))
    after.push({ bookingItemId: item.id, feeAed: num(fee) ?? 0, commissionAed: num(commission) })
  }
  return { booking, before, after }
}

type Details = { phoneLine: number | null; clientType: BookingClientType | null; ownLead: boolean }

/** Phone line / client type / own lead (any status but cancelled/no_show). Locks the booking. */
export async function setBookingDetails(tx: Tx, i: { bookingId: string } & Details) {
  const booking = await lockBooking(tx, i.bookingId)
  refuseDead(booking)
  const before: Details = {
    phoneLine: booking.phoneLine,
    clientType: booking.clientType,
    ownLead: booking.ownLead,
  }
  const after: Details = {
    phoneLine: booking.source === 'phone' && isPhoneLine(i.phoneLine) ? i.phoneLine : null,
    clientType:
      i.clientType && (BOOKING_CLIENT_TYPES as readonly string[]).includes(i.clientType)
        ? i.clientType
        : null,
    ownLead: Boolean(i.ownLead),
  }
  const [updated] = await tx.update(bookings).set(after).where(eq(bookings.id, booking.id)).returning()
  return { booking: updated!, before, after }
}

/** The date the order's rules apply to: the live sale's business date, else the booking's. */
export async function orderDay(tx: Tx, bookingId: string) {
  const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId))
  if (!booking) throw new DomainError('Booking not found', 'not_found')
  const sale = await liveSale(tx, booking.id)
  return { branchId: booking.branchId, date: sale?.businessDate ?? booking.businessDate, sale, booking }
}

/** Every item × therapist of a booking, with the planned commission and the therapist's pay type. */
async function commissionSlots(tx: Tx, bookingId: string) {
  const items = await tx
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, bookingId))
    .orderBy(asc(bookingItems.startsAt), asc(bookingItems.id))
  const ids = [...new Set(items.flatMap((i) => i.staffIds))]
  const pay = new Map(
    (ids.length
      ? await tx.select({ id: staff.id, payType: staff.payType }).from(staff).where(inArray(staff.id, ids))
      : []
    ).map((s) => [s.id, s.payType]),
  )
  return {
    items,
    slots: items.flatMap((item) =>
      item.staffIds.map((staffId) => ({ item, staffId, pay: pay.get(staffId) })),
    ),
  }
}

/**
 * FINISH (D3, D5): the booking's checkout — createSale + recordBookingCommissions in one transaction. The sale is
 * dated the booking's business day when that day has started and is not closed, else today's. Commission per item ×
 * therapist = the typed amount, else the planned one, else 0 for someone not paid per booking; otherwise refused.
 */
export async function finishBooking(
  tx: Tx,
  i: NewSale & { bookingId: string; commissions?: CommissionInput[]; userId?: string | null; now?: Date },
) {
  const now = i.now ?? new Date()
  const [peek] = await tx.select().from(bookings).where(eq(bookings.id, i.bookingId))
  if (!peek) throw new DomainError('Booking not found', 'not_found')
  if (peek.branchId !== i.branchId) throw new DomainError('That booking belongs to another branch')
  const today = await branchBusinessDate(tx, peek.branchId, now)
  // Day lock first (advisory), then the booking row — the order every day edit uses.
  const date =
    peek.businessDate <= today && !(await isDayClosed(tx, peek.branchId, peek.businessDate, { lock: true }))
      ? peek.businessDate
      : today
  const booking = await lockBooking(tx, peek.id)
  if (!['confirmed', 'checked_in', 'in_service', 'completed'].includes(booking.status))
    throw new DomainError(`A ${booking.status.replace('_', ' ')} booking can't be checked out`)
  const { items, slots } = await commissionSlots(tx, peek.id)
  const given = new Map((i.commissions ?? []).map((c) => [`${c.bookingItemId}:${c.staffId}`, c.amountAed]))
  const amounts: CommissionInput[] = slots.map(({ item, staffId, pay }) => {
    const typed = given.get(`${item.id}:${staffId}`)
    const amount = typed ?? num(item.commissionAed) ?? (pay !== 'booking_commission' ? 0 : null)
    if (amount == null) throw new DomainError('Enter the commission for every therapist')
    return { bookingItemId: item.id, staffId, amountAed: amount }
  })
  for (const key of given.keys())
    if (!slots.some((s) => `${s.item.id}:${s.staffId}` === key))
      throw new DomainError('Therapist not found', 'not_found')
  const { sale, lines, message } = await createSale(tx, { ...i, businessDate: date, now })
  for (const item of items) {
    const first = amounts.find((a) => a.bookingItemId === item.id)
    if (!first) continue
    await tx
      .update(bookingItems)
      .set({ commissionAed: (Math.round(first.amountAed * 100) / 100).toFixed(2), termsSetAt: now })
      .where(eq(bookingItems.id, item.id))
  }
  if (amounts.length)
    await recordBookingCommissions(tx, { bookingId: peek.id, amounts, userId: i.userId, now })
  return { sale, lines, message, saleDate: date, commissions: amounts }
}

type OrderSnapshot = {
  saleId: string | null
  saleNumber: number | null
  lines: { saleLineId: string; description: string; unitPriceAed: number }[]
  payments: { method: string; amountAed: number }[]
  tips: { staffId: string; amountAed: number; method: string }[]
  commissions: CommissionInput[]
}

async function snapshot(tx: Tx, bookingId: string, sale: Sale | null): Promise<OrderSnapshot> {
  const totals = await commissionTotals(tx, bookingId)
  const commissions = [...totals].map(([key, v]) => {
    const [bookingItemId, staffId] = key.split(':') as [string, string]
    return { bookingItemId, staffId, amountAed: v / 100 }
  })
  if (!sale) return { saleId: null, saleNumber: null, lines: [], payments: [], tips: [], commissions }
  const ls = await tx.select().from(saleLines).where(eq(saleLines.saleId, sale.id)).orderBy(asc(saleLines.id))
  const ps = await tx
    .select()
    .from(payments)
    .where(eq(payments.saleId, sale.id))
    .orderBy(asc(payments.createdAt))
  const ts = await tx.select().from(tips).where(eq(tips.saleId, sale.id)).orderBy(asc(tips.createdAt))
  return {
    saleId: sale.id,
    saleNumber: sale.number,
    lines: ls.map((l) => ({
      saleLineId: l.id,
      description: l.description,
      unitPriceAed: Number(l.unitPriceAed),
    })),
    payments: ps.map((p) => ({ method: p.method, amountAed: Number(p.amountAed) })),
    tips: ts.map((t) => ({ staffId: t.staffId, amountAed: Number(t.amountAed), method: t.method })),
    commissions,
  }
}

const sameMoney = <T extends { amountAed: number }>(a: T[], b: T[], key: (x: T) => string) => {
  const norm = (xs: T[]) =>
    xs
      .map((x) => `${key(x)}=${fils(x.amountAed)}`)
      .sort()
      .join('|')
  return norm(a) === norm(b)
}

/**
 * Correct payment (D4): new line prices / payments / tips → void the live sale ("Corrected: …") and re-create it on
 * the SAME business date in this transaction; commission changes post only the differences. A closed day needs
 * `allowClosedDay` (pos.correct). Prepaid, gift-card and refunded sales are refused by voidSale with its texts.
 */
export async function correctBookingOrder(
  tx: Tx,
  i: {
    bookingId: string
    reason: string
    lines?: { saleLineId: string; unitPriceAed: number }[]
    payments?: NewSale['payments']
    tips?: NewSale['tips']
    commissions?: CommissionInput[]
    allowClosedDay?: boolean
    userId?: string | null
    now?: Date
  },
) {
  const booking = await lockBooking(tx, i.bookingId)
  const old = await liveSale(tx, booking.id)
  if (!old) throw new DomainError('This booking has no payment to correct')
  const reason = i.reason.trim()
  if (reason.length < 3) throw new DomainError('Give a reason for the correction')
  if ((await isDayClosed(tx, old.branchId, old.businessDate, { lock: true })) && !i.allowClosedDay)
    throw new DomainError(DAY_CLOSED)
  const before = await snapshot(tx, booking.id, old)
  const oldLines = await tx
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, old.id))
    .orderBy(asc(saleLines.id))
  const price = new Map((i.lines ?? []).map((l) => [l.saleLineId, l.unitPriceAed]))
  for (const id of price.keys())
    if (!oldLines.some((l) => l.id === id)) throw new DomainError('Sale line not found', 'not_found')
  const newLines: NewSaleLine[] = oldLines.map((l) => ({
    kind: l.kind as NewSaleLine['kind'],
    refId: l.refId,
    description: l.description,
    qty: l.qty,
    unitPriceAed: price.get(l.id) ?? Number(l.unitPriceAed),
    discountAed: Number(l.discountAed),
    staffId: l.staffId,
  }))
  const newPayments =
    i.payments ??
    before.payments.map((p) => ({ ...p, method: p.method as NewSale['payments'][number]['method'] }))
  const newTips =
    i.tips ??
    before.tips.map((t) => ({ ...t, method: t.method as NonNullable<NewSale['tips']>[number]['method'] }))
  const linesChanged = oldLines.some(
    (l, n) => fils(newLines[n]!.unitPriceAed) !== fils(Number(l.unitPriceAed)),
  )
  const moneyChanged =
    linesChanged ||
    !sameMoney(before.payments, newPayments, (p) => p.method) ||
    !sameMoney(before.tips, newTips, (t) => `${t.staffId}:${t.method}`)
  let sale = old
  let voidedSaleId: string | null = null
  if (moneyChanged) {
    await voidSale(tx, {
      saleId: old.id,
      reason: `Corrected: ${reason}`,
      userId: i.userId,
      allowClosedDay: i.allowClosedDay,
    })
    voidedSaleId = old.id
    const created = await createSale(tx, {
      tenantId: old.tenantId,
      branchId: old.branchId,
      clientId: old.clientId,
      bookingId: booking.id,
      lines: newLines,
      discountAed: Number(old.discountAed),
      payments: newPayments,
      tips: newTips,
      businessDate: old.businessDate,
      allowClosedDay: i.allowClosedDay,
      createdBy: i.userId ?? null,
      now: i.now,
    })
    sale = created.sale
    // G16 billing details printed on the full tax invoice stay with the order.
    if (old.billing)
      [sale] = (await tx
        .update(sales)
        .set({ billing: old.billing })
        .where(eq(sales.id, sale.id))
        .returning()) as [Sale]
  }
  if (i.commissions) {
    const had = new Map(before.commissions.map((c) => [`${c.bookingItemId}:${c.staffId}`, fils(c.amountAed)]))
    if (i.commissions.some((c) => had.get(`${c.bookingItemId}:${c.staffId}`) !== fils(c.amountAed)))
      await recordBookingCommissions(tx, {
        bookingId: booking.id,
        amounts: i.commissions,
        userId: i.userId,
        now: i.now,
      })
  }
  const after = await snapshot(tx, booking.id, sale)
  return { before, after, voidedSaleId, sale }
}

/** The order's live sale with its lines, payments and tips (booking page), or null before Finish. */
export async function orderSale(tx: Tx, bookingId: string) {
  const sale = await liveSale(tx, bookingId)
  if (!sale) return null
  const snap = await snapshot(tx, bookingId, sale)
  const sum = (m: (method: string) => boolean) =>
    snap.payments.filter((p) => m(p.method)).reduce((s, p) => s + fils(p.amountAed), 0) / 100
  return {
    sale,
    ...snap,
    cashAed: sum((m) => m === 'cash'),
    cardAed: sum((m) => m === 'card_terminal'),
    otherAed: sum((m) => m !== 'cash' && m !== 'card_terminal'),
    tipsAed: snap.tips.reduce((s, t) => s + fils(t.amountAed), 0) / 100,
  }
}
