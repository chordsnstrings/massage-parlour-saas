'use server'
import { withTenant } from '@spa/db'
import { DomainError, resolveChangeRequest } from '@spa/services'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { type MemberContext, studioGuard } from '@/server/access'
import { audit } from '@/server/audit'
import { revalidateStudio } from '@/server/studio'

// Website Studio change requests (R23): spas send them from their Website page; the studio (super-admin,
// `studioGuard`) closes them here as done or declined. No review / approve step: the studio publishes directly.

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

function domainFail(e: unknown): ActionResult {
  if (e instanceof DomainError) return failDomain(e)
  throw e
}

const resolveSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['done', 'declined']),
  response: z.string().trim().max(2000, 'Use at most 2,000 characters').optional(),
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
  revalidateStudio(slug)
  return ok(parsed.data.status === 'done' ? 'Marked done' : 'Declined')
}
