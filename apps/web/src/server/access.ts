import { type Permission, resolvePermissions, SYSTEM_ROLES } from '@spa/core'
import { memberBranches, members, platformAdmins, platformDb, roles, tenants, withTenant } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getT } from '@/i18n/server'
import { requireUser } from './session'

export type TenantRow = typeof tenants.$inferSelect

export const getTenantBySlug = cache(async (slug: string) =>
  platformDb().query.tenants.findFirst({ where: eq(tenants.slug, slug.toLowerCase()) }),
)

export const isPlatformAdmin = cache(async (userId: string) => {
  const row = await platformDb().query.platformAdmins.findFirst({ where: eq(platformAdmins.userId, userId) })
  return Boolean(row)
})

export type MemberContext = {
  tenant: TenantRow
  user: { id: string; name: string; email: string }
  member: { id: string; roleKey: string; roleName: string; allBranches: boolean; branchIds: string[] } | null
  permissions: Set<Permission>
  /** Super-admin viewing a tenant they're not a member of (every write is audited). */
  impersonating: boolean
}

/** Signed-in member of `slug` (or a super-admin). 404s otherwise so tenant existence isn't leaked. */
export const requireMember = cache(async (slug: string): Promise<MemberContext> => {
  const session = await requireUser()
  const tenant = await getTenantBySlug(slug)
  if (!tenant) notFound()
  const user = { id: session.user.id, name: session.user.name, email: session.user.email }
  const row = await withTenant(tenant.id, async (tx) => {
    const [m] = await tx
      .select({
        id: members.id,
        allBranches: members.allBranches,
        roleKey: roles.key,
        roleName: roles.name,
        rolePerms: roles.permissions,
      })
      .from(members)
      .innerJoin(roles, eq(members.roleId, roles.id))
      .where(and(eq(members.userId, user.id), eq(members.status, 'active')))
      .limit(1)
    if (!m) return null
    const branchIds = m.allBranches
      ? []
      : (
          await tx
            .select({ id: memberBranches.branchId })
            .from(memberBranches)
            .where(eq(memberBranches.memberId, m.id))
        ).map((b) => b.id)
    return { ...m, branchIds }
  })
  // A deleted spa (soft delete, R12) is closed to its members; super-admins can still open it.
  if (row && !tenant.deletedAt) {
    return {
      tenant,
      user,
      member: {
        id: row.id,
        roleKey: row.roleKey,
        roleName: row.roleName,
        allBranches: row.allBranches,
        branchIds: row.branchIds,
      },
      permissions: resolvePermissions({ key: row.roleKey, permissions: row.rolePerms }),
      impersonating: false,
    }
  }
  if (await isPlatformAdmin(user.id)) {
    return {
      tenant,
      user,
      member: null,
      permissions: new Set(SYSTEM_ROLES.owner.permissions),
      impersonating: true,
    }
  }
  notFound()
})

export const can = (ctx: MemberContext, permission: Permission) => ctx.permissions.has(permission)

/** Tenants in read-only / suspended / cancelled state can't change data. */
export const isWritable = (tenant: TenantRow) =>
  tenant.status === 'trial' || tenant.status === 'active' || tenant.status === 'past_due'

/** Common guard for tenant server actions. Returns an error message or null. */
export async function guard(slug: string, permission: Permission) {
  const ctx = await requireMember(slug)
  if (!can(ctx, permission)) return { ctx, error: (await getT())('errors.forbidden') }
  if (!isWritable(ctx.tenant)) return { ctx, error: (await getT())('errors.readOnly') }
  return { ctx, error: null }
}

/**
 * Website Studio (PLAN §14.4): sites are built as a bespoke service, so only a super-admin (acting on the spa, or
 * also a member of it) may change them. Spa members see a read-only view and send change requests instead.
 */
export const isStudio = async (ctx: MemberContext) => ctx.impersonating || isPlatformAdmin(ctx.user.id)

export async function studioGuard(slug: string, permission: Permission) {
  const result = await guard(slug, permission)
  if (!result.error && !(await isStudio(result.ctx)))
    return {
      ctx: result.ctx,
      error: (await getT())('errors.studioOnly'),
    }
  return result
}

export async function requirePlatformAdmin() {
  const session = await requireUser()
  if (!(await isPlatformAdmin(session.user.id))) notFound()
  return session
}
