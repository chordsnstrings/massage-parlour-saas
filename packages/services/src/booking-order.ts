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
  if (after.ownLead !== booking.ownLead) {
    // A walk-in's own client decided her rotation turn when it started (takeTurn or not); changing it later would
    // leave the rotation wrong, so it is fixed then (R32 review).
    if (booking.source === 'walk_in') throw new DomainError('Own client is set when the walk-in starts')
    if (after.ownLead) {
      const items = await tx
        .select({ staffIds: bookingItems.staffIds })
        .from(bookingItems)
        .where(eq(bookingItems.bookingId, booking.id))
      if (!items.some((it) => it.staffIds.length > 0))
        throw new DomainError('Choose the therapist for her own client')
    }
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
      item.staffIds.map((staffId) => ({ item, staffId, pay: pay.get(staffId) ?? 'booking_commission' })),
    ),
  }
}

const keyOf = (c: { bookingItemId: string; staffId: string }) => `${c.bookingItemId}:${c.staffId}`
const fixed = (aed: number) => (Math.round(aed * 100) / 100).toFixed(2)

type Slots = Awaited<ReturnType<typeof commissionSlots>>

/**
 * The planned commission (`booking_items.commission_aed`) mirrors what is recorded: per item, the amount of its first
 * therapist paid per booking (others' 0 is not a plan). Keeps Finish-again and the "last amount used" prefill right.
 */
async function mirrorPlannedCommission(tx: Tx, { items, slots }: Slots, amounts: CommissionInput[]) {
  for (const item of items) {
    const slot = slots.find((s) => s.item.id === item.id && s.pay === 'booking_commission')
    const a = slot && amounts.find((x) => x.bookingItemId === item.id && x.staffId === slot.staffId)
    if (!a || fixed(a.amountAed) === item.commissionAed) continue
    await tx
      .update(bookingItems)
      .set({ commissionAed: fixed(a.amountAed) })
      .where(eq(bookingItems.id, item.id))
  }
}

/**
 * R2 commission edit of an order (booking page "Save commission", Correct payment): posts only the differences
 * (recordBookingCommissions) and keeps the planned commission on the items in step.
 */
export async function recordOrderCommissions(
  tx: Tx,
  i: { bookingId: string; amounts: CommissionInput[]; userId?: string | null; now?: Date },
) {
  const r = await recordBookingCommissions(tx, i)
  await mirrorPlannedCommission(tx, await commissionSlots(tx, i.bookingId), i.amounts)
  return r
}

type FeeLine = Pick<NewSaleLine, 'kind' | 'refId' | 'staffId' | 'qty' | 'unitPriceAed'> &
  Partial<Pick<NewSaleLine, 'clientPackageId' | 'membership'>>

/**
 * The fee actually charged per booking item (fils): its service lines, matched by treatment + therapist, then by
 * treatment alone (a therapist changed at checkout). Package / membership sessions (price 0) are not a fee.
 */
export function chargedFees(
  items: { id: string; serviceVariantId: string | null; staffIds: string[] }[],
  lines: FeeLine[],
): Map<string, number> {
  const used = new Set<number>()
  const fees = new Map<string, number>()
  const free = new Set<string>()
  const svc = lines.flatMap((l, n) => (l.kind === 'service' && l.refId ? [{ l, n }] : []))
  const take = (itemId: string, hit: { l: FeeLine; n: number }) => {
    used.add(hit.n)
    if (hit.l.clientPackageId || hit.l.membership?.use === 'session') free.add(itemId)
    else fees.set(itemId, (fees.get(itemId) ?? 0) + fils(hit.l.unitPriceAed) * hit.l.qty)
  }
  const left: { itemId: string; variant: string }[] = []
  for (const it of items) {
    if (!it.serviceVariantId) continue
    for (const staffId of it.staffIds.length ? it.staffIds : [null]) {
      const hit = svc.find(
        (x) => !used.has(x.n) && x.l.refId === it.serviceVariantId && (x.l.staffId ?? null) === staffId,
      )
      if (hit) take(it.id, hit)
      else left.push({ itemId: it.id, variant: it.serviceVariantId })
    }
  }
  for (const p of left) {
    const hit = svc.find((x) => !used.has(x.n) && x.l.refId === p.variant)
    if (hit) take(p.itemId, hit)
  }
  for (const id of free) fees.delete(id)
  return fees
}

/** Writes the charged fee back to `price_aed` (D1: the agreed fee = what was charged); `bump` = the "last used" time. */
async function writeBackFees(
  tx: Tx,
  items: (typeof bookingItems.$inferSelect)[],
  fees: Map<string, number>,
  o: { now: Date; bump: 'all' | 'changed' },
) {
  for (const item of items) {
    const fee = fees.get(item.id)
    if (fee === undefined) continue
    const changed = item.priceAed == null || fils(Number(item.priceAed)) !== fee
    if (!changed && o.bump === 'changed') continue
    await tx
      .update(bookingItems)
      .set({ priceAed: (fee / 100).toFixed(2), termsSetAt: o.now })
      .where(eq(bookingItems.id, item.id))
  }
}

/**
 * FINISH (D3, D5): the booking's checkout — createSale + recordBookingCommissions in one transaction. The sale is
 * dated the booking's business day when that day has started and is not closed, else today's. A closed booking day
 * (its commission rows and its day-sheet row change) needs `allowClosedDay` (pos.correct). Commission per item ×
 * therapist: someone not paid per booking (sales %, salary, booking fee) gets none (what is already recorded stays,
 * else 0; typed amounts are ignored); otherwise the typed amount, else what is recorded (a voided sale / legacy
 * completion), else the planned one; still none → refused, or — `commissionLater`, a member who may not enter
 * commission — the sale is made without it (entered later on the booking page, "Commission missing").
 * The fee charged per item is written back to `price_aed` (the "last amount used" prefill).
 */
export async function finishBooking(
  tx: Tx,
  i: NewSale & {
    bookingId: string
    commissions?: CommissionInput[]
    commissionLater?: boolean
    userId?: string | null
    now?: Date
  },
) {
  const now = i.now ?? new Date()
  const [peek] = await tx.select().from(bookings).where(eq(bookings.id, i.bookingId))
  if (!peek) throw new DomainError('Booking not found', 'not_found')
  if (peek.branchId !== i.branchId) throw new DomainError('That booking belongs to another branch')
  const today = await branchBusinessDate(tx, peek.branchId, now)
  // Day lock first (advisory), then the booking row — the order every day edit uses.
  const bookingDayClosed = await isDayClosed(tx, peek.branchId, peek.businessDate, { lock: true })
  if (bookingDayClosed && !i.allowClosedDay) throw new DomainError(DAY_CLOSED)
  const date = peek.businessDate <= today && !bookingDayClosed ? peek.businessDate : today
  const booking = await lockBooking(tx, peek.id)
  if (!['confirmed', 'checked_in', 'in_service', 'completed'].includes(booking.status))
    throw new DomainError(`A ${booking.status.replace('_', ' ')} booking can't be checked out`)
  const order = await commissionSlots(tx, peek.id)
  const { items, slots } = order
  const recorded = await commissionTotals(tx, peek.id)
  const given = new Map((i.commissions ?? []).map((c) => [keyOf(c), c.amountAed]))
  for (const key of given.keys())
    if (!slots.some((s) => keyOf({ bookingItemId: s.item.id, staffId: s.staffId }) === key))
      throw new DomainError('Therapist not found', 'not_found')
  const resolved = slots.map(({ item, staffId, pay }) => {
    const key = keyOf({ bookingItemId: item.id, staffId })
    const had = recorded.get(key)
    const amount =
      pay !== 'booking_commission'
        ? (had ?? 0) / 100
        : (given.get(key) ?? (had !== undefined ? had / 100 : num(item.commissionAed)))
    return { bookingItemId: item.id, staffId, amountAed: amount }
  })
  const missing = resolved.some((a) => a.amountAed == null)
  if (missing && !i.commissionLater) throw new DomainError('Enter the commission for every therapist')
  const amounts = missing ? [] : (resolved as CommissionInput[])
  const { sale, lines, message } = await createSale(tx, { ...i, businessDate: date, now })
  await writeBackFees(tx, items, chargedFees(items, i.lines), { now, bump: 'all' })
  if (amounts.length) {
    await mirrorPlannedCommission(tx, order, amounts)
    await recordBookingCommissions(tx, { bookingId: peek.id, amounts, userId: i.userId, now })
  }
  return { sale, lines, message, saleDate: date, commissions: amounts, bookingDayClosed }
}

type OrderSnapshot = {
  saleId: string | null
  saleNumber: number | null
  lines: { saleLineId: string; description: string; unitPriceAed: number }[]
  payments: { method: string; amountAed: number; reference: string | null }[]
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
    payments: ps.map((p) => ({ method: p.method, amountAed: Number(p.amountAed), reference: p.reference })),
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
 * the SAME business date in this transaction; commission changes post only the differences (dated the booking's
 * day). A closed day — the sale's for money, the booking's for commission — needs `allowClosedDay` (pos.correct).
 * Prepaid, gift-card and refunded sales are refused by voidSale with its texts. A payment sent without a reference
 * keeps the old one of the same method + amount (card slip / transfer reference); new fees go back to `price_aed`.
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
  type Pay = NewSale['payments'][number]
  const oldRefs = before.payments.filter((p) => p.reference)
  const newPayments: Pay[] = (
    i.payments ?? before.payments.map((p) => ({ ...p, method: p.method as Pay['method'] }))
  ).map((p) => {
    if (p.reference) return p
    const n = oldRefs.findIndex((o) => o.method === p.method && fils(o.amountAed) === fils(p.amountAed))
    if (n < 0) return { ...p, reference: null }
    const [o] = oldRefs.splice(n, 1)
    return { ...p, reference: o!.reference }
  })
  const newTips =
    i.tips ??
    before.tips.map((t) => ({ ...t, method: t.method as NonNullable<NewSale['tips']>[number]['method'] }))
  const linesChanged = oldLines.some(
    (l, n) => fils(newLines[n]!.unitPriceAed) !== fils(Number(l.unitPriceAed)),
  )
  const had = new Map(before.commissions.map((c) => [keyOf(c), fils(c.amountAed)]))
  const commissionChanged = (i.commissions ?? []).some((c) => had.get(keyOf(c)) !== fils(c.amountAed))
  if (
    commissionChanged &&
    !i.allowClosedDay &&
    booking.businessDate !== old.businessDate &&
    (await isDayClosed(tx, booking.branchId, booking.businessDate, { lock: true }))
  )
    throw new DomainError(DAY_CLOSED)
  const moneyChanged =
    linesChanged ||
    !sameMoney<{ method: string; amountAed: number }>(before.payments, newPayments, (p) => p.method) ||
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
    if (linesChanged) {
      const items = await tx.select().from(bookingItems).where(eq(bookingItems.bookingId, booking.id))
      await writeBackFees(tx, items, chargedFees(items, newLines), {
        now: i.now ?? new Date(),
        bump: 'changed',
      })
    }
    // G16 billing details printed on the full tax invoice stay with the order.
    if (old.billing)
      [sale] = (await tx
        .update(sales)
        .set({ billing: old.billing })
        .where(eq(sales.id, sale.id))
        .returning()) as [Sale]
  }
  if (i.commissions && commissionChanged)
    await recordOrderCommissions(tx, {
      bookingId: booking.id,
      amounts: i.commissions,
      userId: i.userId,
      now: i.now,
    })
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
