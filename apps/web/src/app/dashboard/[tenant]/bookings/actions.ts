'use server'
import type { Tx } from '@spa/db'
import { bookings, withTenant } from '@spa/db'
import {
  commissionTotals,
  correctBookingOrder,
  DomainError,
  orderDay,
  PAY_METHODS,
  POS_METHODS,
  recordBookingCommissions,
  setBookingStatus,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { allowedBranches } from '@/app/dashboard/[tenant]/calendar/data'
import { type ActionResult, fail, failDomain, fromZod, ok } from '@/lib/action'
import { can, guard, type MemberContext } from '@/server/access'
import { audit } from '@/server/audit'
import { afterDayChange, editDay, periodLocked } from '@/server/day-lock'

const revalidate = (slug: string) => {
  revalidatePath(`/dashboard/${slug}/bookings`, 'layout')
  revalidatePath(`/dashboard/${slug}/calendar`)
}

const handle = (e: unknown): ActionResult => {
  if (e instanceof DomainError) return failDomain(e)
  if (periodLocked(e)) return fail('accounts.result.lockedDate')
  throw e
}

/** The booking, if it is in a branch this member may work in. */
async function ownBooking(tx: Tx, ctx: MemberContext, bookingId: string) {
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId))
  if (!b || !(await allowedBranches(tx, ctx)).some((br) => br.id === b.branchId))
    throw new DomainError('Booking not found', 'not_found')
  return b
}

const markSchema = z.object({
  bookingId: z.uuid(),
  mark: z.enum(['pending', 'cancelled']),
  reason: z.string().trim().max(300).optional(),
})

/** Pending / Cancelled marks (Completed goes through the commission form). */
export async function markBookingAction(
  slug: string,
  input: z.input<typeof markSchema>,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'calendar.manage')
  if (error) return fail(error)
  const parsed = markSchema.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  const { bookingId, mark, reason } = parsed.data
  try {
    const { updated, from } = await withTenant(ctx.tenant.id, async (tx) => {
      const b = await ownBooking(tx, ctx, bookingId)
      // Re-opening a completed booking reverses commission — same permission as entering it.
      if (b.status === 'completed' && !can(ctx, 'calendar.commission'))
        throw new DomainError('Booking not found', 'not_found')
      const updated = await setBookingStatus(tx, bookingId, mark, reason || undefined, {
        userId: ctx.user.id,
      })
      return { updated, from: b.status }
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: `booking.${mark}`,
      entity: 'booking',
      entityId: bookingId,
      data: { from, ...(reason ? { reason } : {}) },
    })
    revalidate(slug)
    return ok({
      key: 'bookings.results.marked',
      params: { ref: updated.refCode, mark: { key: `bookings.mark.${mark}` } },
    })
  } catch (e) {
    return handle(e)
  }
}

const amount = z.coerce
  .number({ error: 'bookings.errors.amount' })
  .min(0, 'bookings.errors.amount')
  .max(100_000, 'bookings.errors.amount')

/**
 * Corrects the therapist commission of a completed booking (fields `c:<itemId>:<staffId>`; only the differences
 * post). R32: completing happens only through Finish & pay (its sale), so other bookings are refused; the day lock
 * (D6) applies on the booking's business date. Needs `calendar.manage` + `calendar.commission`.
 */
export async function saveCommissionAction(
  slug: string,
  bookingId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'calendar.manage')
  if (error) return fail(error)
  if (!can(ctx, 'calendar.commission')) return fail('errors.forbidden')
  if (!z.uuid().safeParse(bookingId).success) return fail('errors.generic')
  const amounts: { bookingItemId: string; staffId: string; amountAed: number }[] = []
  const fieldErrors: Record<string, string> = {}
  for (const [key, raw] of formData.entries()) {
    const m = /^c:([0-9a-f-]{36}):([0-9a-f-]{36})$/.exec(key)
    if (!m) continue
    const parsed = amount.safeParse(typeof raw === 'string' && raw.trim() !== '' ? raw : undefined)
    if (!parsed.success) fieldErrors[key] = 'bookings.errors.amount'
    else amounts.push({ bookingItemId: m[1]!, staffId: m[2]!, amountAed: parsed.data })
  }
  if (Object.keys(fieldErrors).length) return fail('bookings.errors.amount', fieldErrors)
  try {
    const r = await withTenant(ctx.tenant.id, async (tx) => {
      const b = await ownBooking(tx, ctx, bookingId)
      if (b.status !== 'completed') return null
      const lock = await editDay(tx, ctx, b.branchId, b.businessDate)
      const before = Object.fromEntries(await commissionTotals(tx, bookingId))
      await recordBookingCommissions(tx, { bookingId, amounts, userId: ctx.user.id })
      const after = Object.fromEntries(await commissionTotals(tx, bookingId))
      return { lock, before, after }
    })
    if (!r) return fail('bookings.errors.finishAtCheckout')
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'booking.commission',
      entity: 'booking',
      entityId: bookingId,
      // fils per `itemId:staffId` before → after
      data: { amounts, before: r.before, after: r.after, closedDay: r.lock.closed },
    })
    await afterDayChange(ctx, r.lock)
    revalidate(slug)
    return ok('bookings.results.saved')
  } catch (e) {
    return handle(e)
  }
}

const correctSchema = z.object({
  reason: z.string().trim().min(3, 'bookings.errors.reason').max(300),
  lines: z
    .array(z.object({ saleLineId: z.uuid(), unitPriceAed: amount }))
    .max(24)
    .optional(),
  payments: z
    .array(
      z.object({
        method: z.enum(PAY_METHODS),
        amountAed: amount,
        reference: z.string().trim().max(300).nullish(),
      }),
    )
    .max(8)
    .optional(),
  tips: z
    .array(z.object({ staffId: z.uuid(), amountAed: amount, method: z.enum(POS_METHODS) }))
    .max(12)
    .optional(),
  commissions: z
    .array(z.object({ bookingItemId: z.uuid(), staffId: z.uuid(), amountAed: amount }))
    .max(24)
    .optional(),
})
export type CorrectOrderPayload = z.input<typeof correctSchema>

/**
 * R32 (D4) Correct payment: new fee / payment split / tips → the sale is voided and re-created on the same business
 * date in one transaction (no pos.refund: the void and the new sale are one atomic correction); commission changes
 * post only the differences. Day lock (D6) on the sale's date. Needs pos.use + calendar.commission.
 */
export async function correctOrderAction(
  slug: string,
  bookingId: string,
  payload: CorrectOrderPayload,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'pos.use')
  if (error) return fail(error)
  if (!can(ctx, 'calendar.commission')) return fail('errors.forbidden')
  if (!z.uuid().safeParse(bookingId).success) return fail('errors.generic')
  const parsed = correctSchema.safeParse(payload)
  if (!parsed.success) return fromZod(parsed.error)
  const v = parsed.data
  try {
    const r = await withTenant(ctx.tenant.id, async (tx) => {
      await ownBooking(tx, ctx, bookingId)
      const day = await orderDay(tx, bookingId)
      const lock = await editDay(tx, ctx, day.branchId, day.date)
      const done = await correctBookingOrder(tx, {
        bookingId,
        reason: v.reason,
        lines: v.lines,
        payments: v.payments?.filter((p) => p.amountAed > 0),
        tips: v.tips?.filter((t) => t.amountAed > 0),
        commissions: v.commissions,
        allowClosedDay: lock.closed,
        userId: ctx.user.id,
      })
      return { ...done, lock }
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'booking.order_corrected',
      entity: 'booking',
      entityId: bookingId,
      data: {
        reason: v.reason,
        before: r.before,
        after: r.after,
        voidedSale: r.voidedSaleId,
        sale: r.sale.number,
        closedDay: r.lock.closed,
      },
    })
    await afterDayChange(ctx, r.lock)
    revalidate(slug)
    revalidatePath(`/dashboard/${slug}/sales`, 'layout')
    return ok({ key: 'bookings.results.corrected', params: { number: r.sale.number } }, { saleId: r.sale.id })
  } catch (e) {
    return handle(e)
  }
}
