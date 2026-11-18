import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  aiUsage,
  auditLog,
  closeAllDbs,
  conversationMessages,
  conversations,
  outbox,
  platformSettings,
  socialAccounts,
  socialPosts,
  tenants,
  withTenant,
} from '@spa/db'
import { seedPlatform } from '@spa/db/seed'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { encryptSecret } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createModelArkClient,
  exposedMetaTools,
  handleMetaMcpRequest,
  isForbiddenTool,
  META_TOOL_NAMES,
  metaMcpSources,
  runMetaAgent,
  signMcpToken,
  verifyMcpToken,
} from '../src'

process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret'
const { platform, app } = testDbs()
const env = {
  ...process.env,
  META_APP_ID: 'app',
  META_APP_SECRET: 'secret',
  META_WEBHOOK_VERIFY_TOKEN: 'verify',
}
const ids = {} as Record<string, string>
const now = new Date()
const none = { configured: false, instagram: null, facebookPage: null }

const setMcp = (metaMcp: { groups?: Record<string, boolean>; autopilot?: boolean }) =>
  platform.update(tenants).set({ settings: { metaMcp } }).where(eq(tenants.id, ids.tenant!))

const rpc = (token: string | null, body: unknown, method = 'POST') =>
  handleMetaMcpRequest(
    new Request('http://app.localhost/api/mcp/meta', {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
    { platform, app },
  )
const listTools = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }

/** Model that answers with the given assistant messages in turn (tool calls, then text). */
function scriptedModel(steps: unknown[]) {
  let i = 0
  const fetch = vi.fn(async () => {
    const message = steps[Math.min(i++, steps.length - 1)]
    return new Response(
      JSON.stringify({
        choices: [{ message, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1000, completion_tokens: 100 },
      }),
    )
  })
  return { client: createModelArkClient({ apiKey: 'test', fetch }), fetch }
}
const toolCall = (name: string, args: unknown) => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id: `c-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
})

beforeAll(async () => {
  await resetTestDatabase()
  await seedPlatform(platform)
  const [t] = await platform.insert(tenants).values({ slug: 'mcp-spa', name: 'Lotus Spa' }).returning()
  const [other] = await platform.insert(tenants).values({ slug: 'mcp-other', name: 'Other Spa' }).returning()
  ids.tenant = t!.id
  ids.other = other!.id
  await platform.insert(socialAccounts).values({
    tenantId: ids.tenant,
    platform: 'instagram',
    externalId: '17841400000000077',
    tokenEnc: encryptSecret('IGAAfake'),
    tokenExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
  })
  const [conv] = await withTenant(
    ids.tenant,
    (tx) =>
      tx
        .insert(conversations)
        .values({
          tenantId: ids.tenant!,
          channel: 'instagram_comment',
          externalThreadId: 'comment-1',
          participant: '@noor',
          lastCustomerMsgAt: now,
        })
        .returning(),
    app,
  )
  ids.comment = conv!.id
  await withTenant(
    ids.tenant,
    (tx) =>
      tx.insert(conversationMessages).values({
        tenantId: ids.tenant!,
        conversationId: ids.comment!,
        direction: 'in',
        sender: 'customer',
        text: 'Do you open on Friday?',
      }),
    app,
  )
})
afterAll(closeAllDbs)

describe('tool allow-list', () => {
  it('never exposes a WhatsApp send tool', () => {
    for (const name of [
      'whatsapp.send_message',
      'whatsapp_send',
      'send_whatsapp_message',
      'wa.send',
      'whatsapp.draft_and_send',
      'whatsapp.messages',
    ])
      expect(isForbiddenTool({ name }), name).toBe(true)
    expect(isForbiddenTool({ name: 'messages.send', description: 'Send a WhatsApp Business message' })).toBe(
      true,
    )
    expect(
      isForbiddenTool({
        name: 'send_message',
        inputSchema: { properties: { channel: { enum: ['whatsapp', 'messenger'] } } },
      }),
    ).toBe(true)
    expect(isForbiddenTool({ name: 'whatsapp.draft_message' })).toBe(false)
    expect(isForbiddenTool({ name: 'whatsapp.read_inbox_summary' })).toBe(false)
    expect(META_TOOL_NAMES.some((n) => /whatsapp/.test(n) && /send/.test(n))).toBe(false)
  })

  it('limits each agent to its allow-list, the spa toggles and the live connections', () => {
    expect(exposedMetaTools({ agentKey: 'slot_filler', availability: none })).toEqual([
      'whatsapp.read_inbox_summary',
      'whatsapp.draft_message',
    ])
    expect(exposedMetaTools({ agentKey: 'unknown_agent', availability: none })).toEqual([])
    const all = exposedMetaTools({ agentKey: 'meta_agent', availability: none })
    expect(all).toContain('instagram.create_post_draft')
    expect(all).not.toContain('instagram.publish_approved_post') // needs a connected account
    expect(all.some((n) => n.startsWith('facebook_page.'))).toBe(false) // no Page token
    const off = exposedMetaTools({ agentKey: 'meta_agent', groups: { whatsapp: false }, availability: none })
    expect(off.some((n) => n.startsWith('whatsapp.'))).toBe(false)
    const fb = { configured: true, instagram: {}, facebookPage: {} }
    expect(exposedMetaTools({ agentKey: 'comment_agent', availability: fb })).not.toContain(
      'facebook_page.reply_comment',
    )
    expect(exposedMetaTools({ agentKey: 'comment_agent', autopilot: true, availability: fb })).toContain(
      'facebook_page.reply_comment',
    )
  })

  it('filters an external server: only admin-allowed, never WhatsApp send, only when the spa opts in', async () => {
    const external = (req: Request) => {
      const server = new McpServer({ name: 'ext', version: '1' })
      const ok = async () => ({ content: [{ type: 'text' as const, text: '"ok"' }] })
      server.registerTool('whatsapp.send_message', { inputSchema: { to: z.string() } }, ok)
      server.registerTool('messages.send', { description: 'Send WhatsApp messages' }, ok)
      server.registerTool('insights.get', { description: 'Account insights' }, ok)
      server.registerTool('other.tool', { description: 'Not allowed' }, ok)
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      return server.connect(transport).then(() => transport.handleRequest(req))
    }
    const externalFetch = vi.fn((url: string | URL, init?: RequestInit) => external(new Request(url, init)))
    await platform
      .update(platformSettings)
      .set({
        metaMcpEnabled: true,
        metaMcpUrl: 'https://mcp.example.com/mcp',
        metaMcpKeyEnc: encryptSecret('ext-key'),
        metaMcpTools: ['whatsapp.send_message', 'messages.send', 'insights.get'],
      })
      .where(eq(platformSettings.id, 1))
    try {
      await setMcp({ groups: { external: true } })
      const sources = await metaMcpSources({
        tenantId: ids.tenant!,
        agentKey: 'meta_agent',
        server: { platform, app },
        externalFetch,
      })
      const ext = sources.find((s) => s.label === 'external')
      expect(ext?.tools.map((t) => t.fnName)).toEqual(['ext__insights__get'])
      const [, init] = externalFetch.mock.calls[0]!
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ext-key')
      const all = sources.flatMap((s) => s.tools.map((t) => t.name))
      expect(all.some((n) => /whatsapp/.test(n) && /send/.test(n))).toBe(false)
      expect(await ext!.call('whatsapp.send_message', { to: '1' })).toMatch(/not available/)
      await Promise.all(sources.map((s) => s.close()))

      // The DM agent's allow-list has no external tools; a spa that hasn't opted in gets none either.
      externalFetch.mockClear()
      const dm = await metaMcpSources({
        tenantId: ids.tenant!,
        agentKey: 'dm_agent',
        server: { platform, app },
      })
      expect(dm.map((s) => s.label)).toEqual(['meta'])
      expect(dm[0]!.tools.map((t) => t.name)).toEqual(['instagram.list_dms'])
      await setMcp({})
      const notOptedIn = await metaMcpSources({
        tenantId: ids.tenant!,
        agentKey: 'meta_agent',
        server: { platform, app },
        externalFetch,
      })
      expect(notOptedIn.map((s) => s.label)).toEqual(['meta'])
      expect(externalFetch).not.toHaveBeenCalled()
      await Promise.all([...dm, ...notOptedIn].map((s) => s.close()))
    } finally {
      await platform.update(platformSettings).set({ metaMcpEnabled: false }).where(eq(platformSettings.id, 1))
    }
  })
})

describe('MCP endpoint token auth', () => {
  it('rejects missing, forged, expired and foreign tokens', async () => {
    expect((await rpc(null, listTools)).status).toBe(401)
    const good = signMcpToken({ tenantId: ids.tenant!, agentKey: 'meta_agent' })
    const [v, body] = good.split('.')
    const forged = `${v}.${Buffer.from(JSON.stringify({ t: ids.other, a: 'meta_agent', exp: Date.now() + 60_000 })).toString('base64url')}.${good.split('.')[2]}`
    expect((await rpc(forged, listTools)).status).toBe(401)
    expect((await rpc(`${v}.${body}.AAAA`, listTools)).status).toBe(401)
    const expired = signMcpToken(
      { tenantId: ids.tenant!, agentKey: 'meta_agent' },
      { now: Date.now() - 10 * 60_000 },
    )
    expect(verifyMcpToken(expired)).toBeNull()
    expect((await rpc(expired, listTools)).status).toBe(401)
    expect((await rpc(good, listTools, 'GET')).status).toBe(405)
  })

  it('lists only the agent’s tools for a valid token', async () => {
    const res = await rpc(signMcpToken({ tenantId: ids.tenant!, agentKey: 'slot_filler' }), listTools)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { result: { tools: { name: string }[] } }
    expect(json.result.tools.map((t) => t.name).sort()).toEqual([
      'whatsapp.draft_message',
      'whatsapp.read_inbox_summary',
    ])
  })

  it('keeps tenants apart: a token for another spa cannot reach this spa’s thread', async () => {
    const res = await rpc(signMcpToken({ tenantId: ids.other!, agentKey: 'meta_agent' }), {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'instagram.draft_dm_reply', arguments: { thread_id: ids.comment, text: 'hi' } },
    })
    const json = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }
    expect(json.result.isError).toBe(true)
    expect(json.result.content[0]!.text).toMatch(/not found/i)
  })
})

describe('draft vs autopilot', () => {
  const callReply = async (text: string, fetch?: typeof globalThis.fetch) => {
    const sources = await metaMcpSources({
      tenantId: ids.tenant!,
      agentKey: 'comment_agent',
      server: { platform, app, env, fetch },
      env,
    })
    const meta = sources[0]!
    try {
      return JSON.parse(await meta.call('instagram.reply_comment', { thread_id: ids.comment, text }))
    } finally {
      await meta.close()
    }
  }
  const outgoing = () =>
    withTenant(
      ids.tenant!,
      (tx) =>
        tx
          .select()
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.conversationId, ids.comment!),
              eq(conversationMessages.direction, 'out'),
            ),
          ),
      app,
    )

  it('drafts a public reply for approval when autopilot is off', async () => {
    await setMcp({ autopilot: false })
    const graph = vi.fn()
    const r = await callReply('Yes — open Friday 10:00–22:00.', graph as unknown as typeof fetch)
    expect(r.status).toBe('drafted')
    expect(graph).not.toHaveBeenCalled()
    expect((await outgoing()).map((m) => [m.sender, m.text])).toEqual([
      ['ai_draft', 'Yes — open Friday 10:00–22:00.'],
    ])
    const [log] = await platform
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, ids.tenant!), eq(auditLog.action, 'ai.mcp.instagram.reply_comment')))
    expect(log).toMatchObject({
      entity: 'conversation',
      data: expect.objectContaining({ agent: 'comment_agent', ok: true }),
    })
  })

  it('sends the reply on autopilot', async () => {
    await setMcp({ autopilot: true })
    const graph = vi.fn(async () => new Response(JSON.stringify({ id: 'reply-9' })))
    const r = await callReply('See you Friday!', graph as unknown as typeof fetch)
    expect(r.status).toBe('sent')
    expect(String(graph.mock.calls[0]![0])).toContain('/comment-1/replies')
    expect((await outgoing()).some((m) => m.sender === 'bot' && m.externalId === 'reply-9')).toBe(true)
    await setMcp({})
  })
})

describe('meta agent through the gateway', () => {
  it('drafts a post via MCP, meters every model call and audits the write', async () => {
    const before = await platform.select().from(aiUsage).where(eq(aiUsage.tenantId, ids.tenant!))
    const { client, fetch } = scriptedModel([
      toolCall('instagram__create_post_draft', { caption: 'Hot-stone Fridays: 20% off this week.' }),
      toolCall('whatsapp__draft_message', { phone: '050 123 4567', text: 'Hot-stone Fridays are back!' }),
      { role: 'assistant', content: 'Drafted the post and a WhatsApp message for you to approve.' },
    ])
    const r = await runMetaAgent({ tenantId: ids.tenant!, instruction: 'Promote hot-stone Fridays', client })
    expect(r.reply).toMatch(/Drafted/)
    expect(r.calls).toEqual([
      { name: 'instagram__create_post_draft', source: 'meta', ok: true },
      { name: 'whatsapp__draft_message', source: 'meta', ok: true },
    ])
    // The model saw MCP tools as OpenAI functions — and no WhatsApp send function.
    const sent = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    const fnNames = (sent.tools as { function: { name: string } }[]).map((t) => t.function.name)
    expect(fnNames).toContain('instagram__create_post_draft')
    expect(fnNames.some((n) => /whatsapp/.test(n) && /send/.test(n))).toBe(false)

    const usage = await platform.select().from(aiUsage).where(eq(aiUsage.tenantId, ids.tenant!))
    const added = usage.slice(before.length)
    expect(added.map((u) => u.agentKey)).toEqual(['meta_agent', 'meta_agent', 'meta_agent'])
    expect(added.every((u) => u.tokensIn === 1000 && Number(u.costUsd) > 0)).toBe(true)

    const posts = await withTenant(ids.tenant!, (tx) => tx.select().from(socialPosts), app)
    expect(posts).toEqual([
      expect.objectContaining({
        status: 'pending_approval',
        caption: 'Hot-stone Fridays: 20% off this week.',
      }),
    ])
    const queued = await withTenant(ids.tenant!, (tx) => tx.select().from(outbox), app)
    expect(queued).toEqual([
      expect.objectContaining({ status: 'queued', kind: 'custom', phoneE164: '971501234567' }),
    ])
    const actions = (await platform.select().from(auditLog).where(eq(auditLog.tenantId, ids.tenant!))).map(
      (a) => a.action,
    )
    expect(actions).toEqual(
      expect.arrayContaining(['ai.mcp.instagram.create_post_draft', 'ai.mcp.whatsapp.draft_message']),
    )
  })

  it('stops at the budget like any other agent', async () => {
    await platform.update(tenants).set({ aiBudgetUsd: '0' }).where(eq(tenants.id, ids.tenant!))
    const { client } = scriptedModel([{ role: 'assistant', content: 'x' }])
    await expect(runMetaAgent({ tenantId: ids.tenant!, instruction: 'hi', client })).rejects.toThrow(
      /budget/i,
    )
    await platform.update(tenants).set({ aiBudgetUsd: '25' }).where(eq(tenants.id, ids.tenant!))
  })
})
