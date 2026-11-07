import { aiAgentSettings, pageVersions, platformDb, tenants, withTenant } from '@spa/db'
import { entitledSql, runSeoCheck } from '@spa/services'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { log } from '../log'
import { LIVE_STATUSES } from './runs'

/**
 * Weekly, Mondays 06:00 Dubai (R30): the search check of every live spa with a published site, the AI studio's
 * SEO switch (`seo_agent`) on and the `ai` feature in its plan. Each spa through `withTenant` (only this lookup is
 * cross-tenant); one spa's error is logged and the sweep goes on. Results: the console Websites page + AI studio.
 */
export async function weeklySeoChecks(now = new Date()) {
  const due = await platformDb()
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .innerJoin(aiAgentSettings, eq(aiAgentSettings.tenantId, tenants.id))
    .where(
      and(
        inArray(tenants.status, [...LIVE_STATUSES]),
        eq(aiAgentSettings.agentKey, 'seo_agent'),
        eq(aiAgentSettings.enabled, true),
        entitledSql('ai'),
        sql`exists (select 1 from ${pageVersions} v where v.tenant_id = ${tenants.id} and v.status = 'published')`,
      ),
    )
  let checked = 0
  for (const t of due) {
    try {
      const row = await withTenant(t.id, (tx) => runSeoCheck(tx, t.id, { trigger: 'weekly', now }))
      if (!row) continue
      checked++
      log('info', 'seo check', { tenant: t.slug, ...row.counts })
    } catch (error) {
      log('error', 'seo check failed', { tenant: t.slug, error: String(error) })
    }
  }
  return checked
}
