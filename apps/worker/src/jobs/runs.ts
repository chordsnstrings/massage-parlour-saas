import type { AutomationKey } from '@spa/core'
import { platformDb, tenants, withTenant } from '@spa/db'
import { automationOnSql, type JobRunStatus, recordJobRun } from '@spa/services'
import { and, inArray } from 'drizzle-orm'
import { log } from '../log'

export const LIVE_STATUSES = ['trial', 'active', 'past_due'] as const

/** Live spas; with `automation`, only those that have that switch on (B3 — a switched-off spa is skipped). */
export const activeTenants = (automation?: AutomationKey) =>
  platformDb()
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(
      and(inArray(tenants.status, [...LIVE_STATUSES]), automation ? automationOnSql(automation) : undefined),
    )

/** Writes one row to the spa's job log (Automations page). Never throws: the log must not break a job. */
export async function recordRun(
  tenantId: string,
  job: string,
  status: JobRunStatus = 'ok',
  summary: Record<string, number> = {},
) {
  try {
    await withTenant(tenantId, (tx) => recordJobRun(tx, tenantId, { job, status, summary }))
  } catch (error) {
    log('error', 'job run log failed', { tenantId, job, error: String(error) })
  }
}
