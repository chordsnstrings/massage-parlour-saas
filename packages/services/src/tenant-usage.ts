// F21 console tenant list: usage + last activity per spa, in ONE platform-role query (PLAN §18.1: super-admins see
// whole-spa aggregates only — no client data). Each figure is an index-backed correlated subquery per spa:
// bookings (tenant_id, created_at) · members (tenant_id, user_id) → user.last_sign_in_at / session (user_id,
// created_at) · stored_files (tenant_id, …) · ai_usage (tenant_id, created_at).
import { planTier } from '@spa/core'
import {
  aiUsage,
  bookings,
  type DbOrTx,
  members,
  plans,
  session,
  storedFiles,
  subscriptions,
  tenants,
  user,
} from '@spa/db'
import { asc, desc, eq, ilike, or, type SQL, sql } from 'drizzle-orm'
import { aiMonth } from './ai-usage'

export const TENANT_SORTS = [
  'name',
  'status',
  'plan',
  'signin',
  'booking',
  'bookings30',
  'members',
  'storage',
  'ai',
  'joined',
] as const
export type TenantSort = (typeof TENANT_SORTS)[number]
export const isTenantSort = (v: unknown): v is TenantSort =>
  typeof v === 'string' && (TENANT_SORTS as readonly string[]).includes(v)

export async function tenantUsageList(
  db: DbOrTx,
  o: { q?: string; sort?: TenantSort; dir?: 'asc' | 'desc'; now?: Date; limit?: number } = {},
) {
  const now = o.now ?? new Date()
  const since30 = new Date(now.getTime() - 30 * 86_400_000)
  const month = aiMonth(0, now)
  const lastSignIn = sql<Date | null>`(select max(greatest(${user.lastSignInAt},
      (select max(${session.createdAt}) from ${session} where ${session.userId} = ${members.userId})))
    from ${members} join ${user} on ${user.id} = ${members.userId}
    where ${members.tenantId} = ${tenants.id} and ${members.status} = 'active')`
  const lastBooking = sql<Date | null>`(select max(${bookings.createdAt}) from ${bookings}
    where ${bookings.tenantId} = ${tenants.id})`
  const bookings30 = sql<number>`(select count(*)::int from ${bookings}
    where ${bookings.tenantId} = ${tenants.id} and ${bookings.createdAt} >= ${since30})`
  const activeMembers = sql<number>`(select count(*)::int from ${members}
    where ${members.tenantId} = ${tenants.id} and ${members.status} = 'active')`
  const storage = sql<number>`(select coalesce(sum(${storedFiles.size}), 0)::bigint from ${storedFiles}
    where ${storedFiles.tenantId} = ${tenants.id})`
  const aiSpend = sql<string>`(select coalesce(sum(${aiUsage.costUsd}), 0)::numeric(12,2) from ${aiUsage}
    where ${aiUsage.tenantId} = ${tenants.id} and ${aiUsage.createdAt} >= ${month.start}
      and ${aiUsage.createdAt} < ${month.end})`
  const keys: Record<TenantSort, SQL> = {
    name: sql`lower(${tenants.name})`,
    status: sql`${tenants.status}::text`,
    plan: sql`lower(${plans.name})`,
    signin: sql`last_sign_in`,
    booking: sql`last_booking`,
    bookings30: sql`bookings_30d`,
    members: sql`active_members`,
    storage: sql`storage_bytes`,
    ai: sql`ai_spend`,
    joined: sql`${tenants.createdAt}`,
  }
  const sort = o.sort ?? 'joined'
  const dir = o.dir ?? (sort === 'name' || sort === 'status' || sort === 'plan' ? 'asc' : 'desc')
  const key = keys[sort]
  const q = o.q?.trim()
  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      deletedAt: tenants.deletedAt,
      billingStage: tenants.billingStage,
      billingOverdueSince: tenants.billingOverdueSince,
      featureTier: tenants.featureTier,
      plan: plans.name,
      planLimits: plans.limits,
      periodEnd: subscriptions.currentPeriodEnd,
      createdAt: tenants.createdAt,
      aiBudgetUsd: tenants.aiBudgetUsd,
      lastSignInAt: lastSignIn.as('last_sign_in'),
      lastBookingAt: lastBooking.as('last_booking'),
      bookings30d: bookings30.as('bookings_30d'),
      activeMembers: activeMembers.as('active_members'),
      storageBytes: storage.as('storage_bytes'),
      aiSpendUsd: aiSpend.as('ai_spend'),
    })
    .from(tenants)
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(q ? or(ilike(tenants.name, `%${q}%`), ilike(tenants.slug, `%${q}%`)) : undefined)
    .orderBy(
      dir === 'asc' ? sql`${key} asc nulls last` : sql`${key} desc nulls last`,
      asc(tenants.name),
      desc(tenants.createdAt),
    )
    .limit(o.limit ?? 200)
  // node-postgres returns timestamps from raw subqueries as strings and bigint as string.
  return rows.map(({ planLimits, ...r }) => ({
    ...r,
    /** The subscribed plan's own tier (PLAN §18.8); `featureTier` is the super-admin override (null = the plan decides). */
    planTier: planLimits ? planTier(planLimits) : null,
    lastSignInAt: r.lastSignInAt ? new Date(r.lastSignInAt) : null,
    lastBookingAt: r.lastBookingAt ? new Date(r.lastBookingAt) : null,
    storageBytes: Number(r.storageBytes ?? 0),
    bookings30d: Number(r.bookings30d ?? 0),
    activeMembers: Number(r.activeMembers ?? 0),
  }))
}

export type TenantUsageRow = Awaited<ReturnType<typeof tenantUsageList>>[number]
