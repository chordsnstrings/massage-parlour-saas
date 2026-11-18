'use server'
// B5.3 — bookable equipment units (Services & rooms page).
import { withTenant } from '@spa/db'
import { DomainError, deleteEquipment, saveEquipment } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const schema = z.object({
  id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  branchId: z.string().uuid('services.v.branch'),
  name: z.string().trim().min(1, 'equipment.v.name').max(60),
  type: z.string().trim().min(1, 'equipment.v.type').max(40),
  active: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
})

const refresh = (slug: string) => {
  revalidatePath(`/dashboard/${slug}/services`)
  revalidatePath(`/dashboard/${slug}/calendar`)
}

export async function saveEquipmentAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'services.manage')
  if (error) return fail(error)
  const parsed = schema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  try {
    const row = await withTenant(ctx.tenant.id, (tx) => saveEquipment(tx, ctx.tenant.id, parsed.data))
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: parsed.data.id ? 'equipment.updated' : 'equipment.created',
      entity: 'equipment',
      entityId: row.id,
      data: parsed.data,
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  refresh(slug)
  return ok(parsed.data.id ? 'equipment.saved' : 'equipment.added')
}

export async function deleteEquipmentAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'services.manage')
  if (error) return fail(error)
  if (!z.string().uuid().safeParse(id).success) return fail('errors.domain.equipmentNotFound')
  try {
    await withTenant(ctx.tenant.id, (tx) => deleteEquipment(tx, id))
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'equipment.deleted',
    entity: 'equipment',
    entityId: id,
  })
  refresh(slug)
  return ok('equipment.deleted')
}
