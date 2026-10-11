'use server'
import { withTenant } from '@spa/db'
import { createChangeRequest, DomainError } from '@spa/services'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { can, isWritable, requireMember } from '@/server/access'
import { audit } from '@/server/audit'
import { revalidateStudio } from '@/server/studio'

// R23: the spa asks the studio for a change from its Website page; the studio (console) marks it done or declined.

const requestSchema = z.object({
  body: z.string().trim().min(3, 'website.request.tooShort').max(2000, 'website.tooLong'),
  pageId: z.union([z.uuid(), z.literal('')]).optional(),
})

export async function requestChangeAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireMember(slug)
  // Same people who open the Website page.
  if (!can(ctx, 'site.content') && !can(ctx, 'services.manage')) return fail('errors.forbidden')
  if (!isWritable(ctx.tenant)) return fail('errors.readOnly')
  const parsed = requestSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const pageId = parsed.data.pageId || null
  let id: string
  try {
    id = await withTenant(ctx.tenant.id, (tx) =>
      createChangeRequest(tx, ctx.tenant.id, { body: parsed.data.body, pageId, userId: ctx.user.id }),
    )
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: 'site.change_requested',
    entity: 'site_change_request',
    entityId: id,
    data: { pageId },
  })
  revalidateStudio(slug)
  return ok('website.request.sent')
}
