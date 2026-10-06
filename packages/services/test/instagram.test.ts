import { createHmac } from 'node:crypto'
import {
  closeAllDbs,
  conversationMessages,
  conversations,
  socialAccounts,
  socialPosts,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  applyAgentOutcome,
  authorizeUrl,
  clipBytes,
  constantTimeEqual,
  decryptSecret,
  deliverReply,
  dmWindowLeftMs,
  dmWindowOpen,
  encryptSecret,
  getThread,
  ingestInstagramWebhook,
  listInbox,
  markConversationRead,
  metaConfig,
  metaSignature,
  parseInstagramWebhook,
  parseSignedRequest,
  publicImageUrl,
  publishDueInstagramPosts,
  publishInstagramPost,
  refreshInstagramTokens,
  scrubSecrets,
  signState,
  verifyMetaSignature,
  verifyState,
} from '../src'

process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret'
const { platform, app } = testDbs()
const env = { META_APP_ID: 'app-1', META_APP_SECRET: 'shh-secret', META_WEBHOOK_VERIFY_TOKEN: 'verify-me' }
const base = { platform, app, env }
const IG = '17841400000000001'
const CUSTOMER = '6543210987654321'
const ids = {} as Record<string, string>
const t0 = new Date('2026-10-06T08:00:00Z')

const dm = (mid: string, text: string, at = t0) => ({
  object: 'instagram',
  entry: [
    {
      id: IG,
      time: Math.floor(at.getTime() / 1000),
      messaging: [
        {
          sender: { id: CUSTOMER },
          recipient: { id: IG },
          timestamp: at.getTime(),
          message: { mid, text },
        },
      ],
    },
  ],
})
const comment = (id: string, text: string, from = { id: '777', username: 'layla.dxb' }) => ({
  object: 'instagram',
  entry: [
    {
      id: IG,
      time: Math.floor(t0.getTime() / 1000),
      changes: [
        {
          field: 'comments',
          value: { id, text, from, media: { id: 'media-1', media_product_type: 'FEED' } },
        },
      ],
    },
  ],
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
type Call = { url: string; init?: RequestInit }
const fakeFetch = (route: (url: string, init?: RequestInit) => Response) => {
  const calls: Call[] = []
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return route(url, init)
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

beforeAll(async () => {
  await resetTestDatabase()
  const [a] = await platform.insert(tenants).values({ slug: 'ig-a', name: 'Serenity' }).returning()
  const [b] = await platform.insert(tenants).values({ slug: 'ig-b', name: 'Other' }).returning()
  ids.a = a!.id
  ids.b = b!.id
  await platform.insert(socialAccounts).values({
    tenantId: ids.a,
    platform: 'instagram',
    externalId: IG,
    username: 'serenity.spa',
    tokenEnc: encryptSecret('IGAAtoken-original'),
    tokenExpiresAt: new Date(t0.getTime() + 50 * 86_400_000),
    meta: { igUserId: IG, tokenIssuedAt: new Date(t0.getTime() - 10 * 86_400_000).toISOString() },
  })
})
afterAll(closeAllDbs)

describe('meta helpers', () => {
  it('reads config only when all env vars are set', () => {
    expect(metaConfig(env)).toEqual({ appId: 'app-1', appSecret: 'shh-secret', verifyToken: 'verify-me' })
    expect(metaConfig({ ...env, META_APP_SECRET: ' ' })).toBeNull()
    expect(metaConfig({})).toBeNull()
  })

  it('verifies X-Hub-Signature-256 (good / bad / missing)', () => {
    const body = JSON.stringify(dm('m1', 'hi'))
    const good = metaSignature(body, 'shh-secret')
    expect(verifyMetaSignature(body, good, 'shh-secret')).toBe(true)
    expect(verifyMetaSignature(body, good.toUpperCase().replace('SHA256', 'sha256'), 'shh-secret')).toBe(true)
    expect(verifyMetaSignature(`${body} `, good, 'shh-secret')).toBe(false)
    expect(verifyMetaSignature(body, metaSignature(body, 'other'), 'shh-secret')).toBe(false)
    expect(verifyMetaSignature(body, null, 'shh-secret')).toBe(false)
    expect(verifyMetaSignature(body, 'sha256=xyz', 'shh-secret')).toBe(false)
    expect(verifyMetaSignature(body, good, '')).toBe(false)
  })

  it('signs OAuth state and rejects tampering, other secrets and expiry', () => {
    const now = t0.getTime()
    const state = signState({ tenantId: 't-1', userId: 'u-1', nonce: 'n-1' }, 'secret', now)
    expect(verifyState(state, 'secret', now + 60_000)).toMatchObject({ t: 't-1', u: 'u-1', n: 'n-1' })
    expect(verifyState(state, 'other', now)).toBeNull()
    expect(verifyState(state, 'secret', now + 11 * 60_000)).toBeNull()
    const [payload, sig] = state.split('.')
    const forged = Buffer.from(JSON.stringify({ t: 't-2', u: 'u-1', n: 'n-1', exp: now + 1e6 })).toString(
      'base64url',
    )
    expect(verifyState(`${forged}.${sig}`, 'secret', now)).toBeNull()
    expect(verifyState(`${payload}.`, 'secret', now)).toBeNull()
    expect(verifyState('garbage', 'secret', now)).toBeNull()
    expect(verifyState(null, 'secret', now)).toBeNull()
  })

  it('builds the Instagram Login authorize URL', () => {
    const url = new URL(authorizeUrl({ appId: 'app-1', redirectUri: 'https://x.test/cb', state: 's' }))
    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize')
    expect(url.searchParams.get('scope')).toBe(
      'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish',
    )
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe('https://x.test/cb')
  })

  it('parses DMs and comments, skipping echoes, reads and own replies', () => {
    const events = parseInstagramWebhook({
      object: 'instagram',
      entry: [
        {
          id: IG,
          time: 1_780_000_000,
          messaging: [
            {
              sender: { id: CUSTOMER },
              recipient: { id: IG },
              timestamp: 1_780_000_000_123,
              message: { mid: 'a', text: ' Hello ' },
            },
            {
              sender: { id: IG },
              recipient: { id: CUSTOMER },
              message: { mid: 'b', text: 'x', is_echo: true },
            },
            { sender: { id: CUSTOMER }, recipient: { id: IG }, read: { mid: 'a' } },
            {
              sender: { id: CUSTOMER },
              recipient: { id: IG },
              message: { mid: 'c', attachments: [{ type: 'image', payload: { url: 'https://x' } }] },
            },
            { sender: { id: CUSTOMER }, recipient: { id: IG }, message: { mid: 'd', is_deleted: true } },
          ],
          changes: [
            { field: 'comments', value: { id: 'c1', text: 'Lovely!', from: { id: '9', username: 'sara' } } },
            {
              field: 'comments',
              value: { id: 'c2', text: 'Thanks', from: { id: IG, username: 'serenity' } },
            },
            { field: 'mentions', value: { media_id: 'x' } },
          ],
        },
      ],
    })
    expect(events).toHaveLength(3)
    expect(events[0]).toMatchObject({
      kind: 'dm',
      accountId: IG,
      senderId: CUSTOMER,
      mid: 'a',
      text: 'Hello',
    })
    expect((events[0] as { at: Date }).at.getTime()).toBe(1_780_000_000_123)
    expect(events[1]).toMatchObject({ kind: 'dm', mid: 'c', text: '[image]' })
    expect(events[2]).toMatchObject({
      kind: 'comment',
      commentId: 'c1',
      fromUsername: 'sara',
      text: 'Lovely!',
    })
    expect(parseInstagramWebhook({ object: 'page', entry: [] })).toEqual([])
    expect(parseInstagramWebhook('nonsense')).toEqual([])
    expect(parseInstagramWebhook({ entry: [null, 1, { messaging: 'x' }] })).toEqual([])
  })

  it('verifies Meta signed_request payloads', () => {
    const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: IG })).toString(
      'base64url',
    )
    const sig = createHmac('sha256', 'shh-secret').update(payload).digest('base64url')
    expect(parseSignedRequest(`${sig}.${payload}`, 'shh-secret')).toMatchObject({ user_id: IG })
    expect(parseSignedRequest(`${sig}.${payload}`, 'nope')).toBeNull()
    expect(parseSignedRequest('x', 'shh-secret')).toBeNull()
  })

  it('enforces the 24-hour window and DM byte limit', () => {
    expect(dmWindowOpen(t0, new Date(t0.getTime() + 23 * 3600_000))).toBe(true)
    expect(dmWindowOpen(t0, new Date(t0.getTime() + 24 * 3600_000))).toBe(false)
    expect(dmWindowOpen(null, t0)).toBe(false)
    expect(dmWindowLeftMs(t0, new Date(t0.getTime() + 3600_000))).toBe(23 * 3600_000)
    const arabic = 'مرحبا '.repeat(200)
    expect(new TextEncoder().encode(clipBytes(arabic)).length).toBeLessThanOrEqual(1000)
  })

  it('scrubs tokens, compares in constant time and only accepts https images', () => {
    expect(scrubSecrets('bad access_token=IGAAabc123 in url')).not.toContain('IGAAabc123')
    expect(scrubSecrets('token IGQVJabcdefghijklmnopqrstuvwxyz0123 leaked')).toContain('[redacted]')
    expect(constantTimeEqual('a', 'a')).toBe(true)
    expect(constantTimeEqual('a', 'b')).toBe(false)
    expect(constantTimeEqual(null, 'b')).toBe(false)
    expect(publicImageUrl('https://cdn.test/a.jpg')).toBe('https://cdn.test/a.jpg')
    expect(publicImageUrl('http://cdn.test/a.jpg')).toBeNull()
    expect(publicImageUrl('/api/media/x.jpg', 'https://app.spa.test')).toBe(
      'https://app.spa.test/api/media/x.jpg',
    )
    expect(publicImageUrl('/api/media/x.jpg', 'http://app.localhost:3000')).toBeNull()
    expect(publicImageUrl(undefined)).toBeNull()
  })
})

describe('ingest and replies', () => {
  it('stores DMs once per Meta id, for the owning spa only', async () => {
    const first = await ingestInstagramWebhook(dm('mid-1', 'How much is a 60 minute massage?'), base)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ tenantId: ids.a, channel: 'instagram_dm' })
    ids.conv = first[0]!.conversationId
    expect(await ingestInstagramWebhook(dm('mid-1', 'How much is a 60 minute massage?'), base)).toHaveLength(
      0,
    )
    const msgs = await withTenant(ids.a!, (tx) => tx.select().from(conversationMessages), app)
    expect(msgs).toHaveLength(1)
    expect(await withTenant(ids.b!, (tx) => tx.select().from(conversations), app)).toHaveLength(0)
    const [conv] = await withTenant(ids.a!, (tx) => tx.select().from(conversations), app)
    expect(conv).toMatchObject({ channel: 'instagram_dm', externalThreadId: CUSTOMER, mode: 'bot' })
    expect(conv!.lastCustomerMsgAt?.getTime()).toBe(t0.getTime())
    const other = { ...dm('mid-x', 'hi'), entry: [{ ...dm('mid-x', 'hi').entry[0]!, id: '1' }] }
    other.entry[0]!.messaging[0]!.recipient.id = '1'
    expect(await ingestInstagramWebhook(other, base)).toHaveLength(0)
  })

  it('stores comments as their own threads with the commenter username', async () => {
    const items = await ingestInstagramWebhook(comment('c-1', 'Do you do couples massage?'), base)
    expect(items).toHaveLength(1)
    const thread = await withTenant(ids.a!, (tx) => getThread(tx, items[0]!.conversationId), app)
    expect(thread?.conversation).toMatchObject({ channel: 'instagram_comment', participant: '@layla.dxb' })
    ids.comment = items[0]!.conversationId
  })

  it('sends a DM inside the window and records the Meta message id', async () => {
    const f = fakeFetch(() => json({ recipient_id: CUSTOMER, message_id: 'out-1' }))
    const r = await deliverReply(ids.a!, ids.conv!, 'A 60 minute massage is AED 350.', {
      ...base,
      sender: 'staff',
      fetch: f.fetch,
      now: new Date(t0.getTime() + 3600_000),
    })
    expect(r.ok).toBe(true)
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]!.url).toBe(`https://graph.instagram.com/v21.0/${IG}/messages`)
    expect(new Headers(f.calls[0]!.init?.headers).get('authorization')).toBe('Bearer IGAAtoken-original')
    expect(JSON.parse(String(f.calls[0]!.init?.body))).toEqual({
      recipient: { id: CUSTOMER },
      message: { text: 'A 60 minute massage is AED 350.' },
    })
    const [row] = await withTenant(
      ids.a!,
      (tx) => tx.select().from(conversationMessages).where(eq(conversationMessages.id, r.messageId)),
      app,
    )
    expect(row).toMatchObject({ direction: 'out', sender: 'staff', externalId: 'out-1', error: null })
  })

  it('never sends after 24 hours, without configuration, or on API errors — and never throws', async () => {
    const f = fakeFetch(() => json({ message_id: 'never' }))
    const late = await deliverReply(ids.a!, ids.conv!, 'Hello again', {
      ...base,
      sender: 'staff',
      fetch: f.fetch,
      now: new Date(t0.getTime() + 25 * 3600_000),
    })
    expect(late).toMatchObject({ ok: false, error: expect.stringMatching(/24 hours/) })
    const sandbox = await deliverReply(ids.a!, ids.conv!, 'Hello', {
      ...base,
      env: {},
      sender: 'staff',
      fetch: f.fetch,
    })
    expect(sandbox).toMatchObject({ ok: false, error: expect.stringMatching(/isn't set up/) })
    expect(f.calls).toHaveLength(0)

    const bad = fakeFetch(() =>
      json({ error: { message: 'Invalid OAuth access_token=IGAAtoken-original', code: 190 } }, 400),
    )
    const failed = await deliverReply(ids.a!, ids.comment!, 'Yes we do!', {
      ...base,
      sender: 'staff',
      fetch: bad.fetch,
    })
    expect(failed.ok).toBe(false)
    expect(bad.calls[0]!.url).toBe('https://graph.instagram.com/v21.0/c-1/replies')
    if (!failed.ok) expect(failed.error).not.toContain('IGAAtoken')
    const [acct] = await withTenant(ids.a!, (tx) => tx.select().from(socialAccounts), app)
    expect(acct!.status).toBe('expired')
    await withTenant(ids.a!, (tx) => tx.update(socialAccounts).set({ status: 'connected' }), app)

    const offline = fakeFetch(() => {
      throw new TypeError('fetch failed')
    })
    const down = await deliverReply(ids.a!, ids.comment!, 'Yes!', {
      ...base,
      sender: 'staff',
      fetch: offline.fetch,
    })
    expect(down).toMatchObject({ ok: false, error: expect.stringMatching(/Could not reach Instagram/) })
  })

  it('keeps one AI draft per thread in approve mode; autopilot falls back to a draft when it cannot send', async () => {
    await applyAgentOutcome(ids.a!, ids.conv!, { reply: 'First draft' }, 'approve', base)
    await applyAgentOutcome(
      ids.a!,
      ids.conv!,
      { reply: 'Second draft', handoff: 'complaint' },
      'approve',
      base,
    )
    let thread = await withTenant(ids.a!, (tx) => getThread(tx, ids.conv!), app)
    const drafts = thread!.messages.filter((m) => m.sender === 'ai_draft')
    expect(drafts.map((d) => d.text)).toEqual(['Second draft'])
    expect(thread!.conversation.mode).toBe('human')

    await withTenant(ids.a!, (tx) => tx.update(conversations).set({ mode: 'bot' }), app)
    const f = fakeFetch(() => json({ message_id: 'never' }))
    const r = await applyAgentOutcome(
      ids.a!,
      ids.conv!,
      { reply: 'Auto reply', flagged: 'rude' },
      'autopilot',
      {
        ...base,
        fetch: f.fetch,
        now: new Date(t0.getTime() + 30 * 3600_000),
      },
    )
    expect(r).toBe('drafted')
    expect(f.calls).toHaveLength(0)
    thread = await withTenant(ids.a!, (tx) => getThread(tx, ids.conv!), app)
    const draft = thread!.messages.find((m) => m.sender === 'ai_draft')
    expect(draft).toMatchObject({ text: 'Auto reply', error: expect.stringMatching(/24 hours/) })
    expect(thread!.conversation.flagged).toBe(true)
  })

  it('lists conversations with unread state and drafts', async () => {
    let list = await withTenant(ids.a!, (tx) => listInbox(tx, 'all'), app)
    expect(list).toHaveLength(2)
    const row = list.find((c) => c.id === ids.conv)!
    expect(row).toMatchObject({ unread: true, hasDraft: true, flagged: true })
    await withTenant(
      ids.a!,
      (tx) => markConversationRead(tx, ids.conv!, new Date(t0.getTime() + 60_000)),
      app,
    )
    list = await withTenant(ids.a!, (tx) => listInbox(tx, 'flagged'), app)
    expect(list.map((c) => [c.id, c.unread])).toEqual([[ids.conv, false]])
    expect(await withTenant(ids.b!, (tx) => listInbox(tx, 'all'), app)).toEqual([])
  })
})

describe('publishing and tokens', () => {
  const graph = () =>
    fakeFetch((url) => {
      if (url.endsWith('/media')) return json({ id: 'container-1' })
      if (url.includes('container-1?fields=status_code')) return json({ status_code: 'FINISHED' })
      if (url.endsWith('/media_publish')) return json({ id: 'ig-media-1' })
      return json({ error: { message: 'unexpected' } }, 404)
    })

  it('blocks non-https images and publishes approved posts', async () => {
    const [httpPost] = await platform
      .insert(socialPosts)
      .values({
        tenantId: ids.a!,
        platform: 'instagram',
        caption: 'Calm',
        status: 'scheduled',
        media: [{ url: 'http://insecure.test/a.jpg' }],
      })
      .returning()
    const f = graph()
    const blocked = await publishInstagramPost(ids.a!, httpPost!.id, { ...base, fetch: f.fetch })
    expect(blocked).toMatchObject({ ok: false, error: expect.stringMatching(/https/) })
    expect(f.calls).toHaveLength(0)

    const [post] = await platform
      .insert(socialPosts)
      .values({
        tenantId: ids.a!,
        platform: 'instagram',
        caption: 'Weekday calm ✨',
        status: 'scheduled',
        media: [{ url: 'https://cdn.test/post.jpg' }],
      })
      .returning()
    const r = await publishInstagramPost(ids.a!, post!.id, { ...base, fetch: f.fetch, sleep: async () => {} })
    expect(r).toEqual({ ok: true, externalId: 'ig-media-1' })
    expect(JSON.parse(String(f.calls[0]!.init?.body))).toEqual({
      image_url: 'https://cdn.test/post.jpg',
      caption: 'Weekday calm ✨',
    })
    const [row] = await platform.select().from(socialPosts).where(eq(socialPosts.id, post!.id))
    expect(row).toMatchObject({ status: 'published', externalId: 'ig-media-1', error: null })
    expect(await publishInstagramPost(ids.a!, post!.id, { ...base, fetch: f.fetch })).toMatchObject({
      ok: false,
    })
  })

  it('marks API failures as failed and publishes due scheduled posts from the job', async () => {
    const [due] = await platform
      .insert(socialPosts)
      .values({
        tenantId: ids.a!,
        platform: 'instagram',
        caption: 'Due now',
        status: 'scheduled',
        scheduledAt: new Date(t0.getTime() - 60_000),
        media: [{ url: 'https://cdn.test/due.jpg' }],
      })
      .returning()
    await platform.insert(socialPosts).values({
      tenantId: ids.a!,
      platform: 'instagram',
      caption: 'Later',
      status: 'scheduled',
      scheduledAt: new Date(t0.getTime() + 86_400_000),
      media: [{ url: 'https://cdn.test/later.jpg' }],
    })
    const failing = fakeFetch(() =>
      json({ error: { message: 'Only photo or video can be accepted', code: 9004 } }, 400),
    )
    const job = await publishDueInstagramPosts({
      ...base,
      now: t0,
      fetch: failing.fetch,
      sleep: async () => {},
    })
    // the earlier http:// post is still "scheduled" without a date → not due; the due one fails
    expect(job).toMatchObject({ attempted: 1, failed: 1 })
    const [row] = await platform.select().from(socialPosts).where(eq(socialPosts.id, due!.id))
    expect(row).toMatchObject({ status: 'failed', error: expect.stringMatching(/Only photo/) })
    expect(await publishDueInstagramPosts({ ...base, env: {}, now: t0 })).toMatchObject({ attempted: 0 })
  })

  it('refreshes tokens older than 7 days and leaves fresh ones alone', async () => {
    const f = fakeFetch((url) =>
      url.startsWith('https://graph.instagram.com/refresh_access_token')
        ? json({ access_token: 'IGAAtoken-refreshed', token_type: 'bearer', expires_in: 5_184_000 })
        : json({ error: { message: 'unexpected' } }, 404),
    )
    expect(await refreshInstagramTokens({ ...base, fetch: f.fetch, now: t0 })).toMatchObject({ refreshed: 1 })
    expect(f.calls[0]!.url).toContain('grant_type=ig_refresh_token')
    const [acct] = await platform.select().from(socialAccounts).where(eq(socialAccounts.tenantId, ids.a!))
    expect(decryptSecret(acct!.tokenEnc!)).toBe('IGAAtoken-refreshed')
    expect(acct!.meta.tokenIssuedAt).toBe(t0.toISOString())
    expect(await refreshInstagramTokens({ ...base, fetch: f.fetch, now: t0 })).toMatchObject({ refreshed: 0 })
    expect(f.calls).toHaveLength(1)
  })
})
