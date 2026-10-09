'use server'
import { withTenant } from '@spa/db'
import { DomainError, resolveChangeRequest, setStudioStatus } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { type MemberContext, studioGuard } from '@/server/access'
import { audit } from '@/server/audit'

// Website Studio workflow (PLAN §14.4, §18.1): every action here is studio-only (super-admin, `studioGuard`). Spa
// members no longer review, approve or request changes — they only edit services and prices (services/actions.ts).

const auditAs = (ctx: MemberContext, action: string, entityId?: string, data?: unknown) =>
  audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action,
    entity: 'site',
    entityId,
    data,
  })

const revalidate = (slug: string) => {
  revalidatePath(`/dashboard/${slug}/website`, 'layout')
  revalidatePath('/platform/websites')
}

function domainFail(e: unknown): ActionResult {
  if (e instanceof DomainError) return failDomain(e)
  throw e
}

const STATUS_RESULT = {
  building: 'website.backInStudio',
  review: 'website.sentForReview',
  approved: 'website.approved',
} as const
const STATUS_AUDIT = {
  building: 'site.back_in_studio',
  review: 'site.sent_for_review',
  approved: 'site.approved',
} as const

/** Studio only (R1, §18.1): send for review, pull back, approve or reopen. Spa members are rejected. */
export async function setStudioStatusAction(
  slug: string,
  to: keyof typeof STATUS_RESULT,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.publish')
  if (error) return fail(error)
  const parsed = z.enum(['building', 'review', 'approved']).safeParse(to)
  if (!parsed.success) return fromZod(parsed.error)
  try {
    await withTenant(ctx.tenant.id, (tx) => setStudioStatus(tx, ctx.tenant.id, parsed.data))
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, STATUS_AUDIT[parsed.data])
  revalidate(slug)
  return ok(STATUS_RESULT[parsed.data])
}

const resolveSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['done', 'declined']),
  response: z.string().trim().max(2000, 'website.tooLong').optional(),
})

export async function resolveChangeAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
  if (error) return fail(error)
  const parsed = resolveSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  try {
    await withTenant(ctx.tenant.id, (tx) =>
      resolveChangeRequest(tx, ctx.tenant.id, parsed.data.id, { ...parsed.data, userId: ctx.user.id }),
    )
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, 'site.change_resolved', parsed.data.id, { status: parsed.data.status })
  revalidate(slug)
  return ok(parsed.data.status === 'done' ? 'website.markedDone' : 'website.declined')
}
