'use server'
// B5.4 — kiosk clock in/out, PINs, clock-time fixes and leave requests.
import { businessDateOf, dubaiInstant } from '@spa/core'
import { leaveRequests, withTenant } from '@spa/db'
import {
  adjustTimeEntry,
  cancelLeave,
  DomainError,
  decideLeave,
  punch,
  requestLeave,
  setStaffPin,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getI18n } from '@/i18n/server'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { can, guard, requireMember } from '@/server/access'
import { audit } from '@/server/audit'
import { allowedBranches, ownStaffId } from '../calendar/data'

const uuid = z.string().uuid()
const DATE = /^\d{4}-\d{2}-\d{2}$/
const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/

const refresh = (slug: string) => {
  revalidatePath(`/dashboard/${slug}/timeclock`)
  revalidatePath(`/dashboard/${slug}/calendar`)
}

const handle = (e: unknown) => {
  if (e instanceof DomainError) return failDomain(e)
  throw e
}

/** "2026-10-06T09:30" (Dubai wall clock, from datetime-local) → instant. */
const fromLocal = (v: string) => {
  const m = LOCAL.exec(v)
  return m ? dubaiInstant(m[1]!, Number(m[2]) * 60 + Number(m[3])) : null
}

async function record(
  ctx: Awaited<ReturnType<typeof requireMember>>,
  action: string,
  entityId: string,
  data?: unknown,
) {
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action,
    entity: action.split('.')[0]!,
    entityId,
    data,
  })
}

const punchSchema = z.object({
  staffId: uuid,
  branchId: uuid,
  pin: z.string().regex(/^\d{4,8}$/, 'timeclock.kiosk.wrongPin'),
})

export async function punchAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'timeclock.kiosk')
  if (error) return fail(error)
  const parsed = punchSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const { fmt } = await getI18n()
  try {
    const r = await withTenant(ctx.tenant.id, async (tx) => {
      const branches = await allowedBranches(tx, ctx)
      if (!branches.some((b) => b.id === parsed.data.branchId)) return null
      return punch(tx, { tenantId: ctx.tenant.id, ...parsed.data })
    })
    if (!r) return fail('errors.forbidden')
    if (!r.ok)
      return r.reason === 'locked'
        ? fail({ key: 'timeclock.kiosk.locked', params: { count: r.minutes ?? 5 } })
        : fail('timeclock.kiosk.wrongPin', { pin: 'timeclock.kiosk.wrongPin' })
    await record(ctx, `timeclock.${r.action}`, parsed.data.staffId, { at: r.at })
    refresh(slug)
    return r.action === 'in'
      ? ok({ key: 'timeclock.kiosk.clockedIn', params: { name: r.name, time: fmt.time(r.at) } })
      : ok({
          key: 'timeclock.kiosk.clockedOut',
          params: {
            name: r.name,
            hours: {
              key: 'timeclock.hm',
              params: { h: Math.floor((r.workedMin ?? 0) / 60), m: (r.workedMin ?? 0) % 60 },
            },
          },
        })
  } catch (e) {
    return handle(e)
  }
}

const pinSchema = z.object({
  staffId: uuid,
  pin: z
    .string()
    .trim()
    .regex(/^(\d{4,8})?$/, 'timeclock.pin.v'),
})

export async function setPinAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'timeclock.approve')
  if (error) return fail(error)
  const parsed = pinSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const pin = parsed.data.pin || null
  try {
    await withTenant(ctx.tenant.id, (tx) => setStaffPin(tx, parsed.data.staffId, pin))
  } catch (e) {
    return handle(e)
  }
  await record(ctx, pin ? 'timeclock.pin_set' : 'timeclock.pin_cleared', parsed.data.staffId)
  refresh(slug)
  return ok(pin ? 'timeclock.pin.saved' : 'timeclock.pin.cleared')
}

const fixSchema = z.object({
  entryId: uuid,
  clockIn: z.string().regex(LOCAL, 'timeclock.sheet.v'),
  clockOut: z
    .string()
    .regex(LOCAL, 'timeclock.sheet.v')
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

export async function fixEntryAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'timeclock.approve')
  if (error) return fail(error)
  const parsed = fixSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const clockIn = fromLocal(parsed.data.clockIn)!
  const clockOut = parsed.data.clockOut ? fromLocal(parsed.data.clockOut) : null
  try {
    await withTenant(ctx.tenant.id, (tx) => adjustTimeEntry(tx, parsed.data.entryId, { clockIn, clockOut }))
  } catch (e) {
    return handle(e)
  }
  await record(ctx, 'timeclock.entry_fixed', parsed.data.entryId, { clockIn, clockOut })
  refresh(slug)
  return ok('timeclock.sheet.fixed')
}

const leaveSchema = z
  .object({
    staffId: z.string().uuid('timeclock.leave.v.member'),
    type: z.enum(['annual', 'sick', 'unpaid'], { message: 'timeclock.leave.v.type' }),
    startDate: z.string().regex(DATE, 'timeclock.leave.v.dates'),
    endDate: z.string().regex(DATE, 'timeclock.leave.v.dates'),
    note: z.string().trim().max(300).optional(),
  })
  .refine((d) => d.endDate >= d.startDate, { path: ['endDate'], message: 'timeclock.leave.v.order' })

export async function requestLeaveAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireMember(slug)
  const approver = can(ctx, 'timeclock.approve')
  const { error } = await guard(slug, approver ? 'timeclock.approve' : 'timeclock.leave')
  if (error) return fail(error)
  const parsed = leaveSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  try {
    const row = await withTenant(ctx.tenant.id, async (tx) => {
      // Without approval rights a member may only ask for their own leave.
      if (!approver && (await ownStaffId(tx, ctx)) !== parsed.data.staffId) return null
      return requestLeave(tx, { tenantId: ctx.tenant.id, ...parsed.data, requestedBy: ctx.user.id })
    })
    if (!row) return fail('errors.forbidden')
    await record(ctx, 'leave.requested', row.id, parsed.data)
  } catch (e) {
    return handle(e)
  }
  refresh(slug)
  return ok('timeclock.leave.requested')
}

export async function decideLeaveAction(
  slug: string,
  id: string,
  status: 'approved' | 'rejected',
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'timeclock.approve')
  if (error) return fail(error)
  if (!uuid.safeParse(id).success || (status !== 'approved' && status !== 'rejected'))
    return fail('errors.domain.leaveNotFound')
  try {
    const r = await withTenant(ctx.tenant.id, (tx) => decideLeave(tx, { id, status, userId: ctx.user.id }))
    await record(ctx, `leave.${status}`, id, { clashes: r.clashes })
    refresh(slug)
    if (status === 'rejected') return ok('timeclock.leave.rejected')
    return r.clashes
      ? ok({ key: 'timeclock.leave.approvedClashes', params: { count: r.clashes } })
      : ok('timeclock.leave.approved')
  } catch (e) {
    return handle(e)
  }
}

export async function withdrawLeaveAction(slug: string, id: string): Promise<ActionResult> {
  const ctx = await requireMember(slug)
  const approver = can(ctx, 'timeclock.approve')
  const { error } = await guard(slug, approver ? 'timeclock.approve' : 'timeclock.leave')
  if (error) return fail(error)
  if (!uuid.safeParse(id).success) return fail('errors.domain.leaveNotFound')
  try {
    const done = await withTenant(ctx.tenant.id, async (tx) => {
      if (!approver) {
        const [req] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id))
        const own = await ownStaffId(tx, ctx)
        if (!req || req.staffId !== own) return false
      }
      const [anyBranch] = await allowedBranches(tx, ctx)
      const today = businessDateOf(new Date(), anyBranch?.businessDayCutoff.slice(0, 5))
      await cancelLeave(tx, id, { allowApproved: approver, today })
      return true
    })
    if (!done) return fail('errors.forbidden')
  } catch (e) {
    return handle(e)
  }
  await record(ctx, 'leave.withdrawn', id)
  refresh(slug)
  return ok('timeclock.leave.withdrawn')
}
