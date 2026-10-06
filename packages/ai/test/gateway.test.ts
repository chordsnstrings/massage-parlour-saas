import { aiUsage, closeAllDbs, tenants } from '@spa/db'
import { seedPlatform } from '@spa/db/seed'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { AiBudgetExceededError, costOf, createModelArkClient, dubaiMonthStart, runChat } from '../src'

const { platform } = testDbs()
let tenantId: string

const reply = (content: string, usage = { prompt_tokens: 1000, completion_tokens: 200 }) =>
  new Response(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage }),
  )

beforeAll(async () => {
  await resetTestDatabase()
  await seedPlatform(platform)
  const [t] = await platform
    .insert(tenants)
    .values({ slug: 'ai-spa', name: 'AI Spa', aiBudgetUsd: '1' })
    .returning()
  tenantId = t!.id
})
afterAll(closeAllDbs)

describe('costOf', () => {
  it('prices fresh, cached and output tokens per million', () => {
    const cfg = { priceInPerM: '0.25', priceCachedInPerM: '0.05', priceOutPerM: '2.00' }
    expect(costOf(cfg, { prompt_tokens: 1_000_000, completion_tokens: 0 })).toBeCloseTo(0.25)
    expect(
      costOf(cfg, {
        prompt_tokens: 1_000_000,
        completion_tokens: 500_000,
        prompt_tokens_details: { cached_tokens: 1_000_000 },
      }),
    ).toBeCloseTo(1.05)
  })
})

describe('dubaiMonthStart', () => {
  it('uses Asia/Dubai month boundaries', () => {
    // 31 Oct 21:30 UTC is already 1 Nov in Dubai.
    expect(dubaiMonthStart(new Date('2026-10-31T21:30:00Z')).toISOString()).toBe('2026-10-31T20:00:00.000Z')
  })
})

describe('runChat', () => {
  it('uses json_schema mode for models that support it and meters usage', async () => {
    const fetchMock = vi.fn(async () => reply('{"intent":"booking"}'))
    const client = createModelArkClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch })
    const res = await runChat({
      tenantId,
      agentKey: 'dm_agent',
      messages: [{ role: 'user', content: 'Can I book a massage at 5?' }],
      schema: z.object({ intent: z.enum(['booking', 'question', 'other']) }),
      db: platform,
      client,
    })
    expect(res.output).toEqual({ intent: 'booking' })
    expect(res.modelId).toBe('seed-2-0-lite-260428')
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.response_format.type).toBe('json_schema')
    const rows = await platform.select().from(aiUsage).where(eq(aiUsage.tenantId, tenantId))
    expect(rows).toHaveLength(1)
    expect(Number(rows[0]!.costUsd)).toBeCloseTo((1000 * 0.25 + 200 * 2) / 1e6)
  })

  it('falls back to instructions and retries once for models without structured output', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply('Sure! Here you go'))
      .mockResolvedValueOnce(reply('```json\n{"caption":"Unwind tonight"}\n```'))
    const client = createModelArkClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch })
    const res = await runChat({
      tenantId,
      agentKey: 'content_agent',
      messages: [{ role: 'user', content: 'Write a caption' }],
      schema: z.object({ caption: z.string() }),
      db: platform,
      client,
    })
    expect(res.output.caption).toBe('Unwind tonight')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(first.response_format).toBeUndefined()
    expect(first.messages[0].content).toContain('JSON Schema')
  })

  it('refuses to call the model once the monthly budget is spent', async () => {
    await platform.insert(aiUsage).values({ tenantId, agentKey: 'dm_agent', modelId: 'x', costUsd: '5' })
    const fetchMock = vi.fn()
    const client = createModelArkClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch })
    await expect(
      runChat({
        tenantId,
        agentKey: 'dm_agent',
        messages: [{ role: 'user', content: 'hi' }],
        db: platform,
        client,
      }),
    ).rejects.toBeInstanceOf(AiBudgetExceededError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
