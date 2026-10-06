'use server'
import { payrollLines, payrollRuns, staff, tenants, withTenant } from '@spa/db'
import { buildPayroll, DomainError, finalisePayroll, recordAdvance } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
const done = (slug: string, message: string) => {
  revalidatePath(`/dashboard/${slug}/payroll`, 'layout')
  return ok(message)
}
const domain = (e: unknown) => {
  if (e instanceof DomainError) return fail(e.message)
  const msg = `${e instanceof Error ? e.message : ''} ${(e as { cause?: Error })?.cause?.message ?? ''}`
  if (/locked/i.test(msg)) return fail('That date is in a closed accounting period.')
  throw e
}

/** Builds the draft run for a month; an existing draft for the same month is rebuilt from scratch. */
export async function prepareRunAction(
  slug: string,
  from: string,
  to: string,
  _p: ActionResult,
  _fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'staff.manage')
  if (error) return fail(error)
  try {
    await withTenant(ctx.tenant.id, async (tx) => {
      const existing = await tx
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.periodStart, from), eq(payrollRuns.periodEnd, to)))
      if (existing.some((r) => r.status === 'finalised'))
        throw new DomainError('This month is already finalised.')
      for (const r of existing) {
        await tx.delete(payrollLines).where(eq(payrollLines.runId, r.id))
        await tx.delete(payrollRuns).where(eq(payrollRuns.id, r.id))
      }
      await buildPayroll(tx, {
        tenantId: ctx.tenant.id,
        periodStart: from,
        periodEnd: to,
        createdBy: ctx.user.id,
      })
    })
  } catch (e) {
    return domain(e)
  }
  return done(slug, 'Payroll prepared — review it, then finalise')
}

export async function finaliseRunAction(
  slug: string,
  runId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'staff.manage')
  if (error) return fail(error)
  const parsed = z.object({ paidOn: date }).safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  try {
    await withTenant(ctx.tenant.id, async (tx) => {
      await finalisePayroll(tx, runId, parsed.data.paidOn, ctx.user.id)
    })
  } catch (e) {
    return domain(e)
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'payroll.finalised',
    entityId: runId,
  })
  return done(slug, 'Payroll finalised and posted to the accounts')
}

export async function recordAdvanceAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'staff.manage')
  if (error) return fail(error)
  const parsed = z
    .object({
      staffId: z.string().uuid('Pick a team member'),
      amountAed: z.coerce.number({ message: 'Enter an amount' }).positive('Enter an amount').max(100_000),
      date,
      paidVia: z.enum(['cash', 'bank']),
      note: z.string().trim().max(200).optional(),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  try {
    await withTenant(ctx.tenant.id, (tx) =>
      recordAdvance(tx, { tenantId: ctx.tenant.id, ...d, createdBy: ctx.user.id, note: d.note || undefined }),
    )
  } catch (e) {
    return domain(e)
  }
  await audit({ tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: 'advance.recorded', data: d })
  return done(slug, 'Advance recorded — it will be deducted in the next payroll')
}

const iban = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/\s+/g, ''))
  .refine((v) => v === '' || /^AE\d{21}$/.test(v), 'UAE IBANs are AE + 21 digits')

export async function saveEmployerAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'staff.manage')
  if (error) return fail(error)
  const parsed = z
    .object({
      employerId: z
        .string()
        .trim()
        .regex(/^\d{6,13}$/, 'The 13-digit MOHRE establishment ID'),
      routingCode: z
        .string()
        .trim()
        .regex(/^\d{9}$/, '9-digit routing code'),
      bank: z.string().trim().max(60).optional(),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  await withTenant(ctx.tenant.id, async (tx) => {
    const [t] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenant.id))
    await tx
      .update(tenants)
      .set({ settings: { ...(t?.settings ?? {}), wps: parsed.data } })
      .where(eq(tenants.id, ctx.tenant.id))
  })
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'wps.employer.updated',
    data: parsed.data,
  })
  return done(slug, 'WPS details saved')
}

export async function saveStaffPayAction(
  slug: string,
  staffId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'staff.manage')
  if (error) return fail(error)
  const parsed = z
    .object({
      personId: z
        .string()
        .trim()
        .refine((v) => v === '' || /^\d{14}$/.test(v), 'The 14-digit MOHRE person code'),
      labourCardNo: z.string().trim().max(30).optional(),
      iban,
      routingCode: z
        .string()
        .trim()
        .refine((v) => v === '' || /^\d{9}$/.test(v), '9-digit routing code'),
      bank: z.string().trim().max(60).optional(),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const updated = await withTenant(ctx.tenant.id, (tx) =>
    tx.update(staff).set({ payroll: parsed.data }).where(eq(staff.id, staffId)).returning({ id: staff.id }),
  )
  if (!updated.length) return fail('Team member not found')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'staff.pay_details.updated',
    entityId: staffId,
  })
  return done(slug, 'Pay details saved')
}
