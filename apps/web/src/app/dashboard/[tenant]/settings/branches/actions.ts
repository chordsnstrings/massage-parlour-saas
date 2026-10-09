'use server'
import { isGoogleMapsUrl, normalizeGoogleMapsUrl, toUaeE164 } from '@spa/core'
import { plans, platformDb, subscriptions, withTenant } from '@spa/db'
import { branchLimit, createBranch, DomainError, setBranchActive, updateBranch } from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const opt = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => v || null)
const branchSchema = z.object({
  id: z
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  name: z.string().trim().min(2, 'settings.branches.errors.name').max(80),
  address: opt,
  mapsUrl: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isGoogleMapsUrl(v), 'settings.branches.errors.mapsUrl')
    .transform((v) => normalizeGoogleMapsUrl(v)), // store URL.href, never the raw paste
  phone: opt,
  whatsapp: z.string().trim().optional(),
  cutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'settings.branches.errors.time'),
})

/** The plan's branch cap (plans.limits.branches), when the spa has a plan that sets one. */
async function planBranchLimit(tenantId: string) {
  const [sub] = await withTenant(tenantId, (tx) =>
    tx.select({ planId: subscriptions.planId }).from(subscriptions).limit(1),
  )
  if (!sub) return null
  const plan = await platformDb().query.plans.findFirst({ where: eq(plans.id, sub.planId) })
  return branchLimit(plan?.limits)
}

const paths = (slug: string) => {
  revalidatePath(`/dashboard/${slug}/settings/branches`)
  revalidatePath(`/dashboard/${slug}`, 'layout')
}

export async function saveBranchAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  const parsed = branchSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const whatsappE164 = d.whatsapp ? toUaeE164(d.whatsapp) : null
  if (d.whatsapp && !whatsappE164)
    return fail('settings.branches.errors.whatsapp', { whatsapp: 'validation.uaeMobile' })
  const input = {
    name: d.name,
    address: d.address,
    mapsUrl: d.mapsUrl,
    phone: d.phone,
    whatsappE164,
    businessDayCutoff: d.cutoff,
  }
  try {
    const limit = d.id ? null : await planBranchLimit(ctx.tenant.id)
    const row = await withTenant(ctx.tenant.id, (tx) =>
      d.id ? updateBranch(tx, d.id, input) : createBranch(tx, ctx.tenant.id, input, { limit }),
    )
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
      action: d.id ? 'branch.updated' : 'branch.created',
      entity: 'branch',
      entityId: row.id,
      data: input,
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  paths(slug)
  return ok(d.id ? 'settings.branches.saved' : 'settings.branches.created')
}

export async function setBranchActiveAction(
  slug: string,
  branchId: string,
  active: boolean,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  if (!z.uuid().safeParse(branchId).success) return fail('settings.branches.errors.notFound')
  try {
    const limit = active ? await planBranchLimit(ctx.tenant.id) : null
    await withTenant(ctx.tenant.id, (tx) => setBranchActive(tx, branchId, active, { limit }))
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: active ? 'branch.restored' : 'branch.archived',
    entity: 'branch',
    entityId: branchId,
  })
  paths(slug)
  return ok(active ? 'settings.branches.restored' : 'settings.branches.archivedDone')
}
