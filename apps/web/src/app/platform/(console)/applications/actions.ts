'use server'
// Console: accept / reject spa applications (PLAN §18.3). Super-admin only — re-checked here, not just in the page.
import { platformDb } from '@spa/db'
import { acceptApplication, DomainError, rejectApplication, SETUP_PAYMENT_METHODS } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { todayDubai } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { emailApplicationAccepted, emailApplicationRejected } from '@/server/applications'
import { audit } from '@/server/audit'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
const text = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null)

const revalidate = (id: string) => {
  revalidatePath('/platform/applications')
  revalidatePath(`/platform/applications/${id}`)
  revalidatePath('/platform')
}

export async function acceptApplicationAction(
  applicationId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const parsed = z
    .object({
      planId: z.uuid('Choose a plan'),
      startDate: date,
      // Present only when the plan has a setup fee (the dialog hides the section otherwise).
      paymentKind: z.enum(['full', 'deposit']).optional(),
      depositAed: z.string().trim().optional(),
      paidOn: z.union([date, z.literal('')]).optional(),
      method: z.union([z.enum(SETUP_PAYMENT_METHODS), z.literal('')]).optional(),
      reference: text(120),
      note: text(500),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const payment = d.paymentKind
    ? {
        kind: d.paymentKind,
        // "1,000" → 1000 (thousands separators typed by hand).
        amountAed: d.paymentKind === 'deposit' ? (d.depositAed ?? '').replace(/,/g, '') : null,
        paidOn: d.paidOn ?? '',
        method: (d.method || 'cash') as (typeof SETUP_PAYMENT_METHODS)[number],
        reference: d.reference,
        note: d.note,
      }
    : null
  if (payment && !d.method) return fail('Choose how it was paid.', { method: 'Choose how it was paid' })
  if (payment && !d.paidOn) return fail('Pick the payment date.', { paidOn: 'Pick a date' })
  let res: Awaited<ReturnType<typeof acceptApplication>>
  try {
    res = await acceptApplication(platformDb(), {
      applicationId,
      reviewerId: user.id,
      planId: d.planId,
      startDate: d.startDate,
      today: todayDubai(),
      payment,
    })
  } catch (e) {
    if (e instanceof DomainError) {
      const field = /deposit/i.test(e.message)
        ? 'depositAed'
        : /payment date/i.test(e.message)
          ? 'paidOn'
          : undefined
      return fail(e.message, field ? { [field]: e.message } : undefined)
    }
    throw e
  }
  await audit({
    tenantId: res.tenant.id,
    actorUserId: user.id,
    action: 'platform.application.accepted',
    entity: 'spa_application',
    entityId: applicationId,
    data: {
      slug: res.tenant.slug,
      plan: res.plan.code,
      startDate: d.startDate,
      setupPayment: res.setupPayment,
    },
  })
  await emailApplicationAccepted(res.application)
  revalidate(applicationId)
  revalidatePath(`/platform/tenants/${res.tenant.id}`)
  return ok(
    res.invoice
      ? `${res.tenant.name} is live · invoice ${res.invoice.number}${
          Number(res.balanceAed) > 0 ? ` · balance due AED ${res.balanceAed}` : ' paid'
        }`
      : `${res.tenant.name} is live`,
    { tenantId: res.tenant.id },
  )
}

export async function rejectApplicationAction(
  applicationId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const parsed = z
    .object({
      reason: text(1000),
      shareReason: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  let res: Awaited<ReturnType<typeof rejectApplication>>
  try {
    res = await rejectApplication(platformDb(), {
      applicationId,
      reviewerId: user.id,
      reason: parsed.data.reason,
      shareReason: parsed.data.shareReason,
    })
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message)
    throw e
  }
  await audit({
    actorUserId: user.id,
    action: 'platform.application.rejected',
    entity: 'spa_application',
    entityId: applicationId,
    data: {
      slug: res.application.slug,
      reason: res.application.rejectionReason,
      shareReason: res.application.shareReason,
      loginDisabled: res.disabled,
      sessionsRevoked: res.sessionsRevoked,
    },
  })
  await emailApplicationRejected(res.application, { loginClosed: res.disabled })
  revalidate(applicationId)
  return ok(res.disabled ? 'Application rejected · login closed' : 'Application rejected')
}
