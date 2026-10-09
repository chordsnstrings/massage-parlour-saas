import { AUTOMATIONS, type AutomationKey, automationOn, DEFAULT_OFF_AUTOMATIONS } from '@spa/core'
import { jobRuns, type Tx, tenants } from '@spa/db'
import { desc, eq, gte, lt, sql } from 'drizzle-orm'

/** SQL predicate over `tenants`: the spa has this automation on (missing key = on, except default-off switches). */
export const automationOnSql = (key: AutomationKey) =>
  sql`coalesce((${tenants.settings} -> 'automations' ->> ${key})::boolean, ${!DEFAULT_OFF_AUTOMATIONS.includes(key)}::boolean)`

/** Current switch state for every automation of the spa (missing = on). */
export async function getAutomations(tx: Tx, tenantId: string): Promise<Record<AutomationKey, boolean>> {
  const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId))
  return Object.fromEntries(AUTOMATIONS.map((k) => [k, automationOn(row?.settings, k)])) as Record<
    AutomationKey,
    boolean
  >
}

/** Is one automation on for the spa (inside the caller's tenant transaction)? */
export async function isAutomationOn(tx: Tx, tenantId: string, key: AutomationKey) {
  const [row] = await tx
    .select({ on: automationOnSql(key) })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
  return row ? Boolean(row.on) : true
}

/** Flips one switch atomically (jsonb merge — other settings and switches are untouched). */
export async function setAutomation(tx: Tx, tenantId: string, key: AutomationKey, on: boolean) {
  await tx
    .update(tenants)
    .set({
      settings: sql`jsonb_set(${tenants.settings}, '{automations}',
        coalesce(${tenants.settings} -> 'automations', '{}'::jsonb) || jsonb_build_object(${key}::text, ${on}::boolean))`,
    })
    .where(eq(tenants.id, tenantId))
}

export type JobRunStatus = (typeof jobRuns.$inferSelect)['status']
const KEEP_MS = 7 * 86_400_000

/** Appends one run to the spa's job log and prunes rows older than 7 days (run inside `withTenant`). */
export async function recordJobRun(
  tx: Tx,
  tenantId: string,
  run: { job: string; status?: JobRunStatus; summary?: Record<string, number>; now?: Date },
) {
  const now = run.now ?? new Date()
  await tx.delete(jobRuns).where(lt(jobRuns.createdAt, new Date(now.getTime() - KEEP_MS)))
  await tx.insert(jobRuns).values({
    tenantId,
    job: run.job,
    status: run.status ?? 'ok',
    summary: run.summary ?? {},
    createdAt: now,
  })
}

/** The spa's job runs since `since` (default: last 24 hours), newest first. */
export async function recentJobRuns(tx: Tx, since = new Date(Date.now() - 86_400_000), limit = 50) {
  return tx
    .select()
    .from(jobRuns)
    .where(gte(jobRuns.createdAt, since))
    .orderBy(desc(jobRuns.createdAt))
    .limit(limit)
}
