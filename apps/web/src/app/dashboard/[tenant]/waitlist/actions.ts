'use server'
import { dubaiInstant } from '@spa/core'
import { type Tx, waitlistEntries, withTenant } from '@spa/db'
import {
  addToWaitlist,
  bookFromWaitlist,
  cancelWaitlistEntry,
  DomainError,
  enqueueBookingMessage,
  findOrCreateClient,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { timeToGridMinute } from '@/components/calendar/time'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { guard, type MemberContext } from '@/server/access'
import { audit } from '@/server/audit'
import { allowedBranches } from '../calendar/data'

const DAY_MS = 24 * 3600_000
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'waitlist.error.date')
const optTime = z
  .union([z.string().regex(/^\d{2}:\d{2}$/, 'waitlist.error.time'), z.literal('')])
  .optional()
  .transform((v) => v || null)
const optId = z
  .union([z.uuid(), z.literal('')])
  .optional()
  .transform((v) => v || null)

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}
/** Instant of "HH:MM" on a business date (times before the cutoff belong to the next calendar day). */
const instant = (d: string, t: string, cutoff: string) =>
  dubaiInstant(d, timeToGridMinute(t, toMin(cutoff.slice(0, 5))))

async function branchFor(tx: Tx, ctx: MemberContext, branchId: string) {
  const branch = (await allowedBranches(tx, ctx)).find((b) => b.id === branchId)
  if (!branch) throw new DomainError('Branch not found', 'not_found')
  return branch
}

const revalidate = (slug: string) => {
  revalidatePath(`/dashboard/${slug}/waitlist`)
  revalidatePath(`/dashboard/${slug}/calendar`)
}
const handle = (e: unknown): ActionResult => {
  if (e instanceof DomainError) return failDomain(e)
  throw e
}

const addSchema = z.object({
  branchId: z.uuid(),
  date,
  from: optTime,
  until: optTime,
  serviceId: optId,
  clientName: z.string().trim().min(2, 'waitlist.error.name').max(120),
  clientPhone: z.string().trim().min(6, 'waitlist.error.phone').max(30),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
})

export async function addWaitlistAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'calendar.manage')
  if (error) return fail(error)
  const parsed = addSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const v = parsed.data
  try {
    const entry = await withTenant(ctx.tenant.id, async (tx) => {
      const branch = await branchFor(tx, ctx, v.branchId)
      const client = await findOrCreateClient(tx, ctx.tenant.id, {
        name: v.clientName,
        phone: v.clientPhone,
        source: 'waitlist',
      })
      return addToWaitlist(tx, {
        tenantId: ctx.tenant.id,
        branchId: branch.id,
        clientId: client.id,
        serviceId: v.serviceId,
        businessDate: v.date,
        fromAt: v.from ? instant(v.date, v.from, branch.businessDayCutoff) : null,
        untilAt: v.until ? instant(v.date, v.until, branch.businessDayCutoff) : null,
        notes: v.notes,
        createdBy: ctx.user.id,
      })
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'waitlist.added',
      entity: 'waitlist_entry',
      entityId: entry.id,
      data: { date: v.date },
    })
    revalidate(slug)
    return ok('waitlist.result.added', { id: entry.id })
  } catch (e) {
    return handle(e)
  }
}

/** The entry must be in a branch the member may use. */
async function entryFor(tx: Tx, ctx: MemberContext, entryId: string) {
  const [entry] = await tx.select().from(waitlistEntries).where(eq(waitlistEntries.id, entryId))
  if (!entry) throw new DomainError('Waitlist entry not found', 'not_found')
  const branch = await branchFor(tx, ctx, entry.branchId)
  return { entry, branch }
}

export async function removeWaitlistAction(slug: string, entryId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'calendar.manage')
  if (error) return fail(error)
  if (!z.uuid().safeParse(entryId).success) return fail('errors.notFound')
  try {
    await withTenant(ctx.tenant.id, async (tx) => {
      await entryFor(tx, ctx, entryId)
      await cancelWaitlistEntry(tx, entryId)
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'waitlist.removed',
      entity: 'waitlist_entry',
      entityId: entryId,
    })
    revalidate(slug)
    return ok('waitlist.result.removed')
  } catch (e) {
    return handle(e)
  }
}

const bookSchema = z.object({
  variantId: z.uuid('waitlist.error.variant'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'waitlist.error.time'),
  staffId: optId,
})

/** Waitlist → booking through the normal createBooking path, plus the usual confirmation + reminder messages. */
export async function bookWaitlistAction(
  slug: string,
  entryId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'calendar.manage')
  if (error) return fail(error)
  const parsed = bookSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const v = parsed.data
  try {
    const booking = await withTenant(ctx.tenant.id, async (tx) => {
      const { entry, branch } = await entryFor(tx, ctx, entryId)
      const start = instant(entry.businessDate, v.time, branch.businessDayCutoff)
      const { booking } = await bookFromWaitlist(tx, entryId, {
        source: 'phone',
        status: 'confirmed',
        createdBy: ctx.user.id,
        notes: entry.notes,
        items: [{ serviceVariantId: v.variantId, start, staffIds: v.staffId ? [v.staffId] : undefined }],
      })
      await enqueueBookingMessage(tx, booking.id, 'booking_confirmation')
      if (start.getTime() > Date.now())
        await enqueueBookingMessage(
          tx,
          booking.id,
          'reminder',
          new Date(Math.max(Date.now(), start.getTime() - DAY_MS)),
        )
      return booking
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'booking.created',
      entity: 'booking',
      entityId: booking.id,
      data: { ref: booking.refCode, source: 'waitlist', waitlistEntryId: entryId },
    })
    revalidate(slug)
    return ok({ key: 'waitlist.result.booked', params: { ref: booking.refCode } }, { ref: booking.refCode })
  } catch (e) {
    return handle(e)
  }
}
