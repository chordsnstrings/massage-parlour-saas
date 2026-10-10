import { businessDateOf } from '@spa/core'
import { branches, withTenant } from '@spa/db'
import {
  PERFORMANCE_RANGES,
  type PerformanceRangeKey,
  performanceRange,
  prepaidLiability,
  rebookingRate,
  retentionCohorts,
  revPath,
  roomUtilisation,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { can, type MemberContext } from '@/server/access'
import { allowedBranches } from '../calendar/data'

/** Matches no branch: a member scoped to branches that are all archived sees empty figures, not the whole spa. */
const NO_BRANCH = '00000000-0000-0000-0000-000000000000'
const DATE = /^\d{4}-\d{2}-\d{2}$/

export type ReportQuery = { range?: string; branch?: string; rebook?: string; asOf?: string }
export const RANGE_KEYS = PERFORMANCE_RANGES.map((r) => r.key) as PerformanceRangeKey[]

/**
 * Everything the Reports page and its export show (F31). `reports.view` is checked by the caller; revenue needs
 * `dashboard.revenue`, the prepaid liability (ledger) `accounting.view`. Branch scoping as on the home dashboard.
 */
export async function loadReports(ctx: MemberContext, q: ReportQuery, now = new Date()) {
  const showRevenue = can(ctx, 'dashboard.revenue')
  const showLiability = can(ctx, 'accounting.view')
  const scoped = Boolean(ctx.member && !ctx.member.allBranches)
  return withTenant(ctx.tenant.id, async (tx) => {
    const allowed = await allowedBranches(tx, ctx)
    const picked = allowed.find((b) => b.id === q.branch) ?? (scoped ? allowed[0] : undefined)
    const branchId = picked?.id ?? (scoped ? NO_BRANCH : undefined)
    const branch =
      picked ??
      (await tx.select().from(branches).where(eq(branches.isDefault, true)).limit(1))[0] ??
      allowed[0]
    const cutoff = branch?.businessDayCutoff.slice(0, 5) ?? '05:00'
    const today = businessDateOf(now, cutoff)
    const range = performanceRange(q.range, today)
    const scope = { branchId, from: range.from, to: range.to }
    const asOf =
      q.asOf && DATE.test(q.asOf) && !Number.isNaN(Date.parse(q.asOf))
        ? q.asOf > today
          ? today
          : q.asOf
        : range.to
    // One query per KPI, in sequence (one connection per transaction).
    const rebooking = await rebookingRate(tx, { ...scope, windowDays: Number(q.rebook), today })
    const cohorts = await retentionCohorts(tx, { branchId, to: range.to, today })
    const rev = showRevenue ? await revPath(tx, scope, now) : null
    const rooms = await roomUtilisation(tx, scope)
    const liability = showLiability ? await prepaidLiability(tx, asOf) : null
    return {
      range,
      today,
      cutoff,
      scoped,
      branchId: picked?.id,
      branchName: picked?.name ?? null,
      branchOptions: allowed.map((b) => ({ id: b.id, name: b.name })),
      asOf,
      customAsOf: asOf !== range.to,
      rebooking,
      cohorts,
      rev,
      rooms,
      liability,
    }
  })
}

export type ReportsData = Awaited<ReturnType<typeof loadReports>>

/** Query string for the page / export with defaults left out (range 30, rebooking window 30, as-of = period end). */
export function reportQuery(d: ReportsData, patch: ReportQuery = {}) {
  const merged: ReportQuery = {
    range: d.range.key,
    branch: d.branchId,
    rebook: String(d.rebooking.windowDays),
    asOf: d.customAsOf ? d.asOf : undefined,
    ...patch,
  }
  const p = new URLSearchParams()
  if (merged.range && merged.range !== '30') p.set('range', merged.range)
  if (merged.branch) p.set('branch', merged.branch)
  if (merged.rebook && merged.rebook !== '30') p.set('rebook', merged.rebook)
  if (merged.asOf) p.set('asOf', merged.asOf)
  return p.size ? `?${p}` : ''
}
