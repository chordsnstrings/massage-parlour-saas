// F10: browser CSP violation reports, aggregated per day (Asia/Dubai), surface, directive and blocked source.
import { businessDateOf, CSP_SURFACES, type CspViolation } from '@spa/core'
import { cspViolations, type Db } from '@spa/db'
import { count, desc, eq, gte, sql, sum } from 'drizzle-orm'

/** Distinct rows per day before new combinations fold into blocked = 'other' (junk reports can't grow the table). */
export const CSP_ROWS_PER_DAY = 300

/** Calendar day in Asia/Dubai. */
const dubaiDate = (d: Date) => businessDateOf(d, '00:00')

export const cspSurfaceOf = (raw: string | null | undefined) =>
  (CSP_SURFACES as readonly string[]).includes(raw ?? '') ? (raw as string) : 'unknown'

export async function recordCspViolations(
  db: Db,
  surface: string,
  violations: CspViolation[],
  now = new Date(),
) {
  if (!violations.length) return
  const day = dubaiDate(now)
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(cspViolations)
    .where(eq(cspViolations.day, day))
  for (const v of violations) {
    const row = { day, surface: cspSurfaceOf(surface), directive: v.directive, blocked: v.blocked }
    const values = n >= CSP_ROWS_PER_DAY ? { ...row, blocked: 'other' } : row
    await db
      .insert(cspViolations)
      .values({ ...values, count: 1, lastPath: v.path, lastSeen: now })
      .onConflictDoUpdate({
        target: [cspViolations.day, cspViolations.surface, cspViolations.directive, cspViolations.blocked],
        set: { count: sql`${cspViolations.count} + 1`, lastPath: v.path, lastSeen: now },
      })
  }
}

export type CspSummary = {
  total: number
  top: { surface: string; directive: string; blocked: string; count: number; lastPath: string | null }[]
}

/** Violations over the last `days` days (today included), with the most frequent combinations. */
export async function cspViolationSummary(db: Db, days = 7, now = new Date()): Promise<CspSummary> {
  const since = dubaiDate(new Date(now.getTime() - (days - 1) * 86_400_000))
  const recent = gte(cspViolations.day, since)
  const [totals] = await db
    .select({ total: sum(cspViolations.count) })
    .from(cspViolations)
    .where(recent)
  const top = await db
    .select({
      surface: cspViolations.surface,
      directive: cspViolations.directive,
      blocked: cspViolations.blocked,
      count: sql<number>`sum(${cspViolations.count})::int`,
      lastPath: sql<
        string | null
      >`(array_agg(${cspViolations.lastPath} order by ${cspViolations.lastSeen} desc))[1]`,
    })
    .from(cspViolations)
    .where(recent)
    .groupBy(cspViolations.surface, cspViolations.directive, cspViolations.blocked)
    .orderBy(desc(sql`sum(${cspViolations.count})`))
    .limit(3)
  return { total: Number(totals?.total ?? 0), top }
}
