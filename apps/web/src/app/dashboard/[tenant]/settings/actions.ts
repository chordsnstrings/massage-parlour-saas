'use server'
import { toUaeE164 } from '@spa/core'
import { branches, tenants, withTenant } from '@spa/db'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const opt = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => v || null)
const schema = z.object({
  name: z.string().trim().min(2, 'Enter the spa name').max(80),
  legalName: opt,
  trn: z
    .string()
    .trim()
    .regex(/^\d{15}$|^$/, 'A TRN has 15 digits')
    .optional()
    .transform((v) => v || null),
  branchName: z.string().trim().min(2, 'Enter a branch name').max(80),
  address: opt,
  phone: opt,
  whatsapp: z.string().trim().optional(),
  cutoff: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
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
    return fail('Enter a UAE mobile number.', { whatsapp: 'Enter a UAE mobile, e.g. 050 123 4567' })
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
  return ok('Settings saved')
}
