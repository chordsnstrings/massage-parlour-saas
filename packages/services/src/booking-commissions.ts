// Therapist commission typed in AED per completed booking (PLAN §14.8 R2). Rows are append-only: an edit
// inserts the difference, leaving `completed` inserts the negative of what is left. Every change posts to
// commission expense 6010 / commissions payable 2300 on the day it is made (branch business date).
import { businessDateOf } from '@spa/core'
import { bookingCommissions, bookingItems, bookings, branches, type Tx } from '@spa/db'
import { eq, sql } from 'drizzle-orm'
import { DomainError } from './errors'
import { post } from './ledger'

type BookingRow = typeof bookings.$inferSelect
export type CommissionInput = { bookingItemId: string; staffId: string; amountAed: number }
type Opts = { userId?: string | null; now?: Date }

const fils = (n: number) => Math.round(n * 100)

async function recordingDate(tx: Tx, branchId: string, now = new Date()) {
  const [br] = await tx
    .select({ cutoff: branches.businessDayCutoff })
    .from(branches)
    .where(eq(branches.id, branchId))
  return businessDateOf(now, br?.cutoff ?? '05:00')
}

/** Current commission (fils) per `itemId:staffId` = sum of the rows. */
export async function commissionTotals(tx: Tx, bookingId: string) {
  const rows = await tx
    .select({
      itemId: bookingCommissions.bookingItemId,
      staffId: bookingCommissions.staffId,
      v: sql<string>`sum(${bookingCommissions.amountAed})`,
    })
    .from(bookingCommissions)
    .where(eq(bookingCommissions.bookingId, bookingId))
    .groupBy(bookingCommissions.bookingItemId, bookingCommissions.staffId)
  return new Map(rows.map((r) => [`${r.itemId}:${r.staffId}`, fils(Number(r.v))]))
}

/** Posts the net change (negative = reversal). */
async function postCommission(tx: Tx, b: BookingRow, netFils: number, opts: Opts) {
  if (netFils === 0) return
  await post(tx, {
    tenantId: b.tenantId,
    branchId: b.branchId,
    date: await recordingDate(tx, b.branchId, opts.now),
    sourceType: netFils > 0 ? 'booking_commission' : 'booking_commission_reversal',
    sourceId: b.id,
    memo: `Therapist commission · ${b.refCode}`,
    createdBy: opts.userId,
    lines: [
      { code: '6010', debit: netFils / 100 },
      { code: '2300', credit: netFils / 100 },
    ],
  })
}

/** Offsets everything recorded on a booking (called when it leaves `completed`; the caller holds the row lock). */
export async function reverseBookingCommissions(tx: Tx, b: BookingRow, opts: Opts = {}) {
  const open = [...(await commissionTotals(tx, b.id))].filter(([, v]) => v !== 0)
  if (!open.length) return
  await tx.insert(bookingCommissions).values(
    open.map(([key, v]) => {
      const [itemId, staffId] = key.split(':') as [string, string]
      return {
        tenantId: b.tenantId,
        bookingId: b.id,
        bookingItemId: itemId,
        staffId,
        businessDate: b.businessDate,
        amountAed: (-v / 100).toFixed(2),
        createdBy: opts.userId ?? null,
      }
    }),
  )
  await postCommission(tx, b, -open.reduce((s, [, v]) => s + v, 0), opts)
}

/**
 * Sets the AED commission for every therapist on a completed booking (all are required; 0 is allowed).
 * Inserts only the difference to what was recorded before.
 */
export async function recordBookingCommissions(
  tx: Tx,
  input: { bookingId: string; amounts: CommissionInput[] } & Opts,
) {
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).for('update')
  if (!b) throw new DomainError('Booking not found', 'not_found')
  if (b.status !== 'completed') throw new DomainError('Mark the booking completed first')
  const items = await tx.select().from(bookingItems).where(eq(bookingItems.bookingId, b.id))
  const expected = new Set(items.flatMap((i) => i.staffIds.map((s) => `${i.id}:${s}`)))
  const given = new Map<string, number>()
  for (const a of input.amounts) {
    const key = `${a.bookingItemId}:${a.staffId}`
    if (!expected.has(key) || given.has(key)) throw new DomainError('Therapist not found', 'not_found')
    if (!Number.isFinite(a.amountAed) || a.amountAed < 0 || a.amountAed > 100_000)
      throw new DomainError('Enter a commission between 0 and 100,000 AED')
    given.set(key, fils(a.amountAed))
  }
  if (given.size !== expected.size) throw new DomainError('Enter the commission for every therapist')
  const totals = await commissionTotals(tx, b.id)
  const rows: (typeof bookingCommissions.$inferInsert)[] = []
  let net = 0
  for (const [key, want] of given) {
    const had = totals.get(key)
    const delta = want - (had ?? 0)
    // A first entry of 0 is stored too, so the booking reads as "commission entered".
    if (delta === 0 && had !== undefined) continue
    const [itemId, staffId] = key.split(':') as [string, string]
    rows.push({
      tenantId: b.tenantId,
      bookingId: b.id,
      bookingItemId: itemId,
      staffId,
      businessDate: b.businessDate,
      amountAed: (delta / 100).toFixed(2),
      createdBy: input.userId ?? null,
    })
    net += delta
  }
  if (rows.length) await tx.insert(bookingCommissions).values(rows)
  await postCommission(tx, b, net, input)
  return { changed: rows.length, totalAed: [...given.values()].reduce((s, v) => s + v, 0) / 100 }
}
