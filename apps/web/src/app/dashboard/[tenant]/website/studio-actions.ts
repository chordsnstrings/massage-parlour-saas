'use server'
import { withTenant } from '@spa/db'
import { createChangeRequest, DomainError, resolveChangeRequest, setStudioStatus } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard, isStudio, type MemberContext, studioGuard } from '@/server/access'
import { audit } from '@/server/audit'

// Website Studio workflow (PLAN §14.4): the spa reviews, approves and asks for changes; the studio resolves them.

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
  if (e instanceof DomainError) return fail(e.message)
  throw e
}

const requestSchema = z.object({
  body: z.string().trim().min(3, 'Tell us what you would like changed').max(2000),
  pageId: z.union([z.string().uuid(), z.literal('')]).optional(),
})

export async function requestChangeAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'site.content')
  if (error) return fail(error)
  const parsed = requestSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  let id: string
  try {
    id = await withTenant(ctx.tenant.id, (tx) =>
      createChangeRequest(tx, ctx.tenant.id, {
        body: parsed.data.body,
        pageId: parsed.data.pageId || null,
        userId: ctx.user.id,
      }),
    )
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, 'site.change_requested', id)
  revalidate(slug)
  return ok('Sent to the studio')
}

/** Only the spa approves its own site — a super-admin can't approve on its behalf. */
export async function approveSiteAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'site.publish')
  if (error) return fail(error)
  if (await isStudio(ctx)) return fail('Only the spa can approve its website.')
  try {
    await withTenant(ctx.tenant.id, (tx) => setStudioStatus(tx, ctx.tenant.id, 'approved', 'spa'))
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, 'site.approved')
  revalidate(slug)
  return ok('Approved — the studio will publish it')
}

export async function setReviewAction(slug: string, review: boolean): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.publish')
  if (error) return fail(error)
  try {
    await withTenant(ctx.tenant.id, (tx) =>
      setStudioStatus(tx, ctx.tenant.id, review ? 'review' : 'building', 'studio'),
    )
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, review ? 'site.sent_for_review' : 'site.review_withdrawn')
  revalidate(slug)
  return ok(review ? 'Sent to the spa for review' : 'Back in the studio')
}

const resolveSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['done', 'declined']),
  response: z.string().trim().max(2000).optional(),
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
  return ok(parsed.data.status === 'done' ? 'Marked done' : 'Declined')
}
