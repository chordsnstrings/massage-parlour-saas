import { checkSlug, SYSTEM_ROLES, type SystemRoleKey } from '@spa/core'
import {
  branches,
  grantListedPlatformAdmins,
  listedAdminEmails,
  members,
  plans,
  platformDb,
  roles,
  subscriptions,
  tenants,
} from '@spa/db'
import { asc, eq } from 'drizzle-orm'
import { todayDubai } from '@/lib/utils'

const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function isSlugAvailable(slug: string) {
  if (!checkSlug(slug).ok) return false
  const row = await platformDb().query.tenants.findFirst({
    where: eq(tenants.slug, slug),
    columns: { id: true },
  })
  return !row
}

/** Creates a tenant with default branch, system roles, owner membership and a trial subscription. */
export async function provisionTenant(input: {
  userId: string
  email: string
  businessName: string
  slug: string
}) {
  const db = platformDb()
  return db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(plans)
      .where(eq(plans.active, true))
      .orderBy(asc(plans.sort), asc(plans.createdAt))
      .limit(1)
    const [tenant] = await tx
      .insert(tenants)
      .values({ slug: input.slug, name: input.businessName, planId: plan?.id, status: 'trial' })
      .returning()
    if (!tenant) throw new Error('tenant insert failed')
    await tx.insert(branches).values({ tenantId: tenant.id, name: input.businessName, isDefault: true })
    const roleRows = await tx
      .insert(roles)
      .values(
        (Object.keys(SYSTEM_ROLES) as SystemRoleKey[]).map((key) => ({
          tenantId: tenant.id,
          key,
          name: SYSTEM_ROLES[key].name,
          description: SYSTEM_ROLES[key].description,
          isSystem: true,
          permissions: [...SYSTEM_ROLES[key].permissions],
        })),
      )
      .returning({ id: roles.id, key: roles.key })
    const owner = roleRows.find((r) => r.key === 'owner')!
    await tx.insert(members).values({ tenantId: tenant.id, userId: input.userId, roleId: owner.id })
    if (plan) {
      const start = todayDubai()
      await tx.insert(subscriptions).values({
        tenantId: tenant.id,
        planId: plan.id,
        status: 'trialing',
        priceAed: plan.priceAed,
        setupFeeAed: plan.setupFeeAed,
        billingInterval: plan.billingInterval,
        currentPeriodStart: start,
        currentPeriodEnd: addDays(start, plan.trialDays),
      })
    }
    // G2: a listed email becomes super-admin only once verified (usually later, on first console visit).
    await grantListedPlatformAdmins(tx, listedAdminEmails(), input.userId)
    return tenant
  })
}
