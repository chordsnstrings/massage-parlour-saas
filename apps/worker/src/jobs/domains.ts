import { domains, platformDb, tenants } from '@spa/db'
import { checkDomain, domainDeps, isDomainCheckDue, tenantDomainRun } from '@spa/services'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { log } from '../log'

/** Domains per run; a backlog simply continues on the next run 10 minutes later. */
const BATCH = 100

/**
 * Every 10 minutes: re-check custom domains that are due — pending/verifying ones every 10 minutes for the
 * first day, then hourly (automatic checks give up after 7 days), active ones once a day. The due list is a
 * platform lookup; each check then reads and writes the domain inside withTenant().
 */
export async function verifyCustomDomains(now = new Date()) {
  const candidates = await platformDb()
    .select({
      id: domains.id,
      tenantId: domains.tenantId,
      hostname: domains.hostname,
      status: domains.status,
      createdAt: domains.createdAt,
      checkedAt: domains.checkedAt,
    })
    .from(domains)
    .innerJoin(tenants, eq(tenants.id, domains.tenantId))
    .where(
      and(
        eq(domains.kind, 'custom'),
        inArray(domains.status, ['pending', 'verifying', 'active']),
        ne(tenants.status, 'cancelled'),
      ),
    )
  const due = candidates
    .filter((d) => isDomainCheckDue(d, now))
    .sort((a, b) => (a.checkedAt?.getTime() ?? 0) - (b.checkedAt?.getTime() ?? 0))
    .slice(0, BATCH)
  const deps = domainDeps()
  let changed = 0
  for (const d of due) {
    try {
      const after = await checkDomain(tenantDomainRun(d.tenantId), d.id, { deps, automatic: true })
      if (after.status !== d.status) {
        changed++
        log('info', 'domain status changed', { hostname: d.hostname, from: d.status, to: after.status })
      }
    } catch (error) {
      log('error', 'domain check failed', { hostname: d.hostname, error: String(error) })
    }
  }
  return { checked: due.length, changed }
}
