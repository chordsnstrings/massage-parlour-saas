import {
  type Feature,
  type Permission,
  requires2fa,
  resolvePermissions,
  SYSTEM_ROLES,
  TWO_FACTOR_POLICY_ROLES,
} from '@spa/core'
import {
  grantListedPlatformAdmins,
  isListedAdminEmail,
  listedAdminEmails,
  memberBranches,
  members,
  platformAdmins,
  platformDb,
  roles,
  tenants,
  user as users,
  withTenant,
} from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import { getT } from '@/i18n/server'
import { adminPath, appPath } from '@/lib/paths'
import { featureRef, hasFeature } from './entitlements'
import { requireUser } from './session'

export type TenantRow = typeof tenants.$inferSelect

export const getTenantBySlug = cache(async (slug: string) =>
  platformDb().query.tenants.findFirst({ where: eq(tenants.slug, slug.toLowerCase()) }),
)

/** Super-admin row + whether 2FA is on, read fresh (not from the 5-minute session cookie cache). */
async function queryAdminStatus(userId: string): Promise<'ok' | 'needs2fa' | null> {
  const [row] = await platformDb()
    .select({ on: users.twoFactorEnabled })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .where(eq(platformAdmins.userId, userId))
  return row ? (row.on ? 'ok' : 'needs2fa') : null
}
const adminStatus = cache(queryAdminStatus)

/** Super-admin powers (G3): a platform_admins row AND TOTP 2FA on. Without 2FA no super-admin power applies. */
export const isPlatformAdmin = cache(async (userId: string) => (await adminStatus(userId)) === 'ok')

/** G3: where a super-admin without 2FA is sent to enrol (the account page on this host; no admin rights needed). */
const enrolAdmin2fa = (accountPath: string) => redirect(`${accountPath}?admin2fa=1`)

export type MemberContext = {
  tenant: TenantRow
  user: { id: string; name: string; email: string; twoFactorEnabled: boolean }
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
  const user = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    twoFactorEnabled: Boolean((session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled),
  }
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
    // Security policy (Settings → Security, X5): owners and managers need TOTP 2FA before they get in.
    if (
      requires2fa(tenant.settings) &&
      TWO_FACTOR_POLICY_ROLES.includes(row.roleKey) &&
      !user.twoFactorEnabled
    ) {
      // The session cookie cache may be up to 5 minutes old: confirm against the row before sending them away.
      const [fresh] = await platformDb()
        .select({ on: users.twoFactorEnabled })
        .from(users)
        .where(eq(users.id, user.id))
      if (fresh?.on) user.twoFactorEnabled = true
      else redirect(`${appPath('/account')}?require2fa=${encodeURIComponent(tenant.slug)}`)
    }
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
  const status = await adminStatus(user.id)
  if (status === 'needs2fa') enrolAdmin2fa(appPath('/account'))
  if (status === 'ok') {
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

/**
 * Common guard for tenant server actions. Returns an error message or null. `feature` (PLAN §18.8): the action needs
 * that plan feature — a spa without it gets "… is available on the Premium plan." (impersonation included).
 */
export async function guard(slug: string, permission: Permission, feature?: Feature) {
  const ctx = await requireMember(slug)
  if (!can(ctx, permission)) return { ctx, error: (await getT())('errors.forbidden') }
  if (feature && !(await hasFeature(ctx.tenant.id, feature))) {
    const ref = featureRef(feature)
    return { ctx, error: (await getT())(ref.key, ref.params) }
  }
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
  let status = await adminStatus(session.user.id)
  // G2: a PLATFORM_ADMIN_EMAILS address is promoted here once its email is verified (no deploy needed).
  const listed = !status && isListedAdminEmail(session.user.email)
  if (listed && (await grantListedPlatformAdmins(platformDb(), listedAdminEmails(), session.user.id)) > 0)
    status = await queryAdminStatus(session.user.id)
  // Listed but not verified yet: the join page says how (email link, or an existing super-admin confirms it).
  if (!status && listed) redirect(adminPath('/join'))
  if (!status) notFound()
  if (status === 'needs2fa') enrolAdmin2fa(adminPath('/account'))
  return session
}
