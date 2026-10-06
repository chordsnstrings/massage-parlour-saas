import { aiAgentSettings, reviews, socialAccounts, socialPosts, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  buildLocalPost,
  canAutoPost,
  chooseGbpLocation,
  createPkce,
  decryptSecret,
  encryptSecret,
  exchangeGoogleCode,
  GBP_PENDING_ID,
  GbpAuthError,
  gbpAccessToken,
  gbpErrorMessage,
  googleAuthorizeUrl,
  googleConfig,
  mapGoogleReview,
  pkceChallenge,
  postGbpReply,
  publishGbpLocalPost,
  reviewStats,
  saveGbpTokens,
  signGoogleState,
  starRatingToNumber,
  syncGbpReviews,
  verifyGoogleState,
} from '../src'

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

const { platform, app } = testDbs()
const env = { GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'csecret' }
const cfg = googleConfig(env)!
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
const NOW = new Date('2026-10-06T08:00:00Z')
/** When the location was chosen: reviews written before it are history (no AI drafts / autopilot). */
const IMPORTED = new Date('2026-10-01T00:00:00Z')
const LOC = 'accounts/111/locations/222'

type Call = { url: string; method: string; headers: Headers; body: string }
/** Records calls; `routes` maps "METHOD url-prefix" → JSON body (or [status, body]). */
function mockFetch(routes: Record<string, unknown | [number, unknown]>) {
  const calls: Call[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, headers: new Headers(init?.headers), body: String(init?.body ?? '') })
    const key = Object.keys(routes).find((k) => {
      const [m, prefix] = k.split(' ')
      return m === method && url.startsWith(prefix!)
    })
    if (!key)
      return new Response(JSON.stringify({ error: { message: 'no route', status: 'NOT_FOUND' } }), {
        status: 404,
      })
    const v = routes[key]
    const [status, body] = Array.isArray(v) ? (v as [number, unknown]) : [200, v]
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { fn, calls }
}

async function connect(opts: { expired?: boolean; refresh?: boolean } = {}) {
  await tx((db) => db.delete(socialAccounts))
  await tx((db) =>
    saveGbpTokens(
      db,
      ids.tenant!,
      {
        accessToken: 'at-1',
        refreshToken: opts.refresh === false ? null : 'rt-1',
        expiresIn: opts.expired ? -120 : 3600,
        scopes: ['https://www.googleapis.com/auth/business.manage'],
      },
      NOW,
    ),
  )
  await tx((db) =>
    chooseGbpLocation(
      db,
      ids.tenant!,
      {
        accountName: 'accounts/111',
        locationName: 'locations/222',
        title: 'Serenity Spa Marina',
      },
      IMPORTED,
    ),
  )
}

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'gbp', name: 'GBP Spa' }).returning()
  ids.tenant = t!.id
})
afterAll(async () => {
  await resetTestDatabase()
})

describe('OAuth state + PKCE', () => {
  const input = { tenantId: 't-1', userId: 'u-1', nonce: 'n-1' }
  it('round-trips a signed state and rejects tampering, other secrets and expiry', () => {
    const now = Date.now()
    const s = signGoogleState(input, 'secret', now)
    expect(verifyGoogleState(s, 'secret', now)).toMatchObject(input)
    expect(verifyGoogleState(s, 'other', now)).toBeNull()
    const [payload, sig] = s.split('.')
    const forged = Buffer.from(JSON.stringify({ ...input, tenantId: 't-2', exp: now + 1e6 })).toString(
      'base64url',
    )
    expect(verifyGoogleState(`${forged}.${sig}`, 'secret', now)).toBeNull()
    expect(verifyGoogleState(`${payload}.${sig}x`, 'secret', now)).toBeNull()
    expect(verifyGoogleState(s, 'secret', now + 11 * 60_000)).toBeNull()
    expect(verifyGoogleState(null, 'secret', now)).toBeNull()
  })
  it('uses the RFC 7636 S256 challenge and builds an offline consent URL', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
    const { verifier, challenge } = createPkce()
    expect(verifier).toMatch(/^[\w-]{43}$/)
    expect(challenge).toBe(pkceChallenge(verifier))
    const url = new URL(
      googleAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'https://app.x/cb',
        state: 'st',
        codeChallenge: challenge,
      }),
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      scope: 'https://www.googleapis.com/auth/business.manage',
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'st',
      redirect_uri: 'https://app.x/cb',
    })
  })
  it('exchanges the code with the verifier', async () => {
    const f = mockFetch({
      'POST https://oauth2.googleapis.com/token': {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3599,
        scope: 'https://www.googleapis.com/auth/business.manage',
      },
    })
    const t = await exchangeGoogleCode({
      cfg,
      code: 'c0de',
      verifier: 'v3r',
      redirectUri: 'https://app.x/cb',
      fetch: f.fn,
    })
    expect(t).toMatchObject({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3599 })
    const body = new URLSearchParams(f.calls[0]!.body)
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: 'authorization_code',
      code: 'c0de',
      code_verifier: 'v3r',
      client_id: cfg.clientId,
      redirect_uri: 'https://app.x/cb',
    })
  })
  it('is not configured without both env vars', () => {
    expect(googleConfig({ GOOGLE_CLIENT_ID: 'x' })).toBeNull()
  })
})

describe('review mapping', () => {
  it('maps STAR_RATING enums to numbers', () => {
    expect(['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'].map(starRatingToNumber)).toEqual([1, 2, 3, 4, 5])
    expect(starRatingToNumber('STAR_RATING_UNSPECIFIED')).toBeNull()
  })
  it('maps a v4 review, hiding anonymous authors and keeping an existing reply', () => {
    expect(
      mapGoogleReview({
        name: `${LOC}/reviews/r1`,
        reviewer: { displayName: 'Layla H.' },
        starRating: 'FOUR',
        comment: ' Lovely calm space ',
        createTime: '2026-10-01T10:00:00Z',
        reviewReply: { comment: 'Thank you Layla!', updateTime: '2026-10-02T09:00:00Z' },
      }),
    ).toEqual({
      externalId: `${LOC}/reviews/r1`,
      author: 'Layla H.',
      rating: 4,
      text: 'Lovely calm space',
      reviewedAt: new Date('2026-10-01T10:00:00Z'),
      replyText: 'Thank you Layla!',
      repliedAt: new Date('2026-10-02T09:00:00Z'),
    })
    expect(
      mapGoogleReview({
        name: `${LOC}/reviews/r2`,
        reviewer: { isAnonymous: true, displayName: 'A Google user' },
        starRating: 'ONE',
      }),
    ).toMatchObject({ author: null, rating: 1, text: null, replyText: null })
    expect(mapGoogleReview({ name: `${LOC}/reviews/r3`, starRating: 'STAR_RATING_UNSPECIFIED' })).toBeNull()
  })
  it('only lets autopilot answer 4–5★', () => {
    expect([1, 2, 3, 4, 5].map((n) => canAutoPost(n, 'autopilot'))).toEqual([false, false, false, true, true])
    expect(canAutoPost(5, 'approve')).toBe(false)
  })
})

describe('tokens', () => {
  it('stores tokens encrypted and uses the stored one while valid', async () => {
    await connect()
    const [row] = await tx((db) => db.select().from(socialAccounts))
    expect(row!.tokenEnc).not.toContain('at-1')
    expect(decryptSecret(row!.tokenEnc!)).toBe('at-1')
    expect(row).toMatchObject({ externalId: 'locations/222', status: 'connected' })
    const f = mockFetch({})
    const t = await gbpAccessToken({ tenantId: ids.tenant!, db: app, fetch: f.fn, now: NOW, env })
    expect(t.token).toBe('at-1')
    expect(f.calls).toHaveLength(0)
  })
  it('refreshes an expired token and saves the new one', async () => {
    await connect({ expired: true })
    const f = mockFetch({
      'POST https://oauth2.googleapis.com/token': { access_token: 'at-2', expires_in: 3600 },
    })
    const t = await gbpAccessToken({ tenantId: ids.tenant!, db: app, fetch: f.fn, now: NOW, env })
    expect(t.token).toBe('at-2')
    const body = new URLSearchParams(f.calls[0]!.body)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('rt-1')
    const [row] = await tx((db) => db.select().from(socialAccounts))
    expect(decryptSecret(row!.tokenEnc!)).toBe('at-2')
    expect(decryptSecret(row!.refreshTokenEnc!)).toBe('rt-1')
    expect(row!.tokenExpiresAt!.getTime()).toBe(NOW.getTime() + 3600_000)
  })
  it('flags the connection when the grant was revoked', async () => {
    await connect({ expired: true })
    const f = mockFetch({
      'POST https://oauth2.googleapis.com/token': [
        400,
        { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
      ],
    })
    await expect(
      gbpAccessToken({ tenantId: ids.tenant!, db: app, fetch: f.fn, now: NOW, env }),
    ).rejects.toBeInstanceOf(GbpAuthError)
    const [row] = await tx((db) => db.select().from(socialAccounts))
    expect(row!.status).toBe('error')
    expect(row!.meta.lastError).toMatch(/Reconnect/)
  })
  it("doesn't flag the connection when the server's own client is rejected", async () => {
    await connect({ expired: true })
    const f = mockFetch({
      'POST https://oauth2.googleapis.com/token': [
        401,
        { error: 'invalid_client', error_description: 'The OAuth client was not found.' },
      ],
    })
    const err = await gbpAccessToken({ tenantId: ids.tenant!, db: app, fetch: f.fn, now: NOW, env }).catch(
      (e: unknown) => e,
    )
    expect(err).not.toBeInstanceOf(GbpAuthError)
    expect(gbpErrorMessage(err)).toMatch(/client ID and secret/)
    const [row] = await tx((db) => db.select().from(socialAccounts))
    expect(row!.status).toBe('connected')
    expect(row!.meta.lastError).toBeUndefined()
  })
  it('keeps the location (and refresh token) on reconnect', async () => {
    await connect()
    await tx((db) =>
      saveGbpTokens(
        db,
        ids.tenant!,
        { accessToken: 'at-9', refreshToken: null, expiresIn: 3600, scopes: [] },
        NOW,
      ),
    )
    const [row] = await tx((db) => db.select().from(socialAccounts))
    expect(row).toMatchObject({ externalId: 'locations/222', status: 'connected' })
    expect(decryptSecret(row!.refreshTokenEnc!)).toBe('rt-1')
    expect(GBP_PENDING_ID).toBe('pending')
  })
})

describe('reviews sync + replies', () => {
  beforeEach(async () => {
    await tx((db) => db.delete(reviews))
    await connect()
  })

  it('syncs every page, keeps Google replies and drafts new ones; autopilot posts only 4–5★', async () => {
    await tx((db) =>
      db
        .insert(aiAgentSettings)
        .values({ tenantId: ids.tenant!, agentKey: 'review_agent', enabled: true, mode: 'autopilot' })
        .onConflictDoUpdate({
          target: [aiAgentSettings.tenantId, aiAgentSettings.agentKey],
          set: { enabled: true, mode: 'autopilot' },
        }),
    )
    const page1 = {
      reviews: [
        {
          name: `${LOC}/reviews/a`,
          reviewer: { displayName: 'Mona' },
          starRating: 'FIVE',
          comment: 'Perfect',
          createTime: '2026-10-05T10:00:00Z',
        },
        {
          name: `${LOC}/reviews/b`,
          reviewer: { displayName: 'Sam' },
          starRating: 'FOUR',
          comment: 'Good',
          createTime: '2026-09-01T10:00:00Z',
          reviewReply: { comment: 'Thanks Sam', updateTime: '2026-09-02T10:00:00Z' },
        },
      ],
      nextPageToken: 'p2',
      averageRating: 3.7,
      totalReviewCount: 3,
    }
    const page2 = {
      reviews: [
        {
          name: `${LOC}/reviews/c`,
          reviewer: { displayName: 'Omar' },
          starRating: 'TWO',
          comment: 'Too cold',
          createTime: '2026-10-04T10:00:00Z',
        },
      ],
    }
    const f = mockFetch({
      [`GET https://mybusiness.googleapis.com/v4/${LOC}/reviews?pageSize=50&orderBy=updateTime+desc&pageToken=p2`]:
        page2,
      [`GET https://mybusiness.googleapis.com/v4/${LOC}/reviews`]: page1,
      'PUT https://mybusiness.googleapis.com/v4/': { comment: 'ok', updateTime: '2026-10-06T08:01:00Z' },
    })
    const drafted: string[] = []
    const draft = async (reviewId: string) => {
      drafted.push(reviewId)
      await tx((db) =>
        db
          .update(reviews)
          .set({ replyText: 'Thank you so much!', replyStatus: 'draft' })
          .where(eq(reviews.id, reviewId)),
      )
    }
    const res = await syncGbpReviews({ tenantId: ids.tenant!, db: app, fetch: f.fn, now: NOW, env, draft })
    expect(res).toMatchObject({ ok: true, fetched: 3, created: 2, drafted: 2, posted: 1, failed: 0 })
    expect(f.calls[0]!.headers.get('authorization')).toBe('Bearer at-1')

    const rows = await tx((db) => db.select().from(reviews))
    const by = Object.fromEntries(rows.map((r) => [r.externalId.split('/').pop(), r]))
    expect(by.a).toMatchObject({ rating: 5, replyStatus: 'posted', replyText: 'Thank you so much!' })
    expect(by.b).toMatchObject({ rating: 4, replyStatus: 'posted', replyText: 'Thanks Sam' })
    expect(by.c).toMatchObject({ rating: 2, replyStatus: 'draft' }) // 1–3★ always wait for approval
    const put = f.calls.find((c) => c.method === 'PUT')!
    expect(put.url).toBe(`https://mybusiness.googleapis.com/v4/${LOC}/reviews/a/reply`)
    expect(JSON.parse(put.body)).toEqual({ comment: 'Thank you so much!' })

    const [acct] = await tx((db) => db.select().from(socialAccounts))
    expect(acct!.meta.lastSyncAt).toBe(NOW.toISOString())

    // second sync: nothing new, nothing re-drafted
    const again = await syncGbpReviews({ tenantId: ids.tenant!, db: app, fetch: f.fn, now: NOW, env, draft })
    expect(again).toMatchObject({ ok: true, created: 0, drafted: 0 })
    expect(drafted).toHaveLength(2)

    expect(await tx((db) => reviewStats(db, ids.tenant!))).toEqual({
      count: 3,
      average: 3.7,
      responseRate: 67,
      needsReply: 1,
    })
  })

  it('drafts from stored rows: failed or deferred drafts retry next sync, history before the import never', async () => {
    await tx((db) =>
      db
        .insert(aiAgentSettings)
        .values({ tenantId: ids.tenant!, agentKey: 'review_agent', enabled: true, mode: 'approve' })
        .onConflictDoUpdate({
          target: [aiAgentSettings.tenantId, aiAgentSettings.agentKey],
          set: { enabled: true, mode: 'approve' },
        }),
    )
    const review = (id: string, createTime: string) => ({
      name: `${LOC}/reviews/${id}`,
      reviewer: { displayName: id },
      starRating: 'FIVE',
      createTime,
    })
    const f = mockFetch({
      [`GET https://mybusiness.googleapis.com/v4/${LOC}/reviews`]: {
        reviews: [
          review('n1', '2026-10-05T10:00:00Z'),
          review('n2', '2026-10-04T10:00:00Z'),
          review('old', '2026-09-20T10:00:00Z'),
        ],
      },
    })
    const drafted: string[] = []
    const draft = async (reviewId: string) => {
      drafted.push(reviewId)
      await tx((db) =>
        db
          .update(reviews)
          .set({ replyText: 'Thanks!', replyStatus: 'draft' })
          .where(eq(reviews.id, reviewId)),
      )
    }
    const sync = (d: (id: string) => Promise<unknown>, maxDrafts?: number) =>
      syncGbpReviews({ tenantId: ids.tenant!, db: app, fetch: f.fn, now: NOW, env, draft: d, maxDrafts })

    // AI unavailable: everything inserted, nothing drafted
    const busy = await sync(async () => {
      throw new Error('AI busy')
    })
    expect(busy).toMatchObject({ ok: true, created: 3, drafted: 0 })
    // AI back, one per run: newest first, then the next one
    expect(await sync(draft, 1)).toMatchObject({ created: 0, drafted: 1 })
    expect(await sync(draft, 1)).toMatchObject({ created: 0, drafted: 1 })
    expect(await sync(draft)).toMatchObject({ drafted: 0 })
    const rows = await tx((db) => db.select().from(reviews))
    const by = Object.fromEntries(rows.map((r) => [r.externalId.split('/').pop(), r]))
    expect(drafted).toEqual([by.n1!.id, by.n2!.id])
    expect(by.old).toMatchObject({ replyStatus: 'none', replyText: null })
  })

  it("keeps a reply approved here (or whose post failed) over Google's older one", async () => {
    await tx((db) =>
      db.insert(reviews).values([
        {
          tenantId: ids.tenant!,
          externalId: `${LOC}/reviews/edited`,
          rating: 5,
          replyText: 'Updated thanks',
          replyStatus: 'failed',
          replyError: 'Google refused the request (403)',
        },
        {
          tenantId: ids.tenant!,
          externalId: `${LOC}/reviews/drafted`,
          rating: 5,
          replyText: 'AI draft',
          replyStatus: 'draft',
        },
      ]),
    )
    const reply = { comment: 'Old thanks', updateTime: '2026-10-02T10:00:00Z' }
    const f = mockFetch({
      [`GET https://mybusiness.googleapis.com/v4/${LOC}/reviews`]: {
        reviews: ['edited', 'drafted'].map((id) => ({
          name: `${LOC}/reviews/${id}`,
          starRating: 'FIVE',
          createTime: '2026-10-01T10:00:00Z',
          reviewReply: reply,
        })),
      },
    })
    expect(
      await syncGbpReviews({ tenantId: ids.tenant!, db: app, fetch: f.fn, now: NOW, env }),
    ).toMatchObject({
      ok: true,
    })
    const rows = await tx((db) => db.select().from(reviews))
    const by = Object.fromEntries(rows.map((r) => [r.externalId.split('/').pop(), r]))
    expect(by.edited).toMatchObject({ replyText: 'Updated thanks', replyStatus: 'failed' })
    expect(by.edited!.replyError).toMatch(/403/)
    // a draft loses to a reply written on Google directly
    expect(by.drafted).toMatchObject({ replyText: 'Old thanks', replyStatus: 'posted' })
  })

  it('posts an approved reply, and marks a rejected one failed with the reason', async () => {
    const [r] = await tx((db) =>
      db
        .insert(reviews)
        .values({
          tenantId: ids.tenant!,
          externalId: `${LOC}/reviews/x`,
          rating: 3,
          replyText: 'Sorry about that',
          replyStatus: 'draft',
        })
        .returning(),
    )
    const ok = mockFetch({ 'PUT https://mybusiness.googleapis.com/v4/': { comment: 'Sorry about that' } })
    expect(
      await postGbpReply({ tenantId: ids.tenant!, db: app, fetch: ok.fn, now: NOW, env, reviewId: r!.id }),
    ).toEqual({
      ok: false,
      error: 'Approve the reply before posting it.',
    })
    await tx((db) => db.update(reviews).set({ replyStatus: 'approved' }).where(eq(reviews.id, r!.id)))

    const denied = mockFetch({
      'PUT https://mybusiness.googleapis.com/v4/': [
        403,
        { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } },
      ],
    })
    const bad = await postGbpReply({
      tenantId: ids.tenant!,
      db: app,
      fetch: denied.fn,
      now: NOW,
      env,
      reviewId: r!.id,
    })
    expect(bad.ok).toBe(false)
    let [row] = await tx((db) => db.select().from(reviews).where(eq(reviews.id, r!.id)))
    expect(row).toMatchObject({ replyStatus: 'failed' })
    expect(row!.replyError).toMatch(/403.*permission/i)

    expect(
      await postGbpReply({ tenantId: ids.tenant!, db: app, fetch: ok.fn, now: NOW, env, reviewId: r!.id }),
    ).toEqual({ ok: true })
    ;[row] = await tx((db) => db.select().from(reviews).where(eq(reviews.id, r!.id)))
    expect(row).toMatchObject({ replyStatus: 'posted', replyError: null })
  })

  it('refreshes once and retries when Google says the token is invalid', async () => {
    const [r] = await tx((db) =>
      db
        .insert(reviews)
        .values({
          tenantId: ids.tenant!,
          externalId: `${LOC}/reviews/y`,
          rating: 5,
          replyText: 'Thanks!',
          replyStatus: 'approved',
        })
        .returning(),
    )
    let puts = 0
    const calls: string[] = []
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method} ${String(input)}`)
      if (String(input).startsWith('https://oauth2.googleapis.com/token'))
        return Response.json({ access_token: 'at-fresh', expires_in: 3600 })
      puts++
      const auth = new Headers(init?.headers).get('authorization')
      return auth === 'Bearer at-fresh'
        ? Response.json({ comment: 'Thanks!' })
        : Response.json(
            {
              error: {
                code: 401,
                message: 'Request had invalid authentication credentials.',
                status: 'UNAUTHENTICATED',
              },
            },
            { status: 401 },
          )
    }) as typeof fetch
    expect(
      await postGbpReply({ tenantId: ids.tenant!, db: app, fetch: fetchFn, now: NOW, env, reviewId: r!.id }),
    ).toEqual({ ok: true })
    expect(puts).toBe(2)
    expect(calls.filter((c) => c.includes('oauth2'))).toHaveLength(1)
  })

  it('refuses hand-entered reviews and reports an unusable stored token', async () => {
    const [manual] = await tx((db) =>
      db
        .insert(reviews)
        .values({
          tenantId: ids.tenant!,
          externalId: 'manual-1',
          rating: 5,
          replyText: 'Thanks',
          replyStatus: 'approved',
        })
        .returning(),
    )
    expect(
      (await postGbpReply({ tenantId: ids.tenant!, db: app, now: NOW, env, reviewId: manual!.id })).ok,
    ).toBe(false)
    const [elsewhere] = await tx((db) =>
      db
        .insert(reviews)
        .values({
          tenantId: ids.tenant!,
          externalId: 'accounts/111/locations/999/reviews/q',
          rating: 5,
          replyText: 'Thanks',
          replyStatus: 'approved',
        })
        .returning(),
    )
    const none = mockFetch({})
    expect(
      await postGbpReply({
        tenantId: ids.tenant!,
        db: app,
        fetch: none.fn,
        now: NOW,
        env,
        reviewId: elsewhere!.id,
      }),
    ).toEqual({ ok: false, error: expect.stringMatching(/no longer connected/) })
    expect(none.calls).toHaveLength(0)

    await tx((db) => db.update(socialAccounts).set({ tokenEnc: 'fake-token', refreshTokenEnc: null }))
    const [r] = await tx((db) =>
      db
        .insert(reviews)
        .values({
          tenantId: ids.tenant!,
          externalId: `${LOC}/reviews/z`,
          rating: 4,
          replyText: 'Thanks',
          replyStatus: 'approved',
        })
        .returning(),
    )
    const f = mockFetch({})
    const res = await postGbpReply({
      tenantId: ids.tenant!,
      db: app,
      fetch: f.fn,
      now: NOW,
      env,
      reviewId: r!.id,
    })
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/Reconnect/) })
    expect(f.calls).toHaveLength(0)
  })
})

describe('local posts', () => {
  it('builds a STANDARD post with a Book button, attaching only public https photos', () => {
    const p = buildLocalPost({
      summary: 'Hello',
      bookingUrl: 'https://spa.example/book?src=gbp',
      imageUrl: 'https://cdn.example/a.jpg',
    })
    expect(p).toEqual({
      languageCode: 'en',
      summary: 'Hello',
      topicType: 'STANDARD',
      callToAction: { actionType: 'BOOK', url: 'https://spa.example/book?src=gbp' },
      media: [{ mediaFormat: 'PHOTO', sourceUrl: 'https://cdn.example/a.jpg' }],
    })
    expect(
      buildLocalPost({ summary: 'x', bookingUrl: 'u', imageUrl: 'http://cdn.example/a.jpg' }).media,
    ).toBeUndefined()
    expect(
      buildLocalPost({ summary: 'x', bookingUrl: 'u', imageUrl: 'https://spa.localhost/a.jpg' }).media,
    ).toBeUndefined()
    expect(buildLocalPost({ summary: 'x'.repeat(2000), bookingUrl: 'u' }).summary).toHaveLength(1500)
  })

  it('posts an approved post to the location once', async () => {
    await connect()
    const [draft] = await tx((db) =>
      db
        .insert(socialPosts)
        .values({ tenantId: ids.tenant!, platform: 'instagram', caption: 'Autumn offer', status: 'draft' })
        .returning(),
    )
    const f = mockFetch({
      [`POST https://mybusiness.googleapis.com/v4/${LOC}/localPosts`]: { name: `${LOC}/localPosts/p1` },
    })
    const opts = {
      tenantId: ids.tenant!,
      db: app,
      fetch: f.fn,
      now: NOW,
      env,
      postId: draft!.id,
      bookingUrl: 'https://gbp.example/book?src=gbp',
    }
    expect(await publishGbpLocalPost(opts)).toEqual({
      ok: false,
      error: 'Approve the post before posting it to Google.',
    })
    await tx((db) => db.update(socialPosts).set({ status: 'scheduled' }).where(eq(socialPosts.id, draft!.id)))
    expect(await publishGbpLocalPost(opts)).toEqual({ ok: true, name: `${LOC}/localPosts/p1` })
    expect(JSON.parse(f.calls[0]!.body)).toMatchObject({
      summary: 'Autumn offer',
      callToAction: { actionType: 'BOOK' },
    })
    const gbp = await tx((db) => db.select().from(socialPosts).where(eq(socialPosts.platform, 'gbp')))
    expect(gbp).toHaveLength(1)
    expect(gbp[0]).toMatchObject({
      type: 'gbp_post',
      status: 'published',
      externalId: `${LOC}/localPosts/p1`,
    })
    expect(await publishGbpLocalPost(opts)).toEqual({ ok: false, error: 'This post is already on Google.' })
    expect(encryptSecret('x')).not.toBe('x')
  })
})
