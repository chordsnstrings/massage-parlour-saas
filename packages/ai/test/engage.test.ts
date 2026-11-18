import { aiModelConfig, aiUsage, branches, closeAllDbs, tenants, withTenant } from '@spa/db'
import { seedPlatform } from '@spa/db/seed'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  type ChatRequest,
  generateInsights,
  insightsPrompt,
  type ModelArkClient,
  NotEnoughDataError,
  receiptModelKey,
  scanReceipt,
} from '../src'

const { platform, app } = testDbs()
let tenantId: string

const fakeClient = (content: string) => {
  const chat = vi.fn(async (_req: ChatRequest) => ({
    choices: [{ message: { role: 'assistant' as const, content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1200, completion_tokens: 80 },
  }))
  return { client: { chat, image: vi.fn() } as unknown as ModelArkClient, chat }
}

beforeAll(async () => {
  await resetTestDatabase()
  await seedPlatform(platform)
  const [t] = await platform.insert(tenants).values({ slug: 'eng-ai', name: 'Engage AI Spa' }).returning()
  tenantId = t!.id
  await withTenant(
    tenantId,
    (tx) => tx.insert(branches).values({ tenantId, name: 'Main', isDefault: true }),
    app,
  )
})
afterAll(closeAllDbs)

describe('receipt scanning', () => {
  it('falls back to the chat model and sends the image as an image_url part', async () => {
    expect(await receiptModelKey(platform)).toBe('dm_agent')
    const { client, chat } = fakeClient(
      JSON.stringify({
        vendor: 'DEWA',
        date: '28/09/2026',
        total: 'AED 525.00',
        vat: 25,
        trn: '100234567890003',
        currency: 'AED',
        category: '6200',
      }),
    )
    const res = await scanReceipt({
      tenantId,
      image: 'data:image/jpeg;base64,AAAA',
      today: '2026-10-06',
      client,
      db: platform,
    })
    expect(res.fields).toEqual({
      vendor: 'DEWA',
      date: '2026-09-28',
      totalAed: 525,
      vatAed: 25,
      trn: '100234567890003',
      currency: 'AED',
      category: '6200',
    })
    const req = chat.mock.calls[0]![0]
    expect(req.model).toBe('seed-2-0-lite-260428')
    const user = req.messages.find((m) => m.role === 'user') as unknown as { content: unknown[] }
    expect(user.content).toContainEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,AAAA', detail: 'high' },
    })
    const [usage] = await platform.select().from(aiUsage).where(eq(aiUsage.tenantId, tenantId))
    expect(usage).toMatchObject({ agentKey: 'dm_agent', tokensIn: 1200 })
  })

  it('prefers a configured vision model', async () => {
    await platform
      .insert(aiModelConfig)
      .values({ agentKey: 'vision', label: 'Vision', modelId: 'seed-vision-x' })
    expect(await receiptModelKey(platform)).toBe('vision')
    await platform.delete(aiModelConfig).where(eq(aiModelConfig.agentKey, 'vision'))
  })
})

describe('weekly insights', () => {
  it('skips the model when there is no activity', async () => {
    const { client, chat } = fakeClient('{}')
    await expect(
      generateInsights({ tenantId, trigger: 'manual', client, db: platform, appDb: app }),
    ).rejects.toBeInstanceOf(NotEnoughDataError)
    expect(chat).not.toHaveBeenCalled()
  })

  it('renders a compact prompt table', () => {
    const text = insightsPrompt({
      thisWeek: { from: '2026-09-28', to: '2026-10-04' },
      lastWeek: { from: '2026-09-21', to: '2026-09-27' },
      metrics: [
        {
          key: 'revenue',
          label: 'Revenue (AED, VAT incl.)',
          thisWeek: 12000,
          lastWeek: 10000,
          change: '+20%',
        },
      ],
      topServices: { thisWeek: [{ name: 'Swedish', revenue: 5000, count: 14 }], lastWeek: [] },
      notes: ['No shifts were scheduled this week, so utilisation is unknown.'],
      hasActivity: true,
    })
    expect(text).toContain('- Revenue (AED, VAT incl.): 12,000 (last week 10,000, +20%)')
    expect(text).toContain('Top services this week: Swedish (AED 5000, 14 sold)')
    expect(text).toContain('Top services last week: none')
    expect(text).toContain('Note: No shifts')
  })
})
