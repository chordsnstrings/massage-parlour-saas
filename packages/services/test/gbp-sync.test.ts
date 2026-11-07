// F17: Google "Book" button (Place Actions) + Search Console sitemaps — all Google HTTP through fixtures.
import { domains, socialAccounts, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  chooseGbpLocation,
  freeSiteUrl,
  GoogleApiError,
  gbpBookView,
  gbpSearchConsoleView,
  getGbpAccount,
  googleBookingUrl,
  googleErrorCode,
  markSitemapDue,
  pickScProperty,
  removeGbpBookAction,
  SEARCH_CONSOLE_SCOPE,
  saveGbpTokens,
  scPropertyCandidates,
  setGbpBookAction,
  submitDueSitemaps,
  submitGbpSitemap,
  syncGbpBookActions,
} from '../src'

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

const { platform, app } = testDbs()
const env = {
  GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'csecret',
  ROOT_DOMAIN: 'spamanagement.co',
  APP_URL: 'https://app.spamanagement.co',
}
const ids = {} as Record<string, string>
const NOW = new Date('2026-10-10T08:00:00Z')
const PA = 'https://mybusinessplaceactions.googleapis.com/v1'
const SC = 'https://www.googleapis.com/webmasters/v3'
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)

type Call = { url: string; method: string; body: string }
/** "METHOD url-prefix" → JSON body, [status, body], or a function of the call. */
function mockFetch(routes: Record<string, unknown>) {
  const calls: Call[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const call = { url, method, body: String(init?.body ?? '') }
    calls.push(call)
    const key = Object.keys(routes).find((k) => {
      const [m, prefix] = k.split(' ')
      return m === method && url.startsWith(prefix!)
    })
    let v = key ? routes[key] : [404, { error: { message: 'no route', status: 'NOT_FOUND' } }]
    if (typeof v === 'function') v = (v as (c: Call) => unknown)(call)
    const [status, body] = Array.isArray(v) ? (v as [number, unknown]) : [200, v]
    return new Response(body === undefined ? '' : JSON.stringify(body), { status })
  }) as typeof fetch
  return { fn, calls }
}

const opts = (f: { fn: typeof fetch }) => ({ tenantId: ids.tenant!, db: app, fetch: f.fn, now: NOW, env })

async function connect(scopes = ['https://www.googleapis.com/auth/business.manage', SEARCH_CONSOLE_SCOPE]) {
  await tx((db) => db.delete(socialAccounts))
  await tx((db) =>
    saveGbpTokens(
      db,
      ids.tenant!,
      { accessToken: 'at-1', refreshToken: 'rt-1', expiresIn: 3600, scopes },
      NOW,
    ),
  )
  await tx((db) =>
    chooseGbpLocation(db, ids.tenant!, {
      accountName: 'accounts/111',
      locationName: 'locations/222',
      title: 'Serenity Spa',
    }),
  )
}
const row = () => tx((db) => getGbpAccount(db, ids.tenant!))

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'serenity', name: 'Serenity Spa' }).returning()
  ids.tenant = t!.id
})
afterAll(async () => {
  const { closeAllDbs } = await import('@spa/db')
  await closeAllDbs()
})
beforeEach(() => connect())

describe('Google error codes + Search Console helpers', () => {
  it('classifies disabled APIs, missing scopes and permissions', () => {
    expect(googleErrorCode(new GoogleApiError('x', 403, 'PERMISSION_DENIED', 'SERVICE_DISABLED'))).toBe(
      'api_disabled',
    )
    expect(
      googleErrorCode(new GoogleApiError('Access Not Configured. API has not been used in project 1', 403)),
    ).toBe('api_disabled')
    expect(
      googleErrorCode(new GoogleApiError('x', 403, 'PERMISSION_DENIED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')),
    ).toBe('scope')
    expect(googleErrorCode(new GoogleApiError('Request had insufficient authentication scopes.', 403))).toBe(
      'scope',
    )
    expect(googleErrorCode(new GoogleApiError('nope', 403, 'PERMISSION_DENIED'))).toBe('permission')
    expect(googleErrorCode(new GoogleApiError('x', 401, 'UNAUTHENTICATED'))).toBe('auth')
    expect(googleErrorCode(new Error('x'))).toBe('other')
  })
  it('lists covering properties and picks one the account may submit for', () => {
    expect(scPropertyCandidates('https://www.serenity.ae')).toEqual([
      'https://www.serenity.ae/',
      'sc-domain:www.serenity.ae',
      'sc-domain:serenity.ae',
    ])
    expect(scPropertyCandidates('http://localhost:3000/s/serenity')[0]).toBe(
      'http://localhost:3000/s/serenity/',
    )
    const sites = [
      { siteUrl: 'https://www.serenity.ae/', permissionLevel: 'siteUnverifiedUser' },
      { siteUrl: 'sc-domain:serenity.ae', permissionLevel: 'siteOwner' },
    ]
    expect(pickScProperty(sites, scPropertyCandidates('https://www.serenity.ae'))?.siteUrl).toBe(
      'sc-domain:serenity.ae',
    )
    expect(pickScProperty(sites.slice(0, 1), scPropertyCandidates('https://www.serenity.ae'))).toBeNull()
    expect(freeSiteUrl('serenity', env)).toBe('https://serenity.spamanagement.co')
    expect(googleBookingUrl('https://serenity.spamanagement.co')).toBe(
      'https://serenity.spamanagement.co/book?src=google',
    )
  })
})

describe('Book button (Place Actions)', () => {
  const URL1 = 'https://serenity.spamanagement.co/book?src=google'
  it('creates the APPOINTMENT link, then re-points the same link, then removes only ours', async () => {
    const f = mockFetch({
      [`GET ${PA}/locations/222/placeActionLinks`]: {
        placeActionLinks: [
          // Another provider's link stays untouched.
          {
            name: 'locations/222/placeActionLinks/fresha',
            uri: 'https://fresha.test/x',
            placeActionType: 'APPOINTMENT',
            isEditable: false,
          },
        ],
      },
      [`POST ${PA}/locations/222/placeActionLinks`]: (c: Call) => ({
        name: 'locations/222/placeActionLinks/ours1',
        ...JSON.parse(c.body),
      }),
    })
    const r = await setGbpBookAction({ ...opts(f), bookingUrl: URL1 })
    expect(r).toMatchObject({ ok: true, name: 'locations/222/placeActionLinks/ours1', changed: true })
    const post = f.calls.find((c) => c.method === 'POST')!
    expect(JSON.parse(post.body)).toEqual({ uri: URL1, placeActionType: 'APPOINTMENT', isPreferred: true })
    expect(f.calls[0]!.url).toContain('filter=placeActionType%3DAPPOINTMENT')
    expect(gbpBookView(await row())).toMatchObject({ enabled: true, uri: URL1, error: null })

    const URL2 = 'https://www.serenity.ae/book?src=google'
    const g = mockFetch({
      [`GET ${PA}/locations/222/placeActionLinks`]: {
        placeActionLinks: [
          {
            name: 'locations/222/placeActionLinks/ours1',
            uri: URL1,
            placeActionType: 'APPOINTMENT',
            isPreferred: true,
          },
        ],
      },
      [`PATCH ${PA}/locations/222/placeActionLinks/ours1`]: (c: Call) => JSON.parse(c.body),
    })
    expect(await setGbpBookAction({ ...opts(g), bookingUrl: URL2 })).toMatchObject({
      ok: true,
      changed: true,
    })
    const patch = g.calls.find((c) => c.method === 'PATCH')!
    expect(patch.url).toContain('updateMask=uri%2CisPreferred')
    expect(JSON.parse(patch.body)).toMatchObject({ uri: URL2, isPreferred: true })
    expect((await row())!.meta.bookUri).toBe(URL2)

    const h = mockFetch({
      [`GET ${PA}/locations/222/placeActionLinks`]: {
        placeActionLinks: [
          {
            name: 'locations/222/placeActionLinks/fresha',
            uri: 'https://fresha.test/x',
            placeActionType: 'APPOINTMENT',
            isEditable: false,
          },
          { name: 'locations/222/placeActionLinks/ours1', uri: URL2, placeActionType: 'APPOINTMENT' },
        ],
      },
      [`DELETE ${PA}/locations/222/placeActionLinks/ours1`]: {},
    })
    expect(await removeGbpBookAction(opts(h))).toEqual({ ok: true, removed: true })
    expect(h.calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([
      `${PA}/locations/222/placeActionLinks/ours1`,
    ])
    expect(gbpBookView(await row())).toMatchObject({ enabled: false, uri: null })
  })

  it('stores a clear code when the Place Actions API is not enabled', async () => {
    const f = mockFetch({
      [`GET ${PA}/`]: [
        403,
        {
          error: {
            status: 'PERMISSION_DENIED',
            message:
              'My Business Place Actions API has not been used in project 123 before or it is disabled.',
            details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }],
          },
        },
      ],
    })
    expect(await setGbpBookAction({ ...opts(f), bookingUrl: URL1 })).toEqual({
      ok: false,
      code: 'api_disabled',
    })
    expect(gbpBookView(await row())).toMatchObject({ enabled: true, error: 'api_disabled' })
  })

  it('worker: follows a new primary custom domain, skips unchanged ones and backs off failures', async () => {
    const ok = () =>
      mockFetch({
        [`GET ${PA}/locations/222/placeActionLinks`]: { placeActionLinks: [] },
        [`POST ${PA}/locations/222/placeActionLinks`]: (c: Call) => ({
          name: 'locations/222/placeActionLinks/n1',
          ...JSON.parse(c.body),
        }),
      })
    await setGbpBookAction({ ...opts(ok()), bookingUrl: URL1 })
    const quiet = ok()
    expect(await syncGbpBookActions({ platform, app, fetch: quiet.fn, now: NOW, env })).toMatchObject({
      checked: 1,
      updated: 0,
    })
    expect(quiet.calls).toHaveLength(0)

    await platform.insert(domains).values({
      tenantId: ids.tenant!,
      hostname: 'www.serenity.ae',
      kind: 'custom',
      status: 'active',
      isPrimary: true,
    })
    const moved = ok()
    expect(await syncGbpBookActions({ platform, app, fetch: moved.fn, now: NOW, env })).toMatchObject({
      updated: 1,
    })
    expect((await row())!.meta.bookUri).toBe('https://www.serenity.ae/book?src=google')

    // A failure on the same address is retried after 6 hours, not every run.
    await platform.update(domains).set({ isPrimary: false }).where(eq(domains.hostname, 'www.serenity.ae'))
    const down = mockFetch({ [`GET ${PA}/`]: [500, { error: { message: 'backend', status: 'INTERNAL' } }] })
    expect((await syncGbpBookActions({ platform, app, fetch: down.fn, now: NOW, env })).failed).toBe(1)
    const again = mockFetch({})
    await syncGbpBookActions({ platform, app, fetch: again.fn, now: new Date(NOW.getTime() + 3600_000), env })
    expect(again.calls).toHaveLength(0)
    await syncGbpBookActions({
      platform,
      app,
      fetch: again.fn,
      now: new Date(NOW.getTime() + 7 * 3600_000),
      env,
    })
    expect(again.calls.length).toBeGreaterThan(0)
    await platform.delete(domains).where(eq(domains.hostname, 'www.serenity.ae'))
  })
})

describe('Search Console sitemaps', () => {
  const free = 'https://serenity.spamanagement.co'
  it('submits to an owned property and records the status', async () => {
    const f = mockFetch({
      [`GET ${SC}/sites/`]: { lastSubmitted: '2026-10-10T08:00:01Z', isPending: true },
      [`GET ${SC}/sites`]: {
        siteEntry: [{ siteUrl: 'sc-domain:spamanagement.co', permissionLevel: 'siteFullUser' }],
      },
      [`PUT ${SC}/sites/`]: undefined,
    })
    const r = await submitGbpSitemap({ ...opts(f), siteBase: free, custom: false })
    expect(r).toEqual({
      ok: true,
      state: 'submitted',
      siteUrl: 'sc-domain:spamanagement.co',
      sitemapUrl: `${free}/sitemap.xml`,
    })
    const put = f.calls.find((c) => c.method === 'PUT')!
    expect(put.url).toBe(
      `${SC}/sites/${encodeURIComponent('sc-domain:spamanagement.co')}/sitemaps/${encodeURIComponent(`${free}/sitemap.xml`)}`,
    )
    expect(put.body).toBe('')
    expect(gbpSearchConsoleView(await row())).toMatchObject({
      state: 'submitted',
      pending: true,
      hasScope: true,
    })
  })

  it('adds a custom domain property (verify next) and reports no access for the free address', async () => {
    const f = mockFetch({ [`GET ${SC}/sites`]: { siteEntry: [] }, [`PUT ${SC}/sites/`]: undefined })
    expect(await submitGbpSitemap({ ...opts(f), siteBase: 'https://www.serenity.ae', custom: true })).toEqual(
      {
        ok: false,
        state: 'needs_verification',
      },
    )
    expect(f.calls.find((c) => c.method === 'PUT')!.url).toBe(
      `${SC}/sites/${encodeURIComponent('https://www.serenity.ae/')}`,
    )
    const g = mockFetch({ [`GET ${SC}/sites`]: { siteEntry: [] } })
    expect(await submitGbpSitemap({ ...opts(g), siteBase: free, custom: false })).toEqual({
      ok: false,
      state: 'no_access',
    })
    expect(g.calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('needs the Search Console scope, and the worker sends queued sitemaps after the debounce', async () => {
    await connect(['https://www.googleapis.com/auth/business.manage'])
    const none = mockFetch({})
    expect(await submitGbpSitemap({ ...opts(none), siteBase: free, custom: false })).toEqual({
      ok: false,
      state: 'error',
      code: 'scope',
    })
    expect(none.calls).toHaveLength(0)
    expect(await tx((db) => markSitemapDue(db, ids.tenant!, NOW))).toBe(false)

    await connect()
    expect(await tx((db) => markSitemapDue(db, ids.tenant!, NOW))).toBe(true)
    const f = mockFetch({
      [`GET ${SC}/sites/`]: {},
      [`GET ${SC}/sites`]: { siteEntry: [{ siteUrl: `${free}/`, permissionLevel: 'siteOwner' }] },
      [`PUT ${SC}/sites/`]: undefined,
    })
    expect(await submitDueSitemaps({ platform, app, fetch: f.fn, now: NOW, env })).toEqual({
      submitted: 0,
      notSubmitted: 0,
    })
    const later = new Date(NOW.getTime() + 5 * 60_000)
    expect(await submitDueSitemaps({ platform, app, fetch: f.fn, now: later, env })).toEqual({
      submitted: 1,
      notSubmitted: 0,
    })
    expect(gbpSearchConsoleView(await row())).toMatchObject({ state: 'submitted', due: false })
  })
})
