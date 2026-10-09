'use server'
import { isGoogleMapsUrl, requires2fa, toUaeE164 } from '@spa/core'
import { branches, platformDb, tenants, user, withTenant } from '@spa/db'
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
  mapsUrl: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isGoogleMapsUrl(v), 'settings.profile.errors.mapsUrl')
    .transform((v) => v || null),
  phone: opt,
  whatsapp: z.string().trim().optional(),
  cutoff: z.string().regex(/^\d{2}:\d{2}$/, 'settings.profile.errors.time'),
  // Spa-wide default for prices on the website; each service may override it (R4).
  showPrices: z.enum(['on', 'off']).optional(),
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
    const [cur] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenant.id))
    const settings = d.showPrices
      ? { ...(cur?.settings ?? {}), hidePrices: d.showPrices === 'off' }
      : (cur?.settings ?? {})
    await tx
      .update(tenants)
      .set({ name: d.name, legalName: d.legalName, trn: d.trn, settings })
      .where(eq(tenants.id, ctx.tenant.id))
    await tx
      .update(branches)
      .set({
        name: d.branchName,
        address: d.address,
        mapsUrl: d.mapsUrl,
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

const securitySchema = z.object({
  require2fa: z.enum(['on', 'off']).optional(),
})

/**
 * Settings → Security (X5): "Require 2FA for owner & managers" (enforced in requireMember). Client phones need no
 * toggle: only owner / manager / receptionist ever see them (core PHONE_ROLES, owner decision 2026-10-08).
 */
export async function saveSecurityAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  const parsed = securitySchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const settings = ctx.tenant.settings
  const require2fa = parsed.data.require2fa ? parsed.data.require2fa === 'on' : requires2fa(settings)
  // Turning the policy on would lock the actor out at once: they must have 2FA themselves (fresh row, not the
  // cached session). A super-admin acting on the spa is exempt (the policy applies to the spa's own members).
  if (require2fa && !requires2fa(settings) && !ctx.impersonating) {
    const [me] = await platformDb()
      .select({ on: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.id, ctx.user.id))
    if (!me?.on) return fail('audit.security.require2faOwn')
  }
  await withTenant(ctx.tenant.id, async (tx) => {
    const [cur] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenant.id))
    const base = cur?.settings ?? {}
    await tx
      .update(tenants)
      .set({
        settings: {
          ...base,
          require2fa,
        },
      })
      .where(eq(tenants.id, ctx.tenant.id))
  })
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: 'settings.security.updated',
    entity: 'tenant',
    entityId: ctx.tenant.id,
    data: { require2fa },
  })
  revalidatePath(`/dashboard/${slug}`, 'layout')
  return ok('audit.security.saved')
}

const onlineSchema = z.object({
  autoConfirm: z.enum(['on', 'off']).optional(),
  afterVisits: z.coerce
    .number({ error: 'settings.profile.online.errors.visits' })
    .int('settings.profile.online.errors.visits')
    .min(1, 'settings.profile.online.errors.visits')
    .max(50, 'settings.profile.online.errors.visits'),
})

/** Settings → Online booking (G21): auto-confirm returning clients after N completed visits (off by default). */
export async function saveOnlineBookingAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  const parsed = onlineSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const onlineBooking = {
    autoConfirmReturning: parsed.data.autoConfirm === 'on',
    autoConfirmAfterVisits: parsed.data.afterVisits,
  }
  await withTenant(ctx.tenant.id, async (tx) => {
    const [cur] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenant.id))
    await tx
      .update(tenants)
      .set({ settings: { ...(cur?.settings ?? {}), onlineBooking } })
      .where(eq(tenants.id, ctx.tenant.id))
  })
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: 'settings.online_booking.updated',
    entity: 'tenant',
    entityId: ctx.tenant.id,
    data: onlineBooking,
  })
  revalidatePath(`/dashboard/${slug}`, 'layout')
  return ok('settings.profile.online.saved')
}
