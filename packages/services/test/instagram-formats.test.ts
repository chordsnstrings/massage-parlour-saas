// F18 (reels / stories / carousels, private replies) + F19 (Facebook Page via Facebook Login for Business).
// Every Graph call goes through a fixture fetch.
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
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  checkFacebookPageTokens,
  chooseFacebookPage,
  DomainError,
  disconnectFacebook,
  encryptSecret,
  FACEBOOK_SCOPES,
  facebookAuthorizeUrl,
  facebookLoginClient,
  facebookView,
  forgetInstagramUser,
  getFacebookAccount,
  getInstagramSender,
  ingestInstagramWebhook,
  instagramPublishPlan,
  PROCESSING_NOTE,
  pendingFacebookToken,
  privateReplyState,
  publishDueInstagramPosts,
  publishInstagramPost,
  saveFacebookLogin,
  sendPrivateReply,
} from '../src'

process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret'
const { platform, app } = testDbs()
const env = { META_APP_ID: 'app-1', META_APP_SECRET: 'shh-secret', META_WEBHOOK_VERIFY_TOKEN: 'verify-me' }
const base = { platform, app, env, sleep: async () => {} }
const IG = '17841400000000077'
const IG_FB = '17841400000000088'
const PAGE = '1029384756'
const t0 = new Date('2026-10-08T08:00:00Z')
const ids = {} as Record<string, string>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
type Call = { url: string; body: unknown; method: string }
const fakeFetch = (route: (url: string, body: Record<string, unknown>, method: string) => Response) => {
  const calls: Call[] = []
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const method = init?.method ?? 'GET'
    calls.push({ url, body, method })
    return route(url, body, method)
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}
const post = async (tenantId: string, values: Partial<typeof socialPosts.$inferInsert>) =>
  (
    await platform
      .insert(socialPosts)
      .values({ tenantId, platform: 'instagram', caption: 'Calm ✨', status: 'scheduled', ...values })
      .returning()
  )[0]!
const postRow = async (id: string) =>
  (await platform.select().from(socialPosts).where(eq(socialPosts.id, id)))[0]!

beforeAll(async () => {
  await resetTestDatabase()
  const [a] = await platform.insert(tenants).values({ slug: 'f18-a', name: 'Serenity' }).returning()
  const [b] = await platform.insert(tenants).values({ slug: 'f18-b', name: 'Facebook only' }).returning()
  ids.a = a!.id
  ids.b = b!.id
  await platform.insert(socialAccounts).values({
    tenantId: ids.a,
    platform: 'instagram',
    externalId: IG,
    username: 'serenity.spa',
    tokenEnc: encryptSecret('IGAAtoken-a'),
    tokenExpiresAt: new Date(t0.getTime() + 50 * 86_400_000),
    meta: { igUserId: IG },
  })
})
afterAll(closeAllDbs)

describe('publish plans', () => {
  const plan = (type: string, media: { url: string; type?: 'image' | 'video' }[]) =>
    instagramPublishPlan({ type, caption: 'Hi', media }, 'https://app.test')
  it('maps each format to its containers and explains what is missing', () => {
    expect(plan('feed', [{ url: 'https://cdn.test/a.jpg' }])).toEqual({
      ok: true,
      plan: { children: [], main: { image_url: 'https://cdn.test/a.jpg', caption: 'Hi' }, video: false },
    })
    expect(
      plan('reel', [{ url: 'https://cdn.test/r.mp4' }, { url: 'https://cdn.test/cover.jpg' }]),
    ).toMatchObject({
      ok: true,
      plan: {
        main: {
          media_type: 'REELS',
          video_url: 'https://cdn.test/r.mp4',
          share_to_feed: true,
          cover_url: 'https://cdn.test/cover.jpg',
        },
        video: true,
      },
    })
    expect(plan('story', [{ url: 'https://cdn.test/s', type: 'video' }])).toMatchObject({
      ok: true,
      plan: { main: { media_type: 'STORIES', video_url: 'https://cdn.test/s' } },
    })
    expect(
      (plan('story', [{ url: 'https://cdn.test/s.jpg' }]) as { plan: { main: object } }).plan.main,
    ).toEqual({
      media_type: 'STORIES',
      image_url: 'https://cdn.test/s.jpg',
    })
    expect(plan('reel', [{ url: 'https://cdn.test/a.jpg' }])).toEqual({ ok: false, problem: 'needs_video' })
    expect(plan('feed', [{ url: 'https://cdn.test/v.mp4' }])).toEqual({ ok: false, problem: 'needs_image' })
    expect(plan('carousel', [{ url: 'https://cdn.test/a.jpg' }])).toEqual({
      ok: false,
      problem: 'carousel_count',
    })
    expect(plan('carousel', [{ url: 'https://cdn.test/a.jpg' }, { url: 'http://x.test/b.jpg' }])).toEqual({
      ok: false,
      problem: 'not_https',
    })
    expect(plan('feed', [])).toEqual({ ok: false, problem: 'no_media' })
    expect(plan('poll', [{ url: 'https://cdn.test/a.jpg' }])).toEqual({ ok: false, problem: 'unknown_type' })
  })
})

describe('publishing reels, stories and carousels', () => {
  it('parks a reel while Instagram processes it, then the job publishes the same container', async () => {
    const p = await post(ids.a!, {
      type: 'reel',
      media: [{ url: 'https://cdn.test/reel.mp4', type: 'video' }],
    })
    let status = 'IN_PROGRESS'
    const f = fakeFetch((url) => {
      if (url.endsWith(`/${IG}/media`)) return json({ id: 'reel-c1' })
      if (url.includes('reel-c1?fields=status_code')) return json({ status_code: status })
      if (url.endsWith('/media_publish')) return json({ id: 'ig-reel-1' })
      return json({ error: { message: 'unexpected' } }, 404)
    })
    const r = await publishInstagramPost(ids.a!, p.id, { ...base, fetch: f.fetch, now: t0, maxPolls: 2 })
    expect(r).toEqual({ ok: false, error: PROCESSING_NOTE, processing: true })
    expect(f.calls[0]!.url).toBe(`https://graph.instagram.com/v21.0/${IG}/media`)
    expect(f.calls[0]!.body).toEqual({
      media_type: 'REELS',
      video_url: 'https://cdn.test/reel.mp4',
      caption: 'Calm ✨',
      share_to_feed: true,
    })
    expect(await postRow(p.id)).toMatchObject({
      status: 'scheduled',
      error: PROCESSING_NOTE,
      meta: { containerId: 'reel-c1', containerAt: t0.toISOString() },
    })

    status = 'FINISHED'
    const later = new Date(t0.getTime() + 5 * 60_000)
    const job = await publishDueInstagramPosts({ ...base, fetch: f.fetch, now: later })
    expect(job).toMatchObject({ attempted: 1, published: 1 })
    // Resumed: no second container was created.
    expect(f.calls.filter((c) => c.url.endsWith(`/${IG}/media`))).toHaveLength(1)
    expect(await postRow(p.id)).toMatchObject({ status: 'published', externalId: 'ig-reel-1', meta: {} })
  })

  it('publishes a carousel (children first, then the parent) and a story without a caption', async () => {
    const p = await post(ids.a!, {
      type: 'carousel',
      media: [{ url: 'https://cdn.test/1.jpg' }, { url: 'https://cdn.test/2.mp4', type: 'video' }],
    })
    let n = 0
    const f = fakeFetch((url) => {
      if (url.endsWith(`/${IG}/media`)) return json({ id: `c${++n}` })
      if (url.includes('?fields=status_code')) return json({ status_code: 'FINISHED' })
      if (url.endsWith('/media_publish')) return json({ id: 'ig-carousel-1' })
      return json({ error: { message: 'unexpected' } }, 404)
    })
    expect(await publishInstagramPost(ids.a!, p.id, { ...base, fetch: f.fetch, now: t0 })).toEqual({
      ok: true,
      externalId: 'ig-carousel-1',
    })
    const creates = f.calls.filter((c) => c.url.endsWith(`/${IG}/media`)).map((c) => c.body)
    expect(creates.slice(0, 2)).toEqual(
      expect.arrayContaining([
        { image_url: 'https://cdn.test/1.jpg', is_carousel_item: true },
        { media_type: 'VIDEO', video_url: 'https://cdn.test/2.mp4', is_carousel_item: true },
      ]),
    )
    expect(creates[2]).toMatchObject({ media_type: 'CAROUSEL', caption: 'Calm ✨' })
    expect(String(creates[2]!.children).split(',').sort()).toEqual(['c1', 'c2'])

    const s = await post(ids.a!, { type: 'story', media: [{ url: 'https://cdn.test/story.jpg' }] })
    const g = fakeFetch((url) => {
      if (url.endsWith(`/${IG}/media`)) return json({ id: 'st1' })
      if (url.includes('?fields=status_code')) return json({ status_code: 'FINISHED' })
      if (url.endsWith('/media_publish')) return json({ id: 'ig-story-1' })
      return json({}, 404)
    })
    expect(await publishInstagramPost(ids.a!, s.id, { ...base, fetch: g.fetch, now: t0 })).toMatchObject({
      ok: true,
    })
    expect(g.calls[0]!.body).toEqual({ media_type: 'STORIES', image_url: 'https://cdn.test/story.jpg' })
  })

  it('fails a video Instagram could not process and clears the container', async () => {
    const p = await post(ids.a!, { type: 'reel', media: [{ url: 'https://cdn.test/bad.mp4' }] })
    const f = fakeFetch((url) => {
      if (url.endsWith(`/${IG}/media`)) return json({ id: 'bad-c' })
      if (url.includes('?fields=status_code')) return json({ status_code: 'ERROR' })
      return json({}, 404)
    })
    const r = await publishInstagramPost(ids.a!, p.id, { ...base, fetch: f.fetch, now: t0 })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/could not process the video/) })
    expect(await postRow(p.id)).toMatchObject({ status: 'failed', meta: {} })
  })
})

describe('private replies', () => {
  const comment = (id: string, at: Date) => ({
    object: 'instagram',
    entry: [
      {
        id: IG,
        time: Math.floor(at.getTime() / 1000),
        changes: [
          {
            field: 'comments',
            value: { id, text: 'How much is a hot stone massage?', from: { id: '42', username: 'layla' } },
          },
        ],
      },
    ],
  })
  const convOf = async (commentId: string) =>
    (
      await platform
        .select()
        .from(conversations)
        .where(and(eq(conversations.tenantId, ids.a!), eq(conversations.externalThreadId, commentId)))
    )[0]!

  it('sends one private DM per comment within 7 days, kept in the comment thread', async () => {
    await ingestInstagramWebhook(comment('cm-1', t0), { ...base, now: t0 })
    const conv = await convOf('cm-1')
    const f = fakeFetch((url) =>
      url.endsWith(`/${IG}/messages`) ? json({ recipient_id: '5550001', message_id: 'pm-1' }) : json({}, 404),
    )
    const now = new Date(t0.getTime() + 86_400_000)
    expect(
      await sendPrivateReply(ids.a!, conv.id, 'Hi Layla! Hot stone is AED 350.', {
        ...base,
        fetch: f.fetch,
        now,
      }),
    ).toMatchObject({ ok: true })
    expect(f.calls[0]!.body).toEqual({
      recipient: { comment_id: 'cm-1' },
      message: { text: 'Hi Layla! Hot stone is AED 350.' },
    })
    const msgs = await withTenant(
      ids.a!,
      (tx) => tx.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conv.id)),
      app,
    )
    const pr = msgs.find((m) => m.kind === 'private_reply')!
    expect(pr).toMatchObject({ direction: 'out', sender: 'staff', error: null, externalId: 'pm-1' })
    expect(privateReplyState(conv, msgs, now)).toMatchObject({ status: 'sent' })
    await expect(
      sendPrivateReply(ids.a!, conv.id, 'Again', { ...base, fetch: f.fetch, now }),
    ).rejects.toThrow(/already sent/)
    expect(f.calls).toHaveLength(1)
  })

  it('refuses after 7 days and keeps nothing when Instagram rejects the reply', async () => {
    await ingestInstagramWebhook(comment('cm-2', t0), { ...base, now: t0 })
    const conv = await convOf('cm-2')
    const late = new Date(t0.getTime() + 8 * 86_400_000)
    await expect(sendPrivateReply(ids.a!, conv.id, 'Hi', { ...base, now: late })).rejects.toBeInstanceOf(
      DomainError,
    )
    const f = fakeFetch(() =>
      json({ error: { message: 'This message is sent outside of allowed window.', code: 10 } }, 400),
    )
    const r = await sendPrivateReply(ids.a!, conv.id, 'Hi', { ...base, fetch: f.fetch, now: t0 })
    expect(r).toEqual({ ok: false, error: 'Instagram said: This message is sent outside of allowed window.' })
    const rows = await withTenant(
      ids.a!,
      (tx) =>
        tx
          .select()
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.conversationId, conv.id),
              eq(conversationMessages.kind, 'private_reply'),
            ),
          ),
      app,
    )
    expect(rows).toEqual([])
  })
})

describe('Facebook Page (Facebook Login for Business)', () => {
  it('builds the login URL with a configuration id or the scope list', () => {
    const withConfig = new URL(
      facebookAuthorizeUrl({ appId: 'app-1', redirectUri: 'https://app.x/cb', state: 's', configId: '987' }),
    )
    expect(withConfig.origin + withConfig.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth')
    expect(withConfig.searchParams.get('config_id')).toBe('987')
    expect(withConfig.searchParams.get('scope')).toBeNull()
    const scoped = new URL(
      facebookAuthorizeUrl({ appId: 'app-1', redirectUri: 'https://app.x/cb', state: 's' }),
    )
    expect(scoped.searchParams.get('scope')).toBe(FACEBOOK_SCOPES.join(','))
  })

  it('lists Pages with their linked Instagram account and reads token expiry', async () => {
    const f = fakeFetch((url) => {
      if (url.includes('/me/accounts'))
        return json({
          data: [
            {
              id: PAGE,
              name: 'Serenity Spa',
              access_token: 'EAApage',
              tasks: ['MANAGE'],
              instagram_business_account: { id: IG_FB, username: 'serenity.fb' },
            },
            { id: '555', name: 'Other page', access_token: 'EAAother' },
          ],
        })
      if (url.includes('/debug_token'))
        return json({
          data: {
            is_valid: true,
            expires_at: 0,
            data_access_expires_at: 1_800_000_000,
            scopes: ['pages_show_list'],
          },
        })
      return json({}, 404)
    })
    const fb = facebookLoginClient(f.fetch)
    const pages = await fb.pages('EAAuser')
    expect(pages).toEqual([
      {
        id: PAGE,
        name: 'Serenity Spa',
        accessToken: 'EAApage',
        tasks: ['MANAGE'],
        instagram: { id: IG_FB, username: 'serenity.fb', profilePictureUrl: undefined },
      },
      { id: '555', name: 'Other page', accessToken: 'EAAother', tasks: [], instagram: null },
    ])
    const info = await fb.debugToken({ appId: 'app-1', appSecret: 'shh', token: 'EAApage' })
    expect(info).toEqual({
      isValid: true,
      expiresAt: null,
      dataAccessExpiresAt: new Date(1_800_000_000_000),
      scopes: ['pages_show_list'],
    })
    expect(f.calls[1]!.url).toContain('input_token=EAApage')
  })

  it('pending login → chosen Page; the linked Instagram account then publishes and receives webhooks via the Page', async () => {
    await withTenant(
      ids.b!,
      (tx) =>
        saveFacebookLogin(tx, ids.b!, { fbUserId: 'fbu-1', userToken: 'EAAuser', expiresIn: 5_184_000 }, t0),
      app,
    )
    const pending = await withTenant(ids.b!, (tx) => pendingFacebookToken(tx), app)
    expect(pending?.token).toBe('EAAuser')
    expect(facebookView(await withTenant(ids.b!, (tx) => getFacebookAccount(tx), app))?.status).toBe(
      'pending_page',
    )

    await withTenant(
      ids.b!,
      (tx) =>
        chooseFacebookPage(
          tx,
          ids.b!,
          {
            page: {
              id: PAGE,
              name: 'Serenity Spa',
              accessToken: 'EAApage',
              tasks: [],
              instagram: { id: IG_FB, username: 'serenity.fb' },
            },
            info: {
              isValid: true,
              expiresAt: null,
              dataAccessExpiresAt: new Date(t0.getTime() + 10 * 86_400_000),
              scopes: [],
            },
            fbUserId: 'fbu-1',
            webhooks: 'subscribed',
          },
          t0,
        ),
      app,
    )
    const view = facebookView(await withTenant(ids.b!, (tx) => getFacebookAccount(tx), app), t0)
    expect(view).toMatchObject({
      status: 'connected',
      pageId: PAGE,
      pageName: 'Serenity Spa',
      igUsername: 'serenity.fb',
    })
    // Data access ends in 10 days: the card warns.
    expect(view?.expiresSoon).toEqual(new Date(t0.getTime() + 10 * 86_400_000))
    expect(await withTenant(ids.b!, (tx) => pendingFacebookToken(tx), app)).toBeNull()

    const sender = await withTenant(ids.b!, (tx) => getInstagramSender(tx), app)
    expect(sender).toMatchObject({ via: 'facebook', igUserId: IG_FB, token: 'EAApage' })
    const p = await post(ids.b!, { media: [{ url: 'https://cdn.test/fb.jpg' }] })
    const f = fakeFetch((url) => {
      if (url.endsWith(`/${IG_FB}/media`)) return json({ id: 'fbc1' })
      if (url.includes('?fields=status_code')) return json({ status_code: 'FINISHED' })
      if (url.endsWith('/media_publish')) return json({ id: 'ig-fb-1' })
      return json({}, 404)
    })
    expect(await publishInstagramPost(ids.b!, p.id, { ...base, fetch: f.fetch, now: t0 })).toMatchObject({
      ok: true,
    })
    expect(f.calls[0]!.url).toBe(`https://graph.facebook.com/v21.0/${IG_FB}/media`)

    // Comment webhooks for the linked account land in this spa.
    const items = await ingestInstagramWebhook(
      {
        object: 'instagram',
        entry: [
          {
            id: IG_FB,
            time: Math.floor(t0.getTime() / 1000),
            changes: [
              { field: 'comments', value: { id: 'fbcm-1', text: 'Open on Friday?', from: { id: '9' } } },
            ],
          },
        ],
      },
      { ...base, now: t0 },
    )
    expect(items.map((i) => i.tenantId)).toEqual([ids.b])
  })

  it('daily check marks invalid Page tokens expired; deauthorize and disconnect wipe tokens', async () => {
    const f = fakeFetch((url) =>
      url.includes('/debug_token') ? json({ data: { is_valid: false } }) : json({}, 404),
    )
    expect(await checkFacebookPageTokens({ ...base, fetch: f.fetch })).toEqual({
      checked: 1,
      expired: 1,
      failed: 0,
    })
    expect(facebookView(await withTenant(ids.b!, (tx) => getFacebookAccount(tx), app))?.status).toBe(
      'expired',
    )

    await platform
      .update(socialAccounts)
      .set({ status: 'connected' })
      .where(eq(socialAccounts.externalId, PAGE))
    expect(await forgetInstagramUser('fbu-1', { platform, app })).toBe(1)
    const [row] = await platform.select().from(socialAccounts).where(eq(socialAccounts.externalId, PAGE))
    expect(row).toMatchObject({ status: 'disconnected', tokenEnc: null })
    expect(await withTenant(ids.b!, (tx) => disconnectFacebook(tx), app)).toEqual([])
  })
})
