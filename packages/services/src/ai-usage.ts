// AI spend per spa (PLAN §18 G18): the one place that aggregates `ai_usage`. Used by the gateway's budget
// thresholds, the console AI usage + Performance pages and the dashboard plan meter. Works on a platform
// connection (all spas) or inside `withTenant()` (RLS limits it to that spa).
import { type Db, type Tx, tenants } from '@spa/db'
import { asc, isNull, sql } from 'drizzle-orm'

type Q = Db | Tx

/** Owner + super-admin are warned at this share of the monthly budget; at 1.0 AI stops until next month. */
export const AI_WARN_RATIO = 0.8

export type AiBudgetLevel = 'ok' | 'warn' | 'over'

/** Budget state for a month's spend. A budget of 0 means no AI at all. */
export function aiBudgetLevel(spendUsd: number, budgetUsd: number): AiBudgetLevel {
  if (budgetUsd <= 0 || spendUsd >= budgetUsd) return 'over'
  return spendUsd >= budgetUsd * AI_WARN_RATIO ? 'warn' : 'ok'
}

export type AiPeriodKey = 'month' | 'last-month'
export type AiPeriod = { key: AiPeriodKey; month: string; start: Date; end: Date; days: number }

const DUBAI_MS = 4 * 3600_000 // Asia/Dubai is UTC+4, no DST

/** Asia/Dubai calendar month around `now` (`offset` -1 = the month before), as UTC instants [start, end). */
export function aiMonth(offset = 0, now = new Date()): Omit<AiPeriod, 'key'> {
  const d = new Date(now.getTime() + DUBAI_MS)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + offset
  const first = Date.UTC(y, m, 1)
  const next = Date.UTC(y, m + 1, 1)
  return {
    month: new Date(first).toISOString().slice(0, 7),
    start: new Date(first - DUBAI_MS),
    end: new Date(next - DUBAI_MS),
    days: Math.round((next - first) / 86_400_000),
  }
}

export function aiPeriod(key: string | undefined, now = new Date()): AiPeriod {
  const k: AiPeriodKey = key === 'last-month' ? 'last-month' : 'month'
  return { key: k, ...aiMonth(k === 'month' ? 0 : -1, now) }
}

type Range = Pick<AiPeriod, 'start' | 'end'>

export type AiUsageTotals = {
  tenantId: string
  calls: number
  errors: number
  tokensIn: number
  tokensOut: number
  tokensCached: number
  images: number
  costUsd: number
}

export const emptyAiTotals = (tenantId: string): AiUsageTotals => ({
  tenantId,
  calls: 0,
  errors: 0,
  tokensIn: 0,
  tokensOut: 0,
  tokensCached: 0,
  images: 0,
  costUsd: 0,
})

const n = (v: unknown) => Number(v ?? 0)
const rows = async <T>(db: Q, query: ReturnType<typeof sql>) => (await db.execute(query)).rows as T[]
const where = ({ start, end }: Range, tenantId?: string) =>
  sql`created_at >= ${start.toISOString()}::timestamptz and created_at < ${end.toISOString()}::timestamptz
    ${tenantId ? sql`and tenant_id = ${tenantId}` : sql``}`

/** Calls, tokens and cost per spa in the range (spas without usage are absent). */
export async function aiUsageTotals(db: Q, range: Range, tenantId?: string): Promise<AiUsageTotals[]> {
  const list = await rows<Record<string, unknown>>(
    db,
    sql`select tenant_id, count(*)::int as calls, count(*) filter (where status = 'error')::int as errors,
      coalesce(sum(tokens_in), 0) as tokens_in, coalesce(sum(tokens_out), 0) as tokens_out,
      coalesce(sum(tokens_cached), 0) as tokens_cached, coalesce(sum(images), 0) as images,
      coalesce(sum(cost_usd), 0) as cost
      from ai_usage where ${where(range, tenantId)} group by tenant_id`,
  )
  return list.map((r) => ({
    tenantId: String(r.tenant_id),
    calls: n(r.calls),
    errors: n(r.errors),
    tokensIn: n(r.tokens_in),
    tokensOut: n(r.tokens_out),
    tokensCached: n(r.tokens_cached),
    images: n(r.images),
    costUsd: Math.round(n(r.cost) * 1e6) / 1e6,
  }))
}

/** One spa's spend in the range (zeros when it has none). */
export async function aiTenantTotals(db: Q, range: Range, tenantId: string) {
  return (await aiUsageTotals(db, range, tenantId))[0] ?? emptyAiTotals(tenantId)
}

export type AiUsageSlice = { key: string; calls: number; tokens: number; images: number; costUsd: number }

/** Spend by agent (feature) and by model, most expensive first; all spas when `tenantId` is omitted. */
export async function aiUsageBreakdown(
  db: Q,
  range: Range,
  tenantId?: string,
): Promise<{ byAgent: AiUsageSlice[]; byModel: AiUsageSlice[] }> {
  const list = await rows<Record<string, unknown>>(
    db,
    sql`select agent_key, model_id, grouping(agent_key) as g_agent, count(*)::int as calls,
      coalesce(sum(tokens_in + tokens_out), 0) as tokens, coalesce(sum(images), 0) as images,
      coalesce(sum(cost_usd), 0) as cost
      from ai_usage where ${where(range, tenantId)}
      group by grouping sets ((agent_key), (model_id))
      order by cost desc, calls desc`,
  )
  const slice = (key: unknown, r: Record<string, unknown>): AiUsageSlice => ({
    key: String(key),
    calls: n(r.calls),
    tokens: n(r.tokens),
    images: n(r.images),
    costUsd: Math.round(n(r.cost) * 1e6) / 1e6,
  })
  return {
    byAgent: list.filter((r) => n(r.g_agent) === 0).map((r) => slice(r.agent_key, r)),
    byModel: list.filter((r) => n(r.g_agent) === 1).map((r) => slice(r.model_id, r)),
  }
}

export type AiUsageDay = { date: string; calls: number; costUsd: number }

/** Cost per Asia/Dubai calendar day for every day of the range (zero days included). */
export async function aiDailyCost(db: Q, range: Range, tenantId?: string): Promise<AiUsageDay[]> {
  const list = await rows<Record<string, unknown>>(
    db,
    sql`select (created_at at time zone 'Asia/Dubai')::date::text as day, count(*)::int as calls,
      coalesce(sum(cost_usd), 0) as cost
      from ai_usage where ${where(range, tenantId)} group by 1`,
  )
  const byDay = new Map(list.map((r) => [String(r.day), r]))
  const out: AiUsageDay[] = []
  for (let t = range.start.getTime() + DUBAI_MS; t < range.end.getTime() + DUBAI_MS; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10)
    const r = byDay.get(date)
    out.push({ date, calls: n(r?.calls), costUsd: Math.round(n(r?.cost) * 1e6) / 1e6 })
  }
  return out
}

export type SpaAiUsage = {
  id: string
  name: string
  slug: string
  status: string
  aiEnabled: boolean
  budgetUsd: number
  month: AiUsageTotals
  lastMonth: AiUsageTotals
  /** This month's spend as a share of the budget (0..∞; budget 0 → 1 when spent, else 0). */
  ratio: number
  level: AiBudgetLevel
}

/** Every spa with this and last month's AI totals (platform connection only: reads across spas). */
export async function aiUsageOverview(db: Db, now = new Date()): Promise<SpaAiUsage[]> {
  const [list, month, last] = await Promise.all([
    db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        aiEnabled: tenants.aiEnabled,
        budgetUsd: tenants.aiBudgetUsd,
      })
      .from(tenants)
      .where(isNull(tenants.deletedAt))
      .orderBy(asc(tenants.name))
      .limit(500),
    aiUsageTotals(db, aiMonth(0, now)),
    aiUsageTotals(db, aiMonth(-1, now)),
  ])
  const m = new Map(month.map((r) => [r.tenantId, r]))
  const l = new Map(last.map((r) => [r.tenantId, r]))
  return list.map((t) => {
    const budgetUsd = Number(t.budgetUsd)
    const cur = m.get(t.id) ?? emptyAiTotals(t.id)
    return {
      ...t,
      budgetUsd,
      month: cur,
      lastMonth: l.get(t.id) ?? emptyAiTotals(t.id),
      ratio: budgetUsd > 0 ? cur.costUsd / budgetUsd : cur.costUsd > 0 ? 1 : 0,
      level: aiBudgetLevel(cur.costUsd, budgetUsd),
    }
  })
}
