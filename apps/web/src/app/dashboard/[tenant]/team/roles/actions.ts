'use server'
import { isPermission, normalizeSlug } from '@spa/core'
import { invitations, members, roles, withTenant } from '@spa/db'
import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const schema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, 'roles.validation.name').max(40),
  description: z.string().trim().max(160).optional(),
  permissions: z.union([z.string(), z.array(z.string())]).optional(),
})

export async function saveRoleAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'team.manage')
  if (error) return fail(error)
  const parsed = schema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const permissions = [d.permissions ?? []].flat().filter(isPermission)
  const problem = await withTenant(ctx.tenant.id, async (tx) => {
    if (d.id) {
      const [role] = await tx.select().from(roles).where(eq(roles.id, d.id))
      if (!role) return 'roles.result.notFound'
      if (role.isSystem) return 'roles.result.systemLocked'
      await tx
        .update(roles)
        .set({ name: d.name, description: d.description || null, permissions })
        .where(eq(roles.id, d.id))
    } else {
      const key = `custom_${normalizeSlug(d.name).replace(/-/g, '_')}`
      const [dupe] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, key))
      if (dupe) return 'roles.result.duplicate'
      await tx.insert(roles).values({
        tenantId: ctx.tenant.id,
        key,
        name: d.name,
        description: d.description || null,
        permissions,
      })
    }
    return null
  })
  if (problem) return fail(problem, { name: problem })
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: d.id ? 'role.updated' : 'role.created',
    data: { name: d.name, permissions },
  })
  revalidatePath(`/dashboard/${slug}/team/roles`)
  return ok('roles.result.saved')
}

export async function deleteRoleAction(slug: string, roleId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'team.manage')
  if (error) return fail(error)
  const problem = await withTenant(ctx.tenant.id, async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, roleId))
    if (!role || role.isSystem) return 'roles.result.onlyCustom'
    const [used] = await tx
      .select({ id: members.id })
      .from(members)
      .where(eq(members.roleId, roleId))
      .limit(1)
    const [pending] = await tx
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(eq(invitations.roleId, roleId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)),
      )
      .limit(1)
    if (used || pending) return 'roles.result.inUse'
    await tx.delete(roles).where(eq(roles.id, roleId))
    return null
  })
  if (problem) return fail(problem)
  await audit({ tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: 'role.deleted', entityId: roleId })
  revalidatePath(`/dashboard/${slug}/team/roles`)
  return ok('roles.result.deleted')
}
