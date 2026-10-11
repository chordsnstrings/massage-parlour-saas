import { aiRuns, type Db, type Tx, tenants, withTenant } from '@spa/db'
import { type InsightsInput, insightsInput } from '@spa/services'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { runChat } from '../gateway'
import type { ModelArkClient } from '../modelark'

/** ModelArk is reachable (ARK_API_KEY set). Per-agent switches and budgets are still checked per call. */
export const aiConfigured = () => Boolean(process.env.ARK_API_KEY)

export const INSIGHTS_RUN_KEY = 'insights'

export const InsightsSchema = z.object({
  insights: z
    .array(
      z.object({
        title: z.string().min(3).max(90),
        detail: z.string().min(10).max(320),
        tone: z.enum(['positive', 'negative', 'neutral']),
      }),
    )
    .min(3)
    .max(5),
  actions: z
    .array(z.object({ title: z.string().min(3).max(90), detail: z.string().min(10).max(320) }))
    .min(2)
    .max(2),
})
export type InsightsOutput = z.infer<typeof InsightsSchema>

export class NotEnoughDataError extends Error {
  constructor() {
    super('Not enough activity in the last two weeks for insights yet.')
  }
}

/** Compact table for the model: one line per metric, this week vs last week. */
export function insightsPrompt(input: InsightsInput) {
  const fmt = (v: number | null) => (v === null ? 'n/a' : v.toLocaleString('en-AE'))
  const lines = input.metrics.map(
    (m) =>
      `- ${m.label}: ${fmt(m.thisWeek)} (last week ${fmt(m.lastWeek)}${m.change ? `, ${m.change}` : ''})`,
  )
  const top = (list: InsightsInput['topServices']['thisWeek']) =>
    list.length ? list.map((s) => `${s.name} (AED ${s.revenue}, ${s.count} sold)`).join('; ') : 'none'
  return [
    `This week: ${input.thisWeek.from} to ${input.thisWeek.to}. Last week: ${input.lastWeek.from} to ${input.lastWeek.to}.`,
    ...lines,
    `- Top services this week: ${top(input.topServices.thisWeek)}`,
    `- Top services last week: ${top(input.topServices.lastWeek)}`,
    ...input.notes.map((n) => `Note: ${n}`),
  ].join('\n')
}

/**
 * Weekly digest (P3): KPI numbers → 3–5 crisp insights + 2 suggested actions, stored as an executed
 * ai_runs row (agent_key 'insights'). Skips the model call entirely when both weeks are empty.
 */
export async function generateInsights(opts: {
  tenantId: string
  trigger: 'manual' | 'schedule'
  now?: Date
  client?: ModelArkClient
  db?: Db
  appDb?: Db
}) {
  const { input, name } = await withTenant(
    opts.tenantId,
    async (tx) => {
      const [t] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, opts.tenantId))
      return { input: await insightsInput(tx, opts.now), name: t?.name ?? 'the spa' }
    },
    opts.appDb,
  )
  if (!input.hasActivity) throw new NotEnoughDataError()
  const res = await runChat({
    tenantId: opts.tenantId,
    agentKey: 'insights_agent',
    client: opts.client,
    db: opts.db,
    schema: InsightsSchema,
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: `You are a sharp, friendly business analyst for ${name}, a massage & wellness spa in the UAE. Money is AED and VAT-inclusive.
From the weekly numbers, write 3 to 5 insights and exactly 2 suggested actions for the owner, in English.
Each insight: a short title (max 8 words) and one or two plain sentences that quote the actual numbers and the week-over-week change. Mark tone positive, negative or neutral.
Lead with what matters most for revenue. Only state facts present in the data; never invent numbers, causes or competitors. Where data is missing (n/a), don't speculate about it.
Actions must be concrete and doable this week inside the spa software (e.g. WhatsApp campaign to lapsed clients, adjust shifts at quiet hours, promote a top service on the website or Instagram, confirm bookings to cut no-shows).`,
      },
      { role: 'user', content: insightsPrompt(input) },
    ],
  })
  return withTenant(
    opts.tenantId,
    async (tx) => {
      const [run] = await tx
        .insert(aiRuns)
        .values({
          tenantId: opts.tenantId,
          agentKey: INSIGHTS_RUN_KEY,
          trigger: opts.trigger,
          input,
          output: res.output,
          status: 'executed',
          costUsd: res.costUsd.toFixed(6),
        })
        .returning()
      return run!
    },
    opts.appDb,
  )
}

export type InsightsRun = {
  id: string
  createdAt: Date
  trigger: string
  output: InsightsOutput
  input: InsightsInput | null
}

/** The most recent stored digest for the tenant (inside withTenant). */
export async function latestInsights(tx: Tx): Promise<InsightsRun | null> {
  const [row] = await tx
    .select()
    .from(aiRuns)
    .where(and(eq(aiRuns.agentKey, INSIGHTS_RUN_KEY), eq(aiRuns.status, 'executed')))
    .orderBy(desc(aiRuns.createdAt))
    .limit(1)
  if (!row) return null
  const output = InsightsSchema.safeParse(row.output)
  if (!output.success) return null
  return {
    id: row.id,
    createdAt: row.createdAt,
    trigger: row.trigger,
    output: output.data,
    input: (row.input as InsightsInput | null) ?? null,
  }
}
