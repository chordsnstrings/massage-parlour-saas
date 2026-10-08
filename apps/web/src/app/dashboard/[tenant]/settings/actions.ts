'use server'
import { toUaeE164 } from '@spa/core'
import { branches, tenants, withTenant } from '@spa/db'
import { clearTenantLogo, DomainError, processLogo, setTenantLogo } from '@spa/services'
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
const schema = z.object({
  name: z.string().trim().min(2, 'settings.profile.errors.name').max(80),
  legalName: opt,
  trn: z
    .string()
    .trim()
    .regex(/^\d{15}$|^$/, 'settings.profile.errors.trn')
    .optional()
    .transform((v) => v || null),
  branchName: z.string().trim().min(2, 'settings.profile.errors.branchName').max(80),
  address: opt,
  phone: opt,
  whatsapp: z.string().trim().optional(),
  cutoff: z.string().regex(/^\d{2}:\d{2}$/, 'settings.profile.errors.time'),
})

export async function saveSettingsAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  const parsed = schema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const whatsapp = d.whatsapp ? toUaeE164(d.whatsapp) : null
  if (d.whatsapp && !whatsapp)
    return fail('settings.profile.errors.whatsapp', { whatsapp: 'validation.uaeMobile' })
  await withTenant(ctx.tenant.id, async (tx) => {
    await tx
      .update(tenants)
      .set({ name: d.name, legalName: d.legalName, trn: d.trn })
      .where(eq(tenants.id, ctx.tenant.id))
    await tx
      .update(branches)
      .set({
        name: d.branchName,
        address: d.address,
        phone: d.phone,
        whatsappE164: whatsapp,
        businessDayCutoff: d.cutoff,
      })
      .where(eq(branches.isDefault, true))
  })
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: 'settings.updated',
    data: d,
  })
  revalidatePath(`/dashboard/${slug}`, 'layout')
  return ok('settings.profile.saved')
}

/** Settings › Business: upload (or remove, with intent=remove) the spa logo shown in the dashboard sidebar. */
export async function saveLogoAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  const remove = formData.get('intent') === 'remove'
  if (remove) {
    await withTenant(ctx.tenant.id, (tx) => clearTenantLogo(tx, ctx.tenant.id))
  } else {
    const file = formData.get('logo')
    if (!(file instanceof File) || file.size === 0)
      return fail('errors.file.choose', { logo: 'errors.file.choose' })
    try {
      const image = await processLogo(Buffer.from(await file.arrayBuffer()))
      await withTenant(ctx.tenant.id, (tx) =>
        setTenantLogo(tx, { tenantId: ctx.tenant.id, image, createdBy: ctx.user.id }),
      )
    } catch (e) {
      if (e instanceof DomainError) return failDomain(e, { logo: e.i18n?.key ?? e.message })
      throw e
    }
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: remove ? 'settings.logo_removed' : 'settings.logo_updated',
  })
  revalidatePath(`/dashboard/${slug}`, 'layout')
  return ok(remove ? 'logo.removed' : 'logo.saved')
}
