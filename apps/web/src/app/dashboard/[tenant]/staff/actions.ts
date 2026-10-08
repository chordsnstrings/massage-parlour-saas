'use server'
import { addDays, dubaiInstant, dubaiParts, toUaeE164, type Weekday } from '@spa/core'
import { branches, members, services, shifts, staff, staffServices, withTenant } from '@spa/db'
import { pgCode } from '@spa/services'
import { eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { IMAGE_URL_PATTERN } from '@/components/media/types'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const PERM = 'staff.manage' as const
const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MAX_RANGE_DAYS = 92
const uuidOrEmpty = z
  .string()
  .uuid()
  .optional()
  .or(z.literal('').transform(() => undefined))
const asArray = (v: unknown) => (v === undefined || v === '' ? [] : Array.isArray(v) ? v : [v])
const bool = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean())
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'staff.validation.time')
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

type Ctx = Awaited<ReturnType<typeof guard>>['ctx']
const record = (ctx: Ctx, action: string, entityId: string, data?: unknown) =>
  audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action,
    entity: 'staff',
    entityId,
    data,
  })

const refresh = (slug: string) => revalidatePath(`/dashboard/${slug}/staff`, 'layout')

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const staffSchema = z.object({
  id: uuidOrEmpty,
  displayName: z.string().trim().min(2, 'staff.validation.name').max(60),
  gender: z.enum(['female', 'male', 'other', '']).transform((v) => v || null),
  phone: z.string().trim().max(30).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'staff.validation.colour'),
  bookable: bool,
  active: bool,
  commissionPct: z.coerce
    .number()
    .min(0, 'staff.validation.commission')
    .max(100, 'staff.validation.commission'),
  baseSalaryAed: z.coerce.number().min(0, 'staff.validation.amount').max(1_000_000),
  memberId: uuidOrEmpty,
  skills: z.preprocess(asArray, z.array(z.string().uuid())),
  photoUrl: z
    .string()
    .trim()
    .max(500)
    .regex(IMAGE_URL_PATTERN, 'staff.validation.photo')
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

export async function saveStaffAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, PERM)
  if (error) return fail(error)
  const parsed = staffSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const phoneE164 = d.phone ? toUaeE164(d.phone) : null
  if (d.phone && !phoneE164) return fail('staff.result.uaeMobile', { phone: 'validation.uaeMobile' })
  const values = {
    displayName: d.displayName,
    gender: d.gender,
    phoneE164,
    color: d.color,
    bookable: d.bookable,
    active: d.active,
    commissionPct: d.commissionPct.toFixed(2),
    baseSalaryAed: d.baseSalaryAed.toFixed(2),
    memberId: d.memberId ?? null,
    // Only forms that post the field change the photo.
    ...(formData.has('photoUrl') ? { photoUrl: d.photoUrl ?? null } : {}),
  }
  const result = await withTenant(ctx.tenant.id, async (tx) => {
    if (d.memberId) {
      const [m] = await tx.select({ id: members.id }).from(members).where(eq(members.id, d.memberId))
      if (!m) return { error: 'staff.result.memberGone' }
      const [taken] = await tx.select({ id: staff.id }).from(staff).where(eq(staff.memberId, d.memberId))
      if (taken && taken.id !== d.id) return { error: 'staff.result.memberTaken' }
    }
    let staffId = d.id
    if (staffId) {
      const [row] = await tx
        .update(staff)
        .set(values)
        .where(eq(staff.id, staffId))
        .returning({ id: staff.id })
      if (!row) return { error: 'staff.result.notFound' }
    } else {
      const existing = await tx.select({ id: staff.id }).from(staff)
      const [row] = await tx
        .insert(staff)
        .values({ tenantId: ctx.tenant.id, ...values, sort: existing.length })
        .returning({ id: staff.id })
      staffId = row!.id
    }
    // Skills: only services of this tenant (RLS) are accepted.
    const valid = d.skills.length
      ? (await tx.select({ id: services.id }).from(services).where(inArray(services.id, d.skills))).map(
          (s) => s.id,
        )
      : []
    await tx.delete(staffServices).where(eq(staffServices.staffId, staffId))
    if (valid.length)
      await tx
        .insert(staffServices)
        .values(valid.map((serviceId) => ({ tenantId: ctx.tenant.id, staffId: staffId!, serviceId })))
    return { id: staffId }
  })
  if ('error' in result) return fail(result.error as string)
  await record(ctx, d.id ? 'staff.updated' : 'staff.created', result.id, { ...values, skills: d.skills })
  refresh(slug)
  return ok(d.id ? 'staff.result.saved' : 'staff.result.added', { id: result.id })
}

export async function deleteStaffAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, PERM)
  if (error) return fail(error)
  if (!z.string().uuid().safeParse(id).success) return fail('staff.result.notFound')
  // Keep history (bookings, commissions): archive rather than delete.
  await withTenant(ctx.tenant.id, (tx) =>
    tx.update(staff).set({ active: false, bookable: false }).where(eq(staff.id, id)),
  )
  await record(ctx, 'staff.archived', id)
  refresh(slug)
  return ok('staff.result.archived')
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

const patternSchema = z
  .object({
    staffId: z.string().uuid(),
    branchId: z.string().uuid('staff.validation.branch'),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'staff.validation.date'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'staff.validation.date'),
    ...Object.fromEntries(
      WEEKDAYS.flatMap((d) => [
        [`${d}_on`, bool],
        [`${d}_start`, hhmm.optional().or(z.literal(''))],
        [`${d}_end`, hhmm.optional().or(z.literal(''))],
      ]),
    ),
  })
  .transform((raw, zctx) => {
    const r = raw as Record<string, unknown> & { staffId: string; branchId: string; from: string; to: string }
    const days = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000)
    if (days < 0) zctx.addIssue({ code: 'custom', path: ['to'], message: 'staff.validation.endBeforeStart' })
    else if (days >= MAX_RANGE_DAYS)
      zctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'staff.validation.maxRange' /* MAX_RANGE_DAYS */,
      })
    const pattern: Partial<Record<Weekday, { start: number; end: number }>> = {}
    for (const d of WEEKDAYS) {
      if (!r[`${d}_on`]) continue
      const s = r[`${d}_start`] as string | undefined
      const e = r[`${d}_end`] as string | undefined
      if (!s || !e) {
        zctx.addIssue({ code: 'custom', path: [d], message: 'staff.validation.setStartEnd' })
        continue
      }
      let end = toMin(e)
      const start = toMin(s)
      if (end === start) {
        zctx.addIssue({ code: 'custom', path: [d], message: 'staff.validation.sameStartEnd' })
        continue
      }
      if (end < start) end += 1440 // ends after midnight
      pattern[d] = { start, end }
    }
    if (Object.keys(pattern).length === 0)
      zctx.addIssue({ code: 'custom', path: ['pattern'], message: 'staff.validation.oneDay' })
    return { staffId: r.staffId, branchId: r.branchId, from: r.from, to: r.to, days, pattern }
  })

export async function generateShiftsAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, PERM)
  if (error) return fail(error)
  const parsed = patternSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const result = await withTenant(ctx.tenant.id, async (tx) => {
    const [person] = await tx.select({ id: staff.id }).from(staff).where(eq(staff.id, d.staffId))
    const [branch] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, d.branchId))
    if (!person || !branch) return null
    let added = 0
    let clashes = 0
    for (let i = 0; i <= d.days; i++) {
      const date = addDays(d.from, i)
      const slot = d.pattern[dubaiParts(dubaiInstant(date, 12 * 60)).weekday]
      if (!slot) continue
      try {
        // Savepoint per shift: the EXCLUDE constraint rejects overlaps (23P01) without aborting the rest.
        await tx.transaction((sp) =>
          sp.insert(shifts).values({
            tenantId: ctx.tenant.id,
            staffId: d.staffId,
            branchId: d.branchId,
            startsAt: dubaiInstant(date, slot.start),
            endsAt: dubaiInstant(date, slot.end),
          }),
        )
        added++
      } catch (e) {
        if (pgCode(e) !== '23P01') throw e
        clashes++
      }
    }
    return { added, clashes }
  })
  if (!result) return fail('staff.result.staffOrBranchGone')
  if (result.added === 0 && result.clashes > 0) return fail('staff.result.allOverlap')
  await record(ctx, 'staff.shifts_generated', d.staffId, { ...d, ...result })
  refresh(slug)
  return ok(
    result.clashes
      ? { key: 'staff.result.shiftsAddedSkipped', params: { count: result.added, skipped: result.clashes } }
      : { key: 'staff.result.shiftsAdded', params: { count: result.added } },
  )
}

export async function deleteShiftAction(slug: string, shiftId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, PERM)
  if (error) return fail(error)
  if (!z.string().uuid().safeParse(shiftId).success) return fail('staff.result.shiftNotFound')
  const [row] = await withTenant(ctx.tenant.id, (tx) =>
    tx.delete(shifts).where(eq(shifts.id, shiftId)).returning({ staffId: shifts.staffId }),
  )
  if (!row) return fail('staff.result.shiftNotFound')
  await record(ctx, 'staff.shift_deleted', row.staffId, { shiftId })
  refresh(slug)
  return ok('staff.result.shiftRemoved')
}
