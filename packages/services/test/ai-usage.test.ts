import { aiUsage, closeAllDbs, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  aiDailyCost,
  aiMonth,
  aiPeriod,
  aiTenantTotals,
  aiUsageBreakdown,
  aiUsageOverview,
  aiUsageTotals,
} from '../src'

const { platform, app } = testDbs()
const NOW = new Date('2026-10-09T08:00:00Z')
const ids = {} as Record<string, string>

beforeAll(async () => {
  await resetTestDatabase()
  const [a, b] = await platform
    .insert(tenants)
    .values([
      { slug: 'usage-a', name: 'Alpha Spa', aiBudgetUsd: '10' },
      { slug: 'usage-b', name: 'Beta Spa', aiBudgetUsd: '25', aiEnabled: false },
    ])
    .returning()
  ids.a = a!.id
  ids.b = b!.id
  const at = (iso: string) => new Date(iso)
  await platform.insert(aiUsage).values([
    // 1 Oct 01:00 Dubai (30 Sep 21:00 UTC) belongs to October.
    {
      tenantId: ids.a,
      agentKey: 'dm_agent',
      modelId: 'seed-lite',
      tokensIn: 1000,
      tokensOut: 200,
      costUsd: '3',
      createdAt: at('2026-09-30T21:00:00Z'),
    },
    {
      tenantId: ids.a,
      agentKey: 'dm_agent',
      modelId: 'seed-lite',
      tokensIn: 500,
      tokensOut: 100,
      tokensCached: 50,
      costUsd: '2.5',
      createdAt: at('2026-10-05T10:00:00Z'),
    },
    {
      tenantId: ids.a,
      agentKey: 'image_gen',
      modelId: 'seedream',
      images: 1,
      costUsd: '3',
      createdAt: at('2026-10-05T11:00:00Z'),
    },
    {
      tenantId: ids.a,
      agentKey: 'dm_agent',
      modelId: 'seed-lite',
      status: 'error',
      createdAt: at('2026-10-06T11:00:00Z'),
    },
    // 30 Sep 23:00 Dubai (19:00 UTC) is still September.
    {
      tenantId: ids.a,
      agentKey: 'content_agent',
      modelId: 'seed-pro',
      tokensIn: 10,
      tokensOut: 10,
      costUsd: '1.25',
      createdAt: at('2026-09-30T19:00:00Z'),
    },
    {
      tenantId: ids.b,
      agentKey: 'review_agent',
      modelId: 'seed-lite',
      tokensIn: 100,
      tokensOut: 100,
      costUsd: '0.5',
      createdAt: at('2026-10-02T10:00:00Z'),
    },
  ])
})
afterAll(closeAllDbs)

describe('AI usage aggregation (G18)', () => {
  it('uses Asia/Dubai month boundaries', () => {
    const oct = aiMonth(0, NOW)
    expect(oct).toMatchObject({ month: '2026-10', days: 31 })
    expect(oct.start.toISOString()).toBe('2026-09-30T20:00:00.000Z')
    expect(oct.end.toISOString()).toBe('2026-10-31T20:00:00.000Z')
    expect(aiPeriod('last-month', NOW)).toMatchObject({ key: 'last-month', month: '2026-09', days: 30 })
    expect(aiPeriod('bogus', NOW).key).toBe('month')
  })

  it('totals calls, tokens and cost per spa and month', async () => {
    const oct = await aiUsageTotals(platform, aiMonth(0, NOW))
    const a = oct.find((r) => r.tenantId === ids.a)
    expect(a).toEqual({
      tenantId: ids.a,
      calls: 4,
      errors: 1,
      tokensIn: 1500,
      tokensOut: 300,
      tokensCached: 50,
      images: 1,
      costUsd: 8.5,
    })
    expect(oct.find((r) => r.tenantId === ids.b)?.costUsd).toBe(0.5)
    const sep = await aiTenantTotals(platform, aiMonth(-1, NOW), ids.a)
    expect(sep).toMatchObject({ calls: 1, costUsd: 1.25 })
  })

  it('splits spend by agent and by model, most expensive first', async () => {
    const d = await aiUsageBreakdown(platform, aiMonth(0, NOW), ids.a)
    expect(d.byAgent).toEqual([
      { key: 'dm_agent', calls: 3, tokens: 1800, images: 0, costUsd: 5.5 },
      { key: 'image_gen', calls: 1, tokens: 0, images: 1, costUsd: 3 },
    ])
    expect(d.byModel.map((m) => [m.key, m.costUsd])).toEqual([
      ['seed-lite', 5.5],
      ['seedream', 3],
    ])
  })

  it('returns every Dubai day of the month', async () => {
    const days = await aiDailyCost(platform, aiMonth(0, NOW), ids.a)
    expect(days).toHaveLength(31)
    expect(days[0]).toEqual({ date: '2026-10-01', calls: 1, costUsd: 3 })
    expect(days[4]).toEqual({ date: '2026-10-05', calls: 2, costUsd: 5.5 })
    expect(days[1]!.costUsd).toBe(0)
  })

  it('keeps spas apart inside withTenant (RLS)', async () => {
    const rows = await withTenant(ids.b!, (tx) => aiUsageTotals(tx, aiMonth(0, NOW)), app)
    expect(rows.map((r) => r.tenantId)).toEqual([ids.b])
  })

  it('lists every spa with budget, share used and level', async () => {
    const list = await aiUsageOverview(platform, NOW)
    expect(list.map((s) => s.slug)).toEqual(['usage-a', 'usage-b'])
    expect(list[0]).toMatchObject({ budgetUsd: 10, ratio: 0.85, level: 'warn', aiEnabled: true })
    expect(list[0]!.lastMonth.costUsd).toBe(1.25)
    expect(list[1]).toMatchObject({ budgetUsd: 25, level: 'ok', aiEnabled: false })
  })
})
