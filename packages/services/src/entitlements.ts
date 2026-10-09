// Plan entitlements (PLAN §18.8). The rules live in @spa/core (`effectiveFeatures`, `branchCap`); this module reads
// a spa's plan + super-admin override and turns a missing feature into a DomainError. Plans are platform data:
// every function here needs the PLATFORM role (`platformDb()` or a platform transaction).
import {
  branchCap,
  effectiveFeatures,
  type Feature,
  type FeatureTier,
  PLAN_CODES,
  type PlanLimits,
  planTier,
  TIER_FEATURES,
} from '@spa/core'
import { type DbOrTx, plans, tenants } from '@spa/db'
import { eq, type SQL, sql } from 'drizzle-orm'
import { DomainError } from './errors'

export type Entitlements = {
  features: Feature[]
  /** Super-admin override (`tenants.feature_tier`); null = the plan decides. */
  override: FeatureTier | null
  plan: { id: string; code: string; name: string; active: boolean; tier: FeatureTier } | null
  limits: PlanLimits
  /** Active-branch cap (null = no cap). */
  branchCap: number | null
}

/** Entitlements from a plan row (or none) + the override — no query. */
export function entitlementsOf(
  plan: { id: string; code: string; name: string; active: boolean; limits: PlanLimits } | null | undefined,
  override: FeatureTier | null | undefined,
): Entitlements {
  const features = effectiveFeatures(plan?.limits, override)
  return {
    features,
    override: override ?? null,
    plan: plan
      ? { id: plan.id, code: plan.code, name: plan.name, active: plan.active, tier: planTier(plan.limits) }
      : null,
    limits: plan?.limits,
    branchCap: branchCap(features, plan?.limits),
  }
}

/** One spa's effective entitlements (platform role). Unknown spa → no features. */
export async function tenantEntitlements(db: DbOrTx, tenantId: string): Promise<Entitlements> {
  const [row] = await db
    .select({
      override: tenants.featureTier,
      planId: plans.id,
      code: plans.code,
      name: plans.name,
      active: plans.active,
      limits: plans.limits,
    })
    .from(tenants)
    .leftJoin(plans, eq(plans.id, tenants.planId))
    .where(eq(tenants.id, tenantId))
  if (!row) return { ...entitlementsOf(null, 'standard'), override: null }
  const plan = row.planId
    ? { id: row.planId, code: row.code!, name: row.name!, active: row.active!, limits: row.limits }
    : null
  return entitlementsOf(plan, row.override)
}

/** The refusal for a feature the spa's plan doesn't include (EN text + the catalogue key the dashboard shows). */
export const featureError = (feature: Feature) =>
  new DomainError(`This is available on the Premium plan (${feature}).`, 'invalid', {
    key: 'plan.errors.feature',
    params: { feature: { key: `plan.feature.${feature}.name` } },
  })

/** Throws `featureError` unless the spa has the feature (platform role). */
export async function assertFeature(db: DbOrTx, tenantId: string, feature: Feature) {
  const e = await tenantEntitlements(db, tenantId)
  if (!e.features.includes(feature)) throw featureError(feature)
  return e
}

/**
 * SQL condition "this spa has `feature`" over `tenants` (worker / platform queries, e.g. `activeTenants`). Mirrors
 * `effectiveFeatures`: the override tier wins; no plan = every feature; else the plan's switch (missing = on).
 * PLATFORM role only: under the app role plans are invisible, so a spa with a plan reads as NOT entitled (fails
 * closed).
 */
export function entitledSql(feature: Feature): SQL {
  const tiers = (Object.keys(TIER_FEATURES) as FeatureTier[]).filter((t) => TIER_FEATURES[t].includes(feature))
  const tierHas = tiers.length
    ? sql`${tenants.featureTier} in (${sql.join(
        tiers.map((t) => sql`${t}`),
        sql`, `,
      )})`
    : sql`false`
  return sql`(case
    when ${tenants.featureTier} is not null then ${tierHas}
    when ${tenants.planId} is null then true
    else coalesce((select (p.limits ->> ${feature}) is distinct from 'false' from ${plans} p where p.id = ${tenants.planId}), false)
  end)`
}

/** Plan by code (e.g. `PLAN_CODES.premium`). */
export async function planByCode(db: DbOrTx, code: string) {
  const [row] = await db.select().from(plans).where(eq(plans.code, code))
  return row ?? null
}

/** The legacy yearly plan (PLAN §18.8): kept for existing spas until renewal; never offered to new spas. */
export const isLegacyPlan = (plan: { code: string } | null | undefined) =>
  plan?.code === PLAN_CODES.legacyYearly
