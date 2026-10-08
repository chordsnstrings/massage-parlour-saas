'use server'
import type { Tx } from '@spa/db'
import { bookings, withTenant } from '@spa/db'
import { completeBooking, DomainError, recordBookingCommissions, setBookingStatus } from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { allowedBranches } from '@/app/dashboard/[tenant]/calendar/data'
import { type ActionResult, fail, failDomain, fromZod, ok } from '@/lib/action'
import { can, guard, type MemberContext } from '@/server/access'
import { audit } from '@/server/audit'

const revalidate = (slug: string) => {
  revalidatePath(`/dashboard/${slug}/bookings`, 'layout')
  revalidatePath(`/dashboard/${slug}/calendar`)
}

const handle = (e: unknown): ActionResult => {
  if (e instanceof DomainError) return failDomain(e)
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
 * Completes a booking with the therapist commission (fields `c:<itemId>:<staffId>`), or corrects the
 * commission of an already completed one. Needs `calendar.manage` + `calendar.commission`.
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
    const { updated, completed } = await withTenant(ctx.tenant.id, async (tx) => {
      const b = await ownBooking(tx, ctx, bookingId)
      if (b.status === 'completed') {
        await recordBookingCommissions(tx, { bookingId, amounts, userId: ctx.user.id })
        return { updated: b, completed: false }
      }
      const updated = await completeBooking(tx, { bookingId, amounts, userId: ctx.user.id })
      return { updated, completed: true }
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: completed ? 'booking.completed' : 'booking.commission',
      entity: 'booking',
      entityId: bookingId,
      data: { amounts },
    })
    revalidate(slug)
    return ok(
      completed
        ? { key: 'bookings.results.completed', params: { ref: updated.refCode } }
        : 'bookings.results.saved',
    )
  } catch (e) {
    return handle(e)
  }
}
