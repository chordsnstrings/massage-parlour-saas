// Feature flags (F20, PLAN §17): global default + per-spa override, set in the super-admin console. Flags are
// platform data (`feature_flags` is invisible to the app role), so every read here runs on the platform role.
// Rules (keys, fallbacks, resolution) live in @spa/core flags.ts; web reads through `server/flags.ts` `flag()`.
import { FEATURE_FLAGS, FLAG_KEY_PATTERN, type FlagKey, isFlagKey, resolveFlag } from '@spa/core'
import { type DbOrTx, featureFlagOverrides, featureFlags, tenants } from '@spa/db'
import { and, asc, eq, sql } from 'drizzle-orm'
import { DomainError } from './errors'

/** One flag's value for one spa: override → console default → code fallback. */
export async function flagOn(db: DbOrTx, key: FlagKey, tenantId: string): Promise<boolean> {
  const { rows } = await db.execute<{ d: boolean | null; o: boolean | null }>(sql`
    select (select ${featureFlags.defaultOn} from ${featureFlags} where ${featureFlags.key} = ${key}) as d,
      (select ${featureFlagOverrides.enabled} from ${featureFlagOverrides}
        where ${featureFlagOverrides.flagKey} = ${key} and ${featureFlagOverrides.tenantId} = ${tenantId}) as o`)
  const r = rows[0]
  return resolveFlag(key, r?.d == null ? null : { defaultOn: r.d }, r?.o)
}

/** A flag for every spa at once (worker loops): `on(tenantId)`. Two small queries. */
export async function flagValues(db: DbOrTx, key: FlagKey) {
  const [row] = await db.select().from(featureFlags).where(eq(featureFlags.key, key))
  const overrides = new Map(
    (
      await db
        .select({ tenantId: featureFlagOverrides.tenantId, enabled: featureFlagOverrides.enabled })
        .from(featureFlagOverrides)
        .where(eq(featureFlagOverrides.flagKey, key))
    ).map((o) => [o.tenantId, o.enabled]),
  )
  return {
    defaultOn: resolveFlag(key, row, null),
    overrides,
    on: (tenantId: string) => resolveFlag(key, row, overrides.get(tenantId)),
  }
}

export type FlagListRow = {
  key: string
  description: string | null
  defaultOn: boolean
  /** Declared in `FEATURE_FLAGS` (the code reads it); such flags can't be deleted. */
  inCode: boolean
  /** Has a console row (else the code fallback applies). */
  saved: boolean
  updatedAt: Date | null
  overrides: { tenantId: string; name: string; slug: string; enabled: boolean }[]
}

/** Console list: saved flags plus code flags not saved yet, with their per-spa overrides. */
export async function listFlags(db: DbOrTx): Promise<FlagListRow[]> {
  const [rows, overrides] = await Promise.all([
    db.select().from(featureFlags).orderBy(asc(featureFlags.key)),
    db
      .select({
        key: featureFlagOverrides.flagKey,
        tenantId: featureFlagOverrides.tenantId,
        enabled: featureFlagOverrides.enabled,
        name: tenants.name,
        slug: tenants.slug,
      })
      .from(featureFlagOverrides)
      .innerJoin(tenants, eq(tenants.id, featureFlagOverrides.tenantId))
      .orderBy(asc(tenants.name)),
  ])
  const byKey = new Map<string, FlagListRow['overrides']>()
  for (const o of overrides) {
    const list = byKey.get(o.key) ?? []
    list.push({ tenantId: o.tenantId, name: o.name, slug: o.slug, enabled: o.enabled })
    byKey.set(o.key, list)
  }
  const out: FlagListRow[] = rows.map((r) => ({
    key: r.key,
    description: r.description,
    defaultOn: r.defaultOn,
    inCode: isFlagKey(r.key),
    saved: true,
    updatedAt: r.updatedAt,
    overrides: byKey.get(r.key) ?? [],
  }))
  for (const [key, def] of Object.entries(FEATURE_FLAGS))
    if (!out.some((r) => r.key === key))
      out.push({
        key,
        description: def.description,
        defaultOn: def.fallback,
        inCode: true,
        saved: false,
        updatedAt: null,
        overrides: [],
      })
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

const checkKey = (key: string) => {
  if (!FLAG_KEY_PATTERN.test(key))
    throw new DomainError('Use lower-case dotted names, e.g. calendar.newDayView', 'invalid')
}

/** Creates or updates a flag (key, description, default). Returns the value before (null = new) and after. */
export async function saveFlag(
  db: DbOrTx,
  f: { key: string; description: string | null; defaultOn: boolean; userId: string },
) {
  checkKey(f.key)
  const [before] = await db.select().from(featureFlags).where(eq(featureFlags.key, f.key))
  const values = { description: f.description, defaultOn: f.defaultOn, updatedBy: f.userId }
  const [row] = await db
    .insert(featureFlags)
    .values({ key: f.key, ...values })
    .onConflictDoUpdate({ target: featureFlags.key, set: values })
    .returning()
  return { before: before ?? null, after: row! }
}

/** Deletes a flag the code doesn't read (its overrides go with it). */
export async function deleteFlag(db: DbOrTx, key: string) {
  if (isFlagKey(key))
    throw new DomainError('The code reads this flag — change its default instead of deleting it', 'invalid')
  const [row] = await db.delete(featureFlags).where(eq(featureFlags.key, key)).returning()
  if (!row) throw new DomainError('Flag not found', 'not_found')
  return row
}

/**
 * Sets (true/false) or clears (null) one spa's override. A code flag without a console row gets one first, with its
 * fallback as the default. Returns the override before and after (null = none).
 */
export async function setFlagOverride(
  db: DbOrTx,
  o: { key: string; tenantId: string; enabled: boolean | null; userId: string },
) {
  const [flagRow] = await db.select().from(featureFlags).where(eq(featureFlags.key, o.key))
  if (!flagRow) {
    if (!isFlagKey(o.key)) throw new DomainError('Flag not found', 'not_found')
    await db
      .insert(featureFlags)
      .values({
        key: o.key,
        description: FEATURE_FLAGS[o.key].description,
        defaultOn: FEATURE_FLAGS[o.key].fallback,
        updatedBy: o.userId,
      })
      .onConflictDoNothing()
  }
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, o.tenantId))
  if (!tenant) throw new DomainError('Spa not found', 'not_found')
  const where = and(eq(featureFlagOverrides.flagKey, o.key), eq(featureFlagOverrides.tenantId, o.tenantId))
  const [before] = await db.select().from(featureFlagOverrides).where(where)
  if (o.enabled === null) await db.delete(featureFlagOverrides).where(where)
  else
    await db
      .insert(featureFlagOverrides)
      .values({ flagKey: o.key, tenantId: o.tenantId, enabled: o.enabled, updatedBy: o.userId })
      .onConflictDoUpdate({
        target: [featureFlagOverrides.flagKey, featureFlagOverrides.tenantId],
        set: { enabled: o.enabled, updatedBy: o.userId },
      })
  return { from: before?.enabled ?? null, to: o.enabled }
}
