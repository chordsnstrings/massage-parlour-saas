// Point of sale: payments are RECORDED (cash, own card terminal, bank transfer), never processed.
// Sales, voids, refunds and the daily close (Z-report) per branch and business date.
import { businessDateOf, includedVat } from '@spa/core'
import {
  bookings,
  branches,
  clientMemberships,
  clientPackages,
  commissionEntries,
  counters,
  dayCloses,
  giftCards,
  giftCardTxns,
  membershipRedemptions,
  packageRedemptions,
  payments,
  products,
  refundLines,
  refunds,
  saleLines,
  sales,
  serviceVariants,
  staff,
  stockMovements,
  type Tx,
  tips,
} from '@spa/db'
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import { setBookingStatus } from './bookings'
import { DomainError, pgCode, pgConstraint } from './errors'
import { returnSoldStock, sellStock } from './inventory'
import { post, postRefund, postSale, reverseSource } from './ledger'
import {
  giftCardForPayment,
  issueGiftCard,
  issueMembership,
  issuePackage,
  LIVE_MEMBERSHIP,
  membershipForUse,
  redeemGiftCard,
  redeemMembershipSession,
  redeemPackageSession,
} from './loyalty'
import { enqueueBookingMessage } from './outbox'
import { accrueCommissions } from './payroll'

export const VAT_RATE_PCT = 5
export const POS_METHODS = ['cash', 'card_terminal', 'bank_transfer', 'other'] as const
export type PosMethod = (typeof POS_METHODS)[number]
/** Payments can also draw on a gift card (reference = card code); tips can't. */
export const PAY_METHODS = [...POS_METHODS, 'gift_card'] as const
export type PayMethod = (typeof PAY_METHODS)[number]
/** Prepaid items carry no VAT at sale — VAT is due when the session or card is used (or the membership period ends). */
export const PREPAID = new Set(['package', 'gift_card', 'membership'])
export const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  card_terminal: 'Card terminal',
  bank_transfer: 'Bank transfer',
  gift_card: 'Gift card',
  package_credit: 'Package credit',
  other: 'Other',
}

/** Work in fils (integers) so totals never drift. */
const fils = (aed: number) => Math.round(aed * 100)
const aed = (f: number) => (f / 100).toFixed(2)
const num = (v: string | number | null | undefined) => Number(v ?? 0)

export type NewSaleLine = {
  /** `membership`: sells (or renews) one period of the plan `refId` to the client. */
  kind: 'service' | 'product' | 'package' | 'gift_card' | 'other' | 'membership'
  refId?: string | null
  description: string
  qty: number
  unitPriceAed: number
  discountAed?: number
  staffId?: string | null
  /** Service line covered by a session from this client package (price must be 0). */
  clientPackageId?: string | null
  /**
   * Service line using a membership benefit: `session` = an included session (price must be 0, qty 1);
   * `discount` = the membership's discount % off the line, added to any line discount (computed here).
   */
  membership?: { id: string; use: 'session' | 'discount' } | null
}

export type NewSale = {
  tenantId: string
  branchId: string
  clientId?: string | null
  bookingId?: string | null
  lines: NewSaleLine[]
  /** Whole-sale discount on top of line discounts. */
  discountAed?: number
  payments: { method: PayMethod; amountAed: number; reference?: string | null }[]
  tips?: { staffId: string; amountAed: number; method: PosMethod }[]
  createdBy?: string | null
  now?: Date
}

/** Next per-tenant number for `key` (UPDATE … RETURNING; the row is created on first use). */
export async function nextCounter(tx: Tx, tenantId: string, key: string) {
  const [updated] = await tx
    .update(counters)
    .set({ value: sql`${counters.value} + 1` })
    .where(and(eq(counters.tenantId, tenantId), eq(counters.key, key)))
    .returning({ value: counters.value })
  if (updated) return updated.value
  const [created] = await tx
    .insert(counters)
    .values({ tenantId, key, value: 1 })
    .onConflictDoUpdate({
      target: [counters.tenantId, counters.key],
      set: { value: sql`${counters.value} + 1` },
    })
    .returning({ value: counters.value })
  return created!.value
}

async function branchRow(tx: Tx, branchId: string) {
  const [branch] = await tx.select().from(branches).where(eq(branches.id, branchId))
  if (!branch) throw new DomainError('Branch not found', 'not_found')
  return branch
}

/** Business date "now" for a branch, honouring its late-night cutoff. */
export async function branchBusinessDate(tx: Tx, branchId: string, now = new Date()) {
  const branch = await branchRow(tx, branchId)
  return businessDateOf(now, branch.businessDayCutoff.slice(0, 5))
}

/**
 * Records a paid sale. Amounts are VAT-inclusive; the payments must cover the total exactly (split allowed).
 * Tips are on top of the total. Checking out a booking completes it and queues the WhatsApp thank-you.
 */
export async function createSale(tx: Tx, input: NewSale) {
  if (!input.lines.length) throw new DomainError('Add at least one item')
  const branch = await branchRow(tx, input.branchId)
  const businessDate = businessDateOf(input.now ?? new Date(), branch.businessDayCutoff.slice(0, 5))

  // Membership discounts are the period's snapshotted %; who may use it is checked once the client is known.
  const memberIds = [...new Set(input.lines.flatMap((l) => (l.membership ? [l.membership.id] : [])))]
  const memberPct = new Map(
    (memberIds.length
      ? await tx.select().from(clientMemberships).where(inArray(clientMemberships.id, memberIds))
      : []
    ).map((m) => [m.id, num(m.discountPct)]),
  )

  // Lines → net amounts in fils.
  const priced = input.lines.map((l) => {
    if (!Number.isInteger(l.qty) || l.qty < 1) throw new DomainError('Quantity must be at least 1')
    if (!Number.isFinite(l.unitPriceAed)) throw new DomainError(`Type a price for “${l.description}”`)
    if (l.unitPriceAed < 0) throw new DomainError('Prices cannot be negative')
    const gross = fils(l.unitPriceAed) * l.qty
    const manual = fils(l.discountAed ?? 0)
    if (manual < 0 || manual > gross)
      throw new DomainError(`Discount on “${l.description}” is more than its price`)
    const pct = l.membership?.use === 'discount' ? (memberPct.get(l.membership.id) ?? 0) : 0
    const memberOff = Math.round((gross * pct) / 100)
    const discount = Math.min(gross, manual + memberOff)
    return { ...l, net: gross - discount, discount, memberPct: pct }
  })
  const subtotal = priced.reduce((s, l) => s + l.net, 0)
  const saleDiscount = fils(input.discountAed ?? 0)
  if (saleDiscount < 0 || saleDiscount > subtotal) throw new DomainError('Discount is more than the subtotal')
  const total = subtotal - saleDiscount

  // Spread the sale discount across lines (pro rata, remainder on the last line) so line totals add up to
  // the total — revenue, VAT and commissions are then based on what the client actually paid.
  let left = saleDiscount
  const lineTotals = priced.map((l, i) => {
    if (i === priced.length - 1) return l.net - left
    const share = subtotal ? Math.round((saleDiscount * l.net) / subtotal) : 0
    left -= share
    return l.net - share
  })
  if (lineTotals.some((t) => t < 0)) throw new DomainError('Discount is more than the subtotal')
  const vat = lineTotals.reduce(
    (s, t, i) => (PREPAID.has(priced[i]!.kind) ? s : s + fils(includedVat(t / 100, VAT_RATE_PCT))),
    0,
  )

  for (const p of input.payments) {
    if (!(PAY_METHODS as readonly string[]).includes(p.method))
      throw new DomainError('Unknown payment method')
    if (p.method === 'gift_card') {
      if (!p.reference?.trim()) throw new DomainError('Enter the gift card code')
      await giftCardForPayment(tx, input.tenantId, p.reference, fils(p.amountAed) / 100)
    }
    if (fils(p.amountAed) <= 0) throw new DomainError('Payment amounts must be more than zero')
  }
  const paid = input.payments.reduce((s, p) => s + fils(p.amountAed), 0)
  if (paid !== total)
    throw new DomainError(
      paid < total
        ? `AED ${aed(total - paid)} still to pay`
        : `Payments are AED ${aed(paid - total)} more than the total`,
    )
  const tipRows = input.tips ?? []
  for (const t of tipRows) {
    if (fils(t.amountAed) <= 0) throw new DomainError('Tip amounts must be more than zero')
    if (!(POS_METHODS as readonly string[]).includes(t.method)) throw new DomainError('Unknown tip method')
  }
  const tipTotal = tipRows.reduce((s, t) => s + fils(t.amountAed), 0)

  const staffIds = [
    ...new Set(
      [...priced.map((l) => l.staffId), ...tipRows.map((t) => t.staffId)].filter((x): x is string => !!x),
    ),
  ]
  if (staffIds.length) {
    const found = await tx.select({ id: staff.id }).from(staff).where(inArray(staff.id, staffIds))
    if (found.length !== staffIds.length) throw new DomainError('Therapist not found', 'not_found')
  }

  let clientId = input.clientId ?? null
  let booking: typeof bookings.$inferSelect | undefined
  if (input.bookingId) {
    // Lock the booking so concurrent checkouts of it serialise on the earlier-sale check below.
    ;[booking] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).for('update')
    if (!booking) throw new DomainError('Booking not found', 'not_found')
    if (booking.branchId !== input.branchId) throw new DomainError('That booking belongs to another branch')
    if (!['confirmed', 'checked_in', 'in_service'].includes(booking.status))
      throw new DomainError(`A ${booking.status.replace('_', ' ')} booking can't be checked out`)
    const [prior] = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(and(eq(sales.bookingId, booking.id), ne(sales.status, 'void')))
    if (prior) throw new DomainError('This booking has already been checked out')
    clientId = clientId ?? booking.clientId
  }

  for (const l of priced) {
    if (l.kind === 'package' && !clientId) throw new DomainError('Choose the client to sell a package to')
    if (l.kind === 'membership') {
      if (!clientId) throw new DomainError('Choose the client to sell a membership to')
      if (l.qty !== 1 || !l.refId) throw new DomainError('Sell one membership period per line')
    }
    if (l.membership) {
      if (l.kind !== 'service' || !clientId)
        throw new DomainError('Membership benefits need a client and a treatment')
      if (l.clientPackageId) throw new DomainError('Use either a package or a membership on a treatment')
      await membershipForUse(tx, l.membership.id, clientId, businessDate)
      if (l.membership.use === 'session' && (l.net !== 0 || l.qty !== 1))
        throw new DomainError(`“${l.description}” is covered by a membership — its price must be 0`)
      if (l.membership.use === 'discount' && !l.memberPct)
        throw new DomainError('This membership has no discount')
    }
    if (l.clientPackageId) {
      if (l.kind !== 'service' || !clientId)
        throw new DomainError('Package sessions need a client and a treatment')
      if (l.net !== 0)
        throw new DomainError(`“${l.description}” is covered by a package — its price must be 0`)
      const [pkg] = await tx.select().from(clientPackages).where(eq(clientPackages.id, l.clientPackageId))
      if (pkg?.clientId !== clientId) throw new DomainError('That package belongs to another client')
    }
    if (l.kind === 'product') {
      const [prod] = l.refId ? await tx.select().from(products).where(eq(products.id, l.refId)) : []
      if (!prod) throw new DomainError(`Product for “${l.description}” not found`, 'not_found')
    }
  }

  const number = await nextCounter(tx, input.tenantId, 'sale')
  let sale: typeof sales.$inferSelect | undefined
  try {
    ;[sale] = await tx
      .insert(sales)
      .values({
        tenantId: input.tenantId,
        branchId: input.branchId,
        clientId,
        bookingId: booking?.id ?? null,
        number,
        businessDate,
        subtotalAed: aed(subtotal),
        discountAed: aed(saleDiscount),
        vatAed: aed(vat),
        totalAed: aed(total),
        tipsAed: aed(tipTotal),
        status: 'paid',
        createdBy: input.createdBy ?? null,
      })
      .returning()
  } catch (e) {
    // Backstop for the booking lock: the partial unique index allows one non-void sale per booking.
    if (pgCode(e) === '23505' && pgConstraint(e) === 'sales_booking_once')
      throw new DomainError('This booking has already been checked out')
    throw e
  }
  const lines = await tx
    .insert(saleLines)
    .values(
      priced.map((l, i) => ({
        tenantId: input.tenantId,
        saleId: sale!.id,
        kind: l.kind,
        refId: l.refId ?? null,
        // Typed suffixes keep the benefit visible on the receipt (descriptions are stored text, not translated).
        description: l.clientPackageId
          ? `${l.description.trim()} · package session`
          : l.membership?.use === 'session'
            ? `${l.description.trim()} · membership session`
            : l.membership?.use === 'discount'
              ? `${l.description.trim()} · member −${l.memberPct}%`
              : l.description.trim(),
        qty: l.qty,
        unitPriceAed: aed(fils(l.unitPriceAed)),
        discountAed: aed(l.discount),
        vatRate: String(VAT_RATE_PCT),
        lineTotalAed: aed(lineTotals[i]!),
        staffId: l.staffId ?? null,
      })),
    )
    .returning()
  if (input.payments.length)
    await tx.insert(payments).values(
      input.payments.map((p) => ({
        tenantId: input.tenantId,
        saleId: sale!.id,
        branchId: input.branchId,
        method: p.method,
        amountAed: aed(fils(p.amountAed)),
        reference: p.reference?.trim() || null,
        businessDate,
        createdBy: input.createdBy ?? null,
      })),
    )
  if (tipRows.length)
    await tx.insert(tips).values(
      tipRows.map((t) => ({
        tenantId: input.tenantId,
        saleId: sale!.id,
        staffId: t.staffId,
        amountAed: aed(fils(t.amountAed)),
        method: t.method,
      })),
    )

  await postSale(tx, {
    id: sale!.id,
    tenantId: input.tenantId,
    branchId: input.branchId,
    businessDate,
    createdBy: input.createdBy,
    vatRatePct: VAT_RATE_PCT,
    lines: lines.map((l) => ({
      kind: l.kind,
      lineTotalAed: num(l.lineTotalAed),
      description: l.description,
    })),
    payments: input.payments.map((p) => ({ method: p.method, amountAed: fils(p.amountAed) / 100 })),
    tips: tipRows.map((t) => ({ method: t.method, amountAed: fils(t.amountAed) / 100 })),
  })
  await accrueCommissions(tx, sale!.id, VAT_RATE_PCT)

  // Side effects of what was sold / how it was paid.
  for (const [i, l] of priced.entries()) {
    const line = lines[i]!
    if (l.kind === 'product' && l.refId)
      await sellStock(tx, {
        tenantId: input.tenantId,
        branchId: input.branchId,
        productId: l.refId,
        qty: l.qty,
        saleId: sale!.id,
        date: businessDate,
      })
    if (l.kind === 'package' && l.refId && clientId) {
      // Each package carries its share of the line's net paid amount (cumulative rounding in fils).
      const lineFils = fils(num(line.lineTotalAed))
      for (let n = 0; n < l.qty; n++)
        await issuePackage(tx, {
          tenantId: input.tenantId,
          clientId,
          definitionId: l.refId,
          saleId: sale!.id,
          saleLineId: line.id,
          pricePaidAed: (Math.round((lineFils * (n + 1)) / l.qty) - Math.round((lineFils * n) / l.qty)) / 100,
        })
    }
    if (l.kind === 'gift_card')
      for (let n = 0; n < l.qty; n++)
        await issueGiftCard(tx, {
          tenantId: input.tenantId,
          amountAed: num(line.lineTotalAed) / l.qty,
          saleId: sale!.id,
          saleLineId: line.id,
          purchaserClientId: clientId,
          recipientName: l.description.replace(/^Gift card\s*[—-]?\s*/i, '') || undefined,
          createdBy: input.createdBy,
        })
    if (l.kind === 'membership' && l.refId && clientId)
      await issueMembership(tx, {
        tenantId: input.tenantId,
        clientId,
        planId: l.refId,
        businessDate,
        saleId: sale!.id,
        saleLineId: line.id,
        pricePaidAed: num(line.lineTotalAed),
        now: input.now,
      })
    const session = l.clientPackageId ? 'package' : l.membership?.use === 'session' ? 'membership' : null
    if (session && l.refId) {
      const [variant] = await tx
        .select({ serviceId: serviceVariants.serviceId })
        .from(serviceVariants)
        .where(eq(serviceVariants.id, l.refId))
      if (!variant) throw new DomainError('Treatment not found', 'not_found')
      const { valueAed } =
        session === 'package'
          ? await redeemPackageSession(tx, {
              clientPackageId: l.clientPackageId!,
              serviceId: variant.serviceId,
              bookingId: booking?.id ?? null,
              saleId: sale!.id,
              branchId: input.branchId,
              businessDate,
              now: input.now,
              createdBy: input.createdBy,
            })
          : await redeemMembershipSession(tx, {
              clientMembershipId: l.membership!.id,
              clientId,
              serviceId: variant.serviceId,
              saleId: sale!.id,
              branchId: input.branchId,
              businessDate,
              createdBy: input.createdBy,
            })
      // The line is priced at 0, so commission is earned on the session's redeemed value instead.
      if (l.staffId)
        await sessionCommission(tx, {
          tenantId: input.tenantId,
          branchId: input.branchId,
          saleId: sale!.id,
          saleLineId: line.id,
          staffId: l.staffId,
          businessDate,
          valueAed,
          memo: `Therapist commission (${session} session)`,
        })
    }
  }
  for (const p of input.payments)
    if (p.method === 'gift_card' && p.reference)
      await redeemGiftCard(tx, {
        tenantId: input.tenantId,
        code: p.reference,
        amountAed: fils(p.amountAed) / 100,
        saleId: sale!.id,
        createdBy: input.createdBy,
      })

  let message: Awaited<ReturnType<typeof enqueueBookingMessage>> = null
  if (booking) {
    if (booking.status === 'confirmed') await setBookingStatus(tx, booking.id, 'checked_in')
    await setBookingStatus(tx, booking.id, 'completed')
    message = await enqueueBookingMessage(tx, booking.id, 'thank_you')
  }
  return { sale: sale!, lines, message }
}

/** Commission on a prepaid session's redeemed value (the line itself is priced at 0). */
async function sessionCommission(
  tx: Tx,
  c: {
    tenantId: string
    branchId: string
    saleId: string
    saleLineId: string
    staffId: string
    businessDate: string
    valueAed: number
    memo: string
  },
) {
  const [person] = await tx
    .select({ rate: staff.commissionPct, payType: staff.payType })
    .from(staff)
    .where(eq(staff.id, c.staffId))
  // Therapists are paid per booking (PLAN §14.8 R2); only `sales_commission` people earn a %.
  if (person?.payType !== 'sales_commission') return
  const baseAed = c.valueAed - includedVat(c.valueAed, VAT_RATE_PCT)
  const amount = Math.round(baseAed * num(person?.rate)) / 100
  if (amount <= 0) return
  await tx.insert(commissionEntries).values({
    tenantId: c.tenantId,
    staffId: c.staffId,
    saleLineId: c.saleLineId,
    businessDate: c.businessDate,
    baseAed: baseAed.toFixed(2),
    ratePct: num(person?.rate).toFixed(2),
    amountAed: amount.toFixed(2),
  })
  await post(tx, {
    tenantId: c.tenantId,
    branchId: c.branchId,
    date: c.businessDate,
    sourceType: 'commission',
    sourceId: c.saleId,
    memo: c.memo,
    lines: [
      { code: '6010', debit: amount },
      { code: '2300', credit: amount },
    ],
  })
}

async function isClosed(tx: Tx, branchId: string, date: string) {
  const [row] = await tx
    .select({ id: dayCloses.id })
    .from(dayCloses)
    .where(and(eq(dayCloses.branchId, branchId), eq(dayCloses.businessDate, date)))
  return Boolean(row)
}

async function saleRow(tx: Tx, saleId: string) {
  const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId))
  if (!sale) throw new DomainError('Sale not found', 'not_found')
  return sale
}

const refundedFils = async (tx: Tx, saleId: string) => {
  const [r] = await tx
    .select({ v: sql<string>`coalesce(sum(${refunds.amountAed}), 0)` })
    .from(refunds)
    .where(eq(refunds.saleId, saleId))
  return fils(num(r?.v))
}

/**
 * Voids a sale on a day that is still open: the sale drops out of the day's totals and its ledger entries
 * and commissions are reversed (append-only). After the daily close, use a refund instead.
 */
export async function voidSale(tx: Tx, input: { saleId: string; reason: string; userId?: string | null }) {
  const reason = input.reason.trim()
  if (reason.length < 3) throw new DomainError('Give a reason for the void')
  const sale = await saleRow(tx, input.saleId)
  if (sale.status !== 'paid') throw new DomainError(`This sale is already ${sale.status}`)
  if ((await refundedFils(tx, sale.id)) > 0)
    throw new DomainError('This sale has refunds — refund the rest instead')
  if (await isClosed(tx, sale.branchId, sale.businessDate))
    throw new DomainError('That day is closed — record a refund instead')
  const soldLines = await tx.select().from(saleLines).where(eq(saleLines.saleId, sale.id))
  const giftPaid = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.saleId, sale.id), eq(payments.method, 'gift_card')))
  const usedPackage = await tx
    .select({ id: packageRedemptions.id })
    .from(packageRedemptions)
    .where(eq(packageRedemptions.saleId, sale.id))
  const usedMembership = await tx
    .select({ id: membershipRedemptions.id })
    .from(membershipRedemptions)
    .where(eq(membershipRedemptions.saleId, sale.id))
  if (
    soldLines.some((l) => PREPAID.has(l.kind)) ||
    giftPaid.length ||
    usedPackage.length ||
    usedMembership.length
  )
    throw new DomainError(
      'Sales with packages, memberships or gift cards can’t be voided — record a refund instead',
    )
  const [updated] = await tx
    .update(sales)
    .set({ status: 'void', voidReason: reason })
    .where(eq(sales.id, sale.id))
    .returning()
  await reverseSource(tx, sale.tenantId, 'sale', sale.id, sale.businessDate, input.userId)
  await reverseSource(tx, sale.tenantId, 'commission', sale.id, sale.businessDate, input.userId)
  await reverseSource(tx, sale.tenantId, 'cogs', sale.id, sale.businessDate, input.userId)
  for (const l of soldLines)
    if (l.kind === 'product' && l.refId)
      await returnSoldStock(tx, {
        tenantId: sale.tenantId,
        branchId: sale.branchId,
        productId: l.refId,
        qty: l.qty,
        saleId: sale.id,
        date: sale.businessDate,
        createdBy: input.userId,
      })
  // Commission accruals are append-only too: offset each one with a negative entry.
  const lineIds = (
    await tx.select({ id: saleLines.id }).from(saleLines).where(eq(saleLines.saleId, sale.id))
  ).map((l) => l.id)
  if (lineIds.length) {
    const accrued = await tx
      .select()
      .from(commissionEntries)
      .where(inArray(commissionEntries.saleLineId, lineIds))
    const offsets = accrued.filter((c) => num(c.amountAed) > 0)
    if (offsets.length)
      await tx.insert(commissionEntries).values(
        offsets.map((c) => ({
          tenantId: c.tenantId,
          staffId: c.staffId,
          saleLineId: c.saleLineId,
          businessDate: sale.businessDate,
          baseAed: (-num(c.baseAed)).toFixed(2),
          ratePct: c.ratePct,
          amountAed: (-num(c.amountAed)).toFixed(2),
        })),
      )
  }
  return updated!
}

/** Fils share of `total` for `count` of `qty` units; unit amounts are differences, so a full refund adds up exactly. */
const shareOf = (total: number, count: number, qty: number) => Math.round((total * count) / qty)

type PrepaidUnit = {
  type: 'gift_card' | 'package' | 'membership'
  id: string
  /** Liability still owed on it (balance / remaining value), fils. */
  remaining: number
  /** What it was issued for (initial balance / price), fils. */
  initial: number
}

/** Another line on the sale that legacy (unlinked) cards/packages could belong to. */
const hasOtherLine = (lines: (typeof saleLines.$inferSelect)[], line: typeof saleLines.$inferSelect) =>
  lines.some(
    (l) => l.id !== line.id && l.kind === line.kind && (l.kind === 'gift_card' || l.refId === line.refId),
  )

type RefundPlanLine = {
  line: typeof saleLines.$inferSelect
  refundedQty: number
  /** Fils of the next units that can still be refunded, in refund order. */
  units: { fils: number; prepaid?: PrepaidUnit }[]
}

/**
 * What can still be refunded on each line of a sale. Ordinary lines: each unit's share of the line's net paid
 * amount (line + sale-level discounts are already spread into `line_total_aed`). Prepaid lines: one unit per
 * gift card / package still active, worth its unused share of what was paid, most unused first; used-up ones
 * are left out. `lock` row-locks the cards and packages for a refund.
 */
async function refundPlan(tx: Tx, sale: typeof sales.$inferSelect, lock = false) {
  const lines = await tx.select().from(saleLines).where(eq(saleLines.saleId, sale.id))
  const done = lines.length
    ? await tx
        .select({ lineId: refundLines.saleLineId, qty: sql<number>`sum(${refundLines.qty})::int` })
        .from(refundLines)
        .where(
          inArray(
            refundLines.saleLineId,
            lines.map((l) => l.id),
          ),
        )
        .groupBy(refundLines.saleLineId)
    : []
  const refundedQty = new Map(done.map((d) => [d.lineId, d.qty]))
  const hasPrepaid = lines.some((l) => PREPAID.has(l.kind))
  const cardQuery = tx.select().from(giftCards).where(eq(giftCards.saleId, sale.id))
  const pkgQuery = tx.select().from(clientPackages).where(eq(clientPackages.saleId, sale.id))
  // Sequential: one transaction connection runs one query at a time.
  const memberQuery = tx.select().from(clientMemberships).where(eq(clientMemberships.saleId, sale.id))
  const cards = hasPrepaid ? await (lock ? cardQuery.for('update') : cardQuery) : []
  const pkgs = hasPrepaid ? await (lock ? pkgQuery.for('update') : pkgQuery) : []
  const periods = hasPrepaid ? await (lock ? memberQuery.for('update') : memberQuery) : []

  return lines.map((line): RefundPlanLine => {
    const refunded = refundedQty.get(line.id) ?? 0
    const paid = fils(num(line.lineTotalAed))
    const left = Math.max(0, line.qty - refunded)
    if (paid <= 0 || left === 0) return { line, refundedQty: refunded, units: [] }
    if (!PREPAID.has(line.kind)) {
      const units = Array.from({ length: left }, (_, i) => ({
        fils: shareOf(paid, refunded + i + 1, line.qty) - shareOf(paid, refunded + i, line.qty),
      }))
      return { line, refundedQty: refunded, units }
    }
    // Cards/packages sold before `sale_line_id` existed match by sale (and package definition).
    // Membership periods always carry `sale_line_id`; expired ones were already earned (nothing unused).
    const instruments: PrepaidUnit[] =
      line.kind === 'membership'
        ? periods
            .filter((m) => m.saleLineId === line.id)
            .filter((m) => (LIVE_MEMBERSHIP as readonly string[]).includes(m.status))
            .map((m) => ({
              type: 'membership' as const,
              id: m.id,
              remaining: fils(num(m.remainingValueAed)),
              initial: fils(num(m.pricePaidAed)),
            }))
        : line.kind === 'gift_card'
          ? cards
              .filter((c) => c.saleLineId === line.id || (!c.saleLineId && !hasOtherLine(lines, line)))
              .filter((c) => c.status === 'active')
              .map((c) => ({
                type: 'gift_card' as const,
                id: c.id,
                remaining: fils(num(c.balanceAed)),
                initial: fils(num(c.initialAed)),
              }))
          : pkgs
              .filter(
                (p) =>
                  p.saleLineId === line.id ||
                  (!p.saleLineId && p.definitionId === line.refId && !hasOtherLine(lines, line)),
              )
              .filter((p) => p.status === 'active')
              .map((p) => ({
                type: 'package' as const,
                id: p.id,
                remaining: fils(num(p.remainingValueAed)),
                initial: fils(num(p.pricePaidAed)),
              }))
    const ratio = (u: PrepaidUnit) => (u.initial > 0 ? Math.min(1, u.remaining / u.initial) : 0)
    const units = instruments
      .filter((u) => ratio(u) > 0)
      .sort((a, b) => ratio(b) - ratio(a))
      .slice(0, left)
      .map((u, i) => {
        const unitPaid = shareOf(paid, refunded + i + 1, line.qty) - shareOf(paid, refunded + i, line.qty)
        return { fils: Math.min(unitPaid, Math.round(unitPaid * ratio(u))), prepaid: u }
      })
      .filter((u) => u.fils > 0)
    return { line, refundedQty: refunded, units }
  })
}

export type RefundOptions = Awaited<ReturnType<typeof refundOptions>>

/**
 * For the refund sheet: per line, how many units can still be refunded and what each would give back (AED,
 * in refund order), plus the sale-wide amount still refundable (refunds recorded before line-level refunds
 * count against it).
 */
export async function refundOptions(tx: Tx, saleId: string) {
  const sale = await saleRow(tx, saleId)
  const closed = sale.status === 'void' || sale.status === 'refunded'
  const plan = await refundPlan(tx, sale)
  const remaining = closed ? 0 : fils(num(sale.totalAed)) - (await refundedFils(tx, sale.id))
  return {
    remainingAed: Math.max(0, remaining) / 100,
    lines: plan.map((p) => ({
      saleLineId: p.line.id,
      kind: p.line.kind,
      description: p.line.description,
      qty: p.line.qty,
      refundedQty: p.refundedQty,
      prepaid: PREPAID.has(p.line.kind),
      unitsAed: closed ? [] : p.units.map((u) => u.fils / 100),
    })),
  }
}

/**
 * Records money given back for chosen sale lines and quantities, on today's business date. Ordinary lines
 * give back their net paid share (VAT included); retail goes back on the shelf with its cost of sales
 * reversed; commissions on the lines are offset pro rata. Prepaid lines give back only the unused value of
 * each gift card / package, which is then voided / cancelled. Tips are not refunded. The sale becomes
 * `refunded` once nothing is left to refund.
 */
export async function refundSale(
  tx: Tx,
  input: {
    saleId: string
    lines: { saleLineId: string; qty: number }[]
    method: PosMethod
    reason: string
    createdBy?: string | null
    now?: Date
  },
) {
  const reason = input.reason.trim()
  if (reason.length < 3) throw new DomainError('Give a reason for the refund')
  if (!(POS_METHODS as readonly string[]).includes(input.method))
    throw new DomainError('Unknown refund method')
  // Lock the sale so concurrent refunds of it serialise on what is left.
  const [sale] = await tx.select().from(sales).where(eq(sales.id, input.saleId)).for('update')
  if (!sale) throw new DomainError('Sale not found', 'not_found')
  if (sale.status === 'void') throw new DomainError('This sale was voided')
  if (sale.status === 'refunded') throw new DomainError('This sale has already been refunded')
  const wanted = input.lines.filter((l) => l.qty !== 0)
  if (!wanted.length) throw new DomainError('Choose what to refund')
  if (new Set(wanted.map((l) => l.saleLineId)).size !== wanted.length)
    throw new DomainError('Each item can be listed once')
  const plan = await refundPlan(tx, sale, true)
  const byId = new Map(plan.map((p) => [p.line.id, p]))

  const picked = wanted.map((w) => {
    const p = byId.get(w.saleLineId)
    if (!p) throw new DomainError('That item is not on this sale', 'not_found')
    if (!Number.isInteger(w.qty) || w.qty < 1) throw new DomainError('Quantity must be at least 1')
    if (w.qty > p.units.length)
      throw new DomainError(
        p.units.length === 0
          ? PREPAID.has(p.line.kind) && p.refundedQty < p.line.qty && num(p.line.lineTotalAed) > 0
            ? `“${p.line.description}” has been used — nothing unused is left to refund`
            : `Nothing is left to refund on “${p.line.description}”`
          : `At most ${p.units.length} of “${p.line.description}” can be refunded`,
      )
    const units = p.units.slice(0, w.qty)
    const amount = units.reduce((s, u) => s + u.fils, 0)
    const lineVat = PREPAID.has(p.line.kind) ? 0 : fils(includedVat(num(p.line.lineTotalAed), VAT_RATE_PCT))
    const vat = PREPAID.has(p.line.kind)
      ? 0
      : shareOf(lineVat, p.refundedQty + w.qty, p.line.qty) - shareOf(lineVat, p.refundedQty, p.line.qty)
    return { ...p, qty: w.qty, units, amount, vat }
  })
  const amount = picked.reduce((s, p) => s + p.amount, 0)
  // Refunds recorded before line-level refunds have no lines; the sale total still caps everything.
  const remaining = fils(num(sale.totalAed)) - (await refundedFils(tx, sale.id))
  if (amount > remaining) throw new DomainError(`At most AED ${aed(Math.max(0, remaining))} can be refunded`)

  const date = await branchBusinessDate(tx, sale.branchId, input.now)
  const [refund] = await tx
    .insert(refunds)
    .values({
      tenantId: sale.tenantId,
      saleId: sale.id,
      branchId: sale.branchId,
      amountAed: aed(amount),
      method: input.method,
      reason,
      businessDate: date,
      createdBy: input.createdBy ?? null,
    })
    .returning()
  await tx.insert(refundLines).values(
    picked.flatMap((p) =>
      PREPAID.has(p.line.kind)
        ? p.units.map((u) => ({
            tenantId: sale.tenantId,
            refundId: refund!.id,
            saleLineId: p.line.id,
            qty: 1,
            amountAed: aed(u.fils),
            vatAed: '0.00',
            refId: u.prepaid?.id ?? null,
          }))
        : [
            {
              tenantId: sale.tenantId,
              refundId: refund!.id,
              saleLineId: p.line.id,
              qty: p.qty,
              amountAed: aed(p.amount),
              vatAed: aed(p.vat),
            },
          ],
    ),
  )
  await postRefund(tx, {
    tenantId: sale.tenantId,
    branchId: sale.branchId,
    saleId: sale.id,
    date,
    method: input.method,
    createdBy: input.createdBy,
    lines: picked.map((p) => ({
      kind: p.line.kind,
      amountAed: p.amount / 100,
      vatAed: p.vat / 100,
      description: p.line.description,
    })),
  })

  // Prepaid: the unused value was given back, so the card / package is closed.
  for (const p of picked)
    for (const u of p.units) {
      if (u.prepaid?.type === 'gift_card') {
        await tx
          .update(giftCards)
          .set({ balanceAed: '0.00', status: 'void' })
          .where(eq(giftCards.id, u.prepaid.id))
        await tx.insert(giftCardTxns).values({
          tenantId: sale.tenantId,
          giftCardId: u.prepaid.id,
          kind: 'refund',
          amountAed: aed(-u.prepaid.remaining),
          saleId: sale.id,
          createdBy: input.createdBy ?? null,
        })
      } else if (u.prepaid?.type === 'package')
        await tx
          .update(clientPackages)
          .set({ status: 'refunded', remainingValueAed: '0.00' })
          .where(eq(clientPackages.id, u.prepaid.id))
      else if (u.prepaid?.type === 'membership')
        await tx
          .update(clientMemberships)
          .set({ status: 'refunded', remainingValueAed: '0.00', balances: {} })
          .where(eq(clientMemberships.id, u.prepaid.id))
    }

  // Retail: goods back on the shelf and their cost of sales reversed for exactly the refunded quantity.
  let cogs = 0
  for (const p of picked) {
    if (p.line.kind !== 'product' || !p.line.refId) continue
    await returnSoldStock(tx, {
      tenantId: sale.tenantId,
      branchId: sale.branchId,
      productId: p.line.refId,
      qty: p.qty,
      saleId: sale.id,
      refundId: refund!.id,
      date,
      createdBy: input.createdBy,
    })
    const [sold] = await tx
      .select({ unitCost: stockMovements.unitCostAed })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.refType, 'sale'),
          eq(stockMovements.refId, sale.id),
          eq(stockMovements.productId, p.line.refId),
        ),
      )
    // Same rounding as `sellStock`, then this refund's share of it.
    const lineCost = fils(p.line.qty * num(sold?.unitCost))
    cogs +=
      shareOf(lineCost, p.refundedQty + p.qty, p.line.qty) - shareOf(lineCost, p.refundedQty, p.line.qty)
  }
  if (cogs > 0)
    await post(tx, {
      tenantId: sale.tenantId,
      branchId: sale.branchId,
      date,
      sourceType: 'refund_cogs',
      sourceId: sale.id,
      memo: 'Refunded goods back in stock',
      createdBy: input.createdBy,
      lines: [
        { code: '1200', debit: cogs / 100 },
        { code: '5000', credit: cogs / 100 },
      ],
    })

  // Commission accruals are append-only: offset each therapist's share of the refunded quantity.
  const accrued = await tx
    .select()
    .from(commissionEntries)
    .where(
      inArray(
        commissionEntries.saleLineId,
        picked.map((p) => p.line.id),
      ),
    )
  let commission = 0
  const offsets: (typeof commissionEntries.$inferInsert)[] = []
  for (const p of picked) {
    const perStaff = new Map<
      string,
      { earned: number; base: number; undone: number; undoneBase: number; rate: string }
    >()
    for (const c of accrued.filter((c) => c.saleLineId === p.line.id)) {
      const row = perStaff.get(c.staffId) ?? { earned: 0, base: 0, undone: 0, undoneBase: 0, rate: c.ratePct }
      const amount = fils(num(c.amountAed))
      if (amount > 0) {
        row.earned += amount
        row.base += fils(num(c.baseAed))
        row.rate = c.ratePct
      } else {
        row.undone -= amount
        row.undoneBase -= fils(num(c.baseAed))
      }
      perStaff.set(c.staffId, row)
    }
    const upTo = p.refundedQty + p.qty
    for (const [staffId, c] of perStaff) {
      const amount = shareOf(c.earned, upTo, p.line.qty) - c.undone
      if (amount <= 0) continue
      commission += amount
      offsets.push({
        tenantId: sale.tenantId,
        staffId,
        saleLineId: p.line.id,
        businessDate: date,
        baseAed: aed(-(shareOf(c.base, upTo, p.line.qty) - c.undoneBase)),
        ratePct: c.rate,
        amountAed: aed(-amount),
      })
    }
  }
  if (offsets.length) {
    await tx.insert(commissionEntries).values(offsets)
    await post(tx, {
      tenantId: sale.tenantId,
      branchId: sale.branchId,
      date,
      sourceType: 'refund_commission',
      sourceId: sale.id,
      memo: 'Commission offset (refund)',
      createdBy: input.createdBy,
      lines: [
        { code: '2300', debit: commission / 100 },
        { code: '6010', credit: commission / 100 },
      ],
    })
  }

  const taken = new Map(picked.map((p) => [p.line.id, p.qty]))
  const nothingLeft = plan.every((p) => p.units.length - (taken.get(p.line.id) ?? 0) <= 0)
  if (nothingLeft || amount === remaining)
    await tx.update(sales).set({ status: 'refunded' }).where(eq(sales.id, sale.id))
  return refund!
}

export type DaySummary = Awaited<ReturnType<typeof daySummary>>

/**
 * Z-report for a branch and business date. Voided sales are excluded; refunds count on the day they were
 * given. Expected cash = opening float + cash payments + cash tips − cash refunds.
 */
export async function daySummary(tx: Tx, branchId: string, date: string, openingFloatAed?: number) {
  const live = and(eq(sales.branchId, branchId), eq(sales.businessDate, date), ne(sales.status, 'void'))
  const [agg] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      revenue: sql<string>`coalesce(sum(${sales.totalAed}), 0)`,
      vat: sql<string>`coalesce(sum(${sales.vatAed}), 0)`,
      discount: sql<string>`coalesce(sum(${sales.discountAed} + (select coalesce(sum(l.discount_aed), 0) from sale_lines l where l.sale_id = ${sales.id})), 0)`,
    })
    .from(sales)
    .where(live)
  const [voids] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(sales)
    .where(and(eq(sales.branchId, branchId), eq(sales.businessDate, date), eq(sales.status, 'void')))
  const payRows = await tx
    .select({ method: payments.method, v: sql<string>`sum(${payments.amountAed})` })
    .from(payments)
    .innerJoin(sales, eq(sales.id, payments.saleId))
    .where(live)
    .groupBy(payments.method)
  const tipRows = await tx
    .select({
      staffId: tips.staffId,
      name: staff.displayName,
      method: tips.method,
      v: sql<string>`sum(${tips.amountAed})`,
    })
    .from(tips)
    .innerJoin(sales, eq(sales.id, tips.saleId))
    .innerJoin(staff, eq(staff.id, tips.staffId))
    .where(live)
    .groupBy(tips.staffId, staff.displayName, tips.method)
    .orderBy(asc(staff.displayName))
  const refundRows = await tx
    .select({ method: refunds.method, v: sql<string>`sum(${refunds.amountAed})` })
    .from(refunds)
    .where(and(eq(refunds.branchId, branchId), eq(refunds.businessDate, date)))
    .groupBy(refunds.method)
  const [close] = await tx
    .select()
    .from(dayCloses)
    .where(and(eq(dayCloses.branchId, branchId), eq(dayCloses.businessDate, date)))

  const byMethod = (rows: { method: string; v: string }[]) => {
    const out: Record<string, number> = {}
    for (const r of rows) out[r.method] = (out[r.method] ?? 0) + fils(num(r.v))
    return out
  }
  const pay = byMethod(payRows)
  const tipMethod = byMethod(tipRows)
  const ref = byMethod(refundRows)
  const staffTips = new Map<string, { staffId: string; name: string; amount: number }>()
  for (const t of tipRows) {
    const row = staffTips.get(t.staffId) ?? { staffId: t.staffId, name: t.name, amount: 0 }
    row.amount += fils(num(t.v))
    staffTips.set(t.staffId, row)
  }
  const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0)
  const floatF = fils(openingFloatAed ?? num(close?.openingFloatAed))
  const revenue = fils(num(agg?.revenue))
  const count = agg?.count ?? 0
  const toAed = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / 100]))
  return {
    date,
    branchId,
    salesCount: count,
    voidCount: voids?.count ?? 0,
    revenueAed: revenue / 100,
    vatAed: num(agg?.vat),
    discountAed: num(agg?.discount),
    averageTicketAed: count ? Math.round(revenue / count) / 100 : 0,
    paymentsByMethod: toAed(pay),
    tipsAed: sum(tipMethod) / 100,
    tipsByMethod: toAed(tipMethod),
    tipsByStaff: [...staffTips.values()].map((t) => ({
      staffId: t.staffId,
      name: t.name,
      amountAed: t.amount / 100,
    })),
    refundsAed: sum(ref) / 100,
    refundsByMethod: toAed(ref),
    openingFloatAed: floatF / 100,
    expectedCashAed: (floatF + (pay.cash ?? 0) + (tipMethod.cash ?? 0) - (ref.cash ?? 0)) / 100,
    close: close ?? null,
  }
}

/** Closes a branch's business day (once): stores the Z-report, counted cash and the variance. */
export async function closeDay(
  tx: Tx,
  input: {
    tenantId: string
    branchId: string
    date: string
    openingFloatAed: number
    countedCashAed: number
    notes?: string | null
    closedBy?: string | null
  },
) {
  if (input.openingFloatAed < 0 || input.countedCashAed < 0)
    throw new DomainError('Amounts cannot be negative')
  const s = await daySummary(tx, input.branchId, input.date, input.openingFloatAed)
  if (s.close) throw new DomainError('This day is already closed')
  const variance = fils(input.countedCashAed) - fils(s.expectedCashAed)
  const totals: Record<string, string> = {
    sales: String(s.salesCount),
    voids: String(s.voidCount),
    revenue: s.revenueAed.toFixed(2),
    vat: s.vatAed.toFixed(2),
    discounts: s.discountAed.toFixed(2),
    tips: s.tipsAed.toFixed(2),
    refunds: s.refundsAed.toFixed(2),
  }
  for (const [m, v] of Object.entries(s.paymentsByMethod)) totals[`pay_${m}`] = v.toFixed(2)
  for (const [m, v] of Object.entries(s.tipsByMethod)) totals[`tips_${m}`] = v.toFixed(2)
  for (const [m, v] of Object.entries(s.refundsByMethod)) totals[`refund_${m}`] = v.toFixed(2)
  try {
    const [row] = await tx
      .insert(dayCloses)
      .values({
        tenantId: input.tenantId,
        branchId: input.branchId,
        businessDate: input.date,
        openingFloatAed: aed(fils(input.openingFloatAed)),
        expectedCashAed: aed(fils(s.expectedCashAed)),
        countedCashAed: aed(fils(input.countedCashAed)),
        varianceAed: aed(variance),
        totals,
        notes: input.notes?.trim() || null,
        closedBy: input.closedBy ?? null,
      })
      .returning()
    return row!
  } catch (e) {
    if (pgCode(e) === '23505') throw new DomainError('This day is already closed')
    throw e
  }
}
