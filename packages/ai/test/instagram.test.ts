import {
  aiAgentSettings,
  closeAllDbs,
  conversationMessages,
  conversations,
  socialAccounts,
  tenants,
  withTenant,
} from '@spa/db'
import { seedPlatform } from '@spa/db/seed'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { encryptSecret, ingestInstagramWebhook } from '@spa/services'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createModelArkClient, respondToInstagram } from '../src'

process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret'
const { platform, app } = testDbs()
const env = { META_APP_ID: 'app', META_APP_SECRET: 'secret', META_WEBHOOK_VERIFY_TOKEN: 'verify' }
const IG = '17841400000000009'
const ids = {} as Record<string, string>
const now = new Date()

const modelReply = (content: string) =>
  createModelArkClient({
    apiKey: 'test',
    fetch: vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 200, completion_tokens: 20 },
        }),
      ),
    ),
  })

const dm = (mid: string, from: string, text: string) => ({
  object: 'instagram',
  entry: [
    {
      id: IG,
      time: Math.floor(now.getTime() / 1000),
      messaging: [
        { sender: { id: from }, recipient: { id: IG }, timestamp: now.getTime(), message: { mid, text } },
      ],
    },
  ],
})

const settings = (mode: 'approve' | 'autopilot', enabled = true) =>
  withTenant(
    ids.tenant!,
    (tx) =>
      tx
        .insert(aiAgentSettings)
        .values({ tenantId: ids.tenant!, agentKey: 'dm_agent', enabled, mode })
        .onConflictDoUpdate({
          target: [aiAgentSettings.tenantId, aiAgentSettings.agentKey],
          set: { enabled, mode },
        }),
    app,
  )

const messagesOf = (conversationId: string) =>
  withTenant(
    ids.tenant!,
    (tx) =>
      tx
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversationId))
        .orderBy(conversationMessages.createdAt),
    app,
  )

beforeAll(async () => {
  await resetTestDatabase()
  await seedPlatform(platform)
  const [t] = await platform.insert(tenants).values({ slug: 'ig-agent', name: 'Lotus Spa' }).returning()
  ids.tenant = t!.id
  await platform.insert(socialAccounts).values({
    tenantId: ids.tenant,
    platform: 'instagram',
    externalId: IG,
    tokenEnc: encryptSecret('IGAAfake'),
    tokenExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
  })
})
afterAll(closeAllDbs)

describe('Instagram agent hand-off', () => {
  it('stores an AI draft in approve mode (nothing is sent)', async () => {
    await settings('approve')
    const [item] = await ingestInstagramWebhook(dm('m-1', 'cust-1', 'Are you open on Friday?'), {
      platform,
      app,
    })
    const graph = vi.fn()
    const r = await respondToInstagram(item!, {
      platform,
      app,
      env,
      fetch: graph as unknown as typeof fetch,
      client: modelReply('Yes, we are open on Friday from 10:00.'),
    })
    expect(r).toBe('drafted')
    // only the optional profile lookup may call Instagram; no message is sent
    expect(graph.mock.calls.every(([url]) => !String(url).endsWith('/messages'))).toBe(true)
    const msgs = await messagesOf(item!.conversationId)
    expect(msgs.map((m) => [m.sender, m.text])).toEqual([
      ['customer', 'Are you open on Friday?'],
      ['ai_draft', 'Yes, we are open on Friday from 10:00.'],
    ])
  })

  it('sends on autopilot within the window', async () => {
    await settings('autopilot')
    const [item] = await ingestInstagramWebhook(dm('m-2', 'cust-2', 'Where are you?'), { platform, app })
    const graph = vi.fn(async (url: string) =>
      String(url).endsWith('/messages')
        ? new Response(JSON.stringify({ message_id: 'sent-1' }))
        : new Response(JSON.stringify({ username: 'noor.k' })),
    )
    const r = await respondToInstagram(item!, {
      platform,
      app,
      env,
      fetch: graph as unknown as typeof fetch,
      client: modelReply('We are in JLT Cluster D.'),
    })
    expect(r).toBe('sent')
    const msgs = await messagesOf(item!.conversationId)
    expect(msgs.at(-1)).toMatchObject({ sender: 'bot', externalId: 'sent-1', error: null })
    const [conv] = await withTenant(
      ids.tenant!,
      (tx) => tx.select().from(conversations).where(eq(conversations.id, item!.conversationId)),
      app,
    )
    expect(conv!.participant).toBe('@noor.k')
  })

  it('leaves human-mode threads and switched-off agents to staff', async () => {
    const [item] = await ingestInstagramWebhook(dm('m-3', 'cust-2', 'Thanks!'), { platform, app })
    await withTenant(
      ids.tenant!,
      (tx) =>
        tx.update(conversations).set({ mode: 'human' }).where(eq(conversations.id, item!.conversationId)),
      app,
    )
    const client = modelReply('unused')
    expect(await respondToInstagram(item!, { platform, app, env: {}, client })).toBe('human')
    await withTenant(ids.tenant!, (tx) => tx.update(conversations).set({ mode: 'bot' }), app)
    await settings('approve', false)
    const [next] = await ingestInstagramWebhook(dm('m-4', 'cust-2', 'Hello?'), { platform, app })
    expect(await respondToInstagram(next!, { platform, app, env: {}, client })).toBe('off')
  })

  it('never auto-posts a public comment reply, even on autopilot', async () => {
    await settings('autopilot')
    const [item] = await ingestInstagramWebhook(
      {
        object: 'instagram',
        entry: [
          {
            id: IG,
            time: Math.floor(now.getTime() / 1000),
            changes: [{ field: 'comments', value: { id: 'cm-0', text: 'Lovely place!', from: { id: '4' } } }],
          },
        ],
      },
      { platform, app },
    )
    const graph = vi.fn(async () => new Response(JSON.stringify({ id: 'never' })))
    const r = await respondToInstagram(item!, {
      platform,
      app,
      env,
      fetch: graph as unknown as typeof fetch,
      client: modelReply(JSON.stringify({ reply: 'Thank you, see you soon!', inappropriate: false })),
    })
    expect(r).toBe('drafted')
    expect(graph).not.toHaveBeenCalled()
    expect((await messagesOf(item!.conversationId)).at(-1)).toMatchObject({
      sender: 'ai_draft',
      text: 'Thank you, see you soon!',
    })
  })

  it('drafts a neutral public reply to an inappropriate comment and flags it', async () => {
    await settings('approve')
    const [item] = await ingestInstagramWebhook(
      {
        object: 'instagram',
        entry: [
          {
            id: IG,
            time: Math.floor(now.getTime() / 1000),
            changes: [
              { field: 'comments', value: { id: 'cm-1', text: 'something rude', from: { id: '5' } } },
            ],
          },
        ],
      },
      { platform, app },
    )
    const r = await respondToInstagram(item!, {
      platform,
      app,
      env,
      client: modelReply(
        JSON.stringify({ reply: 'We can only help with spa services and bookings.', inappropriate: true }),
      ),
    })
    expect(r).toBe('drafted')
    const [conv] = await withTenant(
      ids.tenant!,
      (tx) => tx.select().from(conversations).where(eq(conversations.id, item!.conversationId)),
      app,
    )
    expect(conv).toMatchObject({ channel: 'instagram_comment', flagged: true })
    expect((await messagesOf(item!.conversationId)).at(-1)).toMatchObject({
      sender: 'ai_draft',
      text: 'We can only help with spa services and bookings.',
    })
  })
})
