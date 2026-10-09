import { platformDb, tenants, withTenant } from '@spa/db'
import { type PerformanceRange, type TenantPerformance, tenantPerformance } from '@spa/services'
import { asc, isNull } from 'drizzle-orm'

export type SpaPerformance = TenantPerformance & {
  id: string
  name: string
  slug: string
  status: string
  aiBudgetUsd: number
}

/** Spas read in small parallel batches: one `withTenant()` transaction (one query) per spa, RLS intact. */
const BATCH = 4

export async function allSpaPerformance(range: PerformanceRange): Promise<SpaPerformance[]> {
  const list = await platformDb()
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      aiBudgetUsd: tenants.aiBudgetUsd,
    })
    .from(tenants)
    .where(isNull(tenants.deletedAt))
    .orderBy(asc(tenants.name))
    .limit(500)
  const out: SpaPerformance[] = []
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH)
    const stats = await Promise.all(batch.map((t) => withTenant(t.id, (tx) => tenantPerformance(tx, range))))
    batch.forEach((t, j) => {
      out.push({ ...t, aiBudgetUsd: Number(t.aiBudgetUsd), ...stats[j]! })
    })
  }
  return out
}
