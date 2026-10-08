// Point of sale: payments are RECORDED (cash, own card terminal, bank transfer), never processed.
// Sales, voids, refunds and the daily close (Z-report) per branch and business date.
import { businessDateOf, includedVat } from '@spa/core'
import {
  bookings,
  branches,
  clientPackages,
  commissionEntries,
  counters,
  dayCloses,
  packageRedemptions,
  payments,
  products,
  refunds,
  saleLines,
  sales,
  serviceVariants,
  staff,
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
  issuePackage,
  redeemGiftCard,
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
/** Prepaid items carry no VAT at sale — VAT is due when the session or card is used. */
const PREPAID = new Set(['package', 'gift_card'])
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
  kind: 'service' | 'product' | 'package' | 'gift_card' | 'other'
  refId?: string | null
  description: string
  qty: number
  unitPriceAed: number
  discountAed?: number
  staffId?: string | null
  /** Service line covered by a session from this client package (price must be 0). */
  clientPackageId?: string | null
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

  // Lines → net amounts in fils.
  const priced = input.lines.map((l) => {
    if (!Number.isInteger(l.qty) || l.qty < 1) throw new DomainError('Quantity must be at least 1')
    if (l.unitPriceAed < 0) throw new DomainError('Prices cannot be negative')
    const gross = fils(l.unitPriceAed) * l.qty
    const discount = fils(l.discountAed ?? 0)
    if (discount < 0 || discount > gross)
      throw new DomainError(`Discount on “${l.description}” is more than its price`)
    return { ...l, net: gross - discount, discount }
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
        description: l.clientPackageId ? `${l.description.trim()} · package session` : l.description.trim(),
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
    if (l.kind === 'package' && l.refId && clientId)
      for (let n = 0; n < l.qty; n++)
        await issuePackage(tx, {
          tenantId: input.tenantId,
          clientId,
          definitionId: l.refId,
          saleId: sale!.id,
        })
    if (l.kind === 'gift_card')
      for (let n = 0; n < l.qty; n++)
        await issueGiftCard(tx, {
          tenantId: input.tenantId,
          amountAed: num(line.lineTotalAed) / l.qty,
          saleId: sale!.id,
          purchaserClientId: clientId,
          recipientName: l.description.replace(/^Gift card\s*[—-]?\s*/i, '') || undefined,
          createdBy: input.createdBy,
        })
    if (l.clientPackageId && l.refId) {
      const [variant] = await tx
        .select({ serviceId: serviceVariants.serviceId })
        .from(serviceVariants)
        .where(eq(serviceVariants.id, l.refId))
      if (!variant) throw new DomainError('Treatment not found', 'not_found')
      const { valueAed } = await redeemPackageSession(tx, {
        clientPackageId: l.clientPackageId,
        serviceId: variant.serviceId,
        bookingId: booking?.id ?? null,
        saleId: sale!.id,
        branchId: input.branchId,
        createdBy: input.createdBy,
      })
      // The line is priced at 0, so commission is earned on the session's redeemed value instead.
      if (l.staffId) {
        const [person] = await tx
          .select({ rate: staff.commissionPct })
          .from(staff)
          .where(eq(staff.id, l.staffId))
        const baseAed = valueAed - includedVat(valueAed, VAT_RATE_PCT)
        const amount = Math.round(baseAed * num(person?.rate)) / 100
        if (amount > 0) {
          await tx.insert(commissionEntries).values({
            tenantId: input.tenantId,
            staffId: l.staffId,
            saleLineId: line.id,
            businessDate,
            baseAed: baseAed.toFixed(2),
            ratePct: num(person?.rate).toFixed(2),
            amountAed: amount.toFixed(2),
          })
          await post(tx, {
            tenantId: input.tenantId,
            branchId: input.branchId,
            date: businessDate,
            sourceType: 'commission',
            sourceId: sale!.id,
            memo: 'Therapist commission (package session)',
            lines: [
              { code: '6010', debit: amount },
              { code: '2300', credit: amount },
            ],
          })
        }
      }
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
  if (soldLines.some((l) => PREPAID.has(l.kind)) || giftPaid.length || usedPackage.length)
    throw new DomainError('Sales with packages or gift cards can’t be voided — record a refund instead')
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

/** Records money given back (partial or full) on today's business date and posts the reversal to the ledger. */
export async function refundSale(
  tx: Tx,
  input: {
    saleId: string
    amountAed: number
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
  const sale = await saleRow(tx, input.saleId)
  if (sale.status === 'void') throw new DomainError('This sale was voided')
  const amount = fils(input.amountAed)
  if (amount <= 0) throw new DomainError('Refund amount must be more than zero')
  const already = await refundedFils(tx, sale.id)
  const remaining = fils(num(sale.totalAed)) - already
  if (amount > remaining) throw new DomainError(`At most AED ${aed(remaining)} can be refunded`)
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
  await postRefund(tx, {
    tenantId: sale.tenantId,
    branchId: sale.branchId,
    saleId: sale.id,
    date,
    amountAed: amount / 100,
    method: input.method,
    vatRatePct: VAT_RATE_PCT,
    createdBy: input.createdBy,
  })
  if (amount === remaining) await tx.update(sales).set({ status: 'refunded' }).where(eq(sales.id, sale.id))
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
