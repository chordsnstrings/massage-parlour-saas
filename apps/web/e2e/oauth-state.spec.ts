import { expect, type Page, test } from '@playwright/test'
import { tenants } from '@spa/db'
import { signGoogleState, signState } from '@spa/services'
import { app, PATH, PORT, testDb, uniqueSlug } from './helpers'

/** playwright.config.ts BETTER_AUTH_SECRET (signs the OAuth state). */
const SECRET = 'e2e-secret-e2e-secret-e2e-secret-e2e'
/** API routes live on the app origin (the bare domain under path routing). */
const api = PATH ? `http://localhost:${PORT}` : `http://app.localhost:${PORT}`
const viaHost = (page: Page, url: string, cookie?: string) => {
  const u = new URL(url)
  return page.request.get(`http://127.0.0.1:${PORT}${u.pathname}${u.search}`, {
    headers: { host: u.host, ...(cookie ? { cookie } : {}) },
    maxRedirects: 0,
    failOnStatusCode: false,
  })
}

// R29: the OAuth callbacks (Instagram Login, Facebook Login for Business, Google): an expired but genuine state returns
// to its spa with the `state` notice (a bad signature → the dashboard root), and the nonce cookie is per flow and spa,
// so a manager connecting two spas in one browser (two tabs) doesn't break the first connect.
test('R29 OAuth callbacks: expired state → its spa, bad signature → root, one nonce cookie per spa', async ({
  page,
}) => {
  const db = testDb()
  const [a, b] = await db
    .insert(tenants)
    .values([uniqueSlug('oauth-a'), uniqueSlug('oauth-b')].map((slug) => ({ slug, name: slug })))
    .returning()
  const elevenMinutesAgo = Date.now() - 11 * 60_000
  const meta = (tenantId: string, nonce: string, now?: number) =>
    signState({ tenantId, userId: 'u-e2e', nonce }, SECRET, now)
  const flows = [
    {
      path: '/api/integrations/meta/callback',
      notice: 'ig',
      state: meta,
      cookie: (t: string, n: string) => `ig_oauth_nonce_${t}=${n}`,
    },
    {
      path: '/api/integrations/meta/facebook/callback',
      notice: 'fb',
      state: meta,
      cookie: (t: string, n: string) => `fb_oauth_nonce_${t}=${n}`,
    },
    {
      path: '/api/integrations/google/callback',
      notice: 'gbp',
      state: (tenantId: string, nonce: string, now?: number) =>
        signGoogleState({ tenantId, userId: 'u-e2e', nonce }, SECRET, now),
      cookie: (t: string, n: string) => `gbp_oauth_${t}=${n}.e2e-verifier`,
    },
  ]
  for (const f of flows) {
    const call = (state: string, cookie?: string) =>
      viaHost(page, `${api}${f.path}?code=c&state=${encodeURIComponent(state)}`, cookie)
    const spaNotice = `${app}/${a!.slug}/settings/integrations?${f.notice}=state`

    const expired = await call(f.state(a!.id, 'n-a', elevenMinutesAgo), f.cookie(a!.id, 'n-a'))
    expect(expired.status(), f.path).toBe(307)
    expect(expired.headers().location, f.path).toBe(spaNotice)

    expect((await call(`${f.state(a!.id, 'n-a')}x`)).headers().location, f.path).toBe(`${app}/`)

    // Spa B's connect (another tab) set its own cookie: spa A's callback still finds A's nonce …
    const both = `${f.cookie(b!.id, 'n-b')}; ${f.cookie(a!.id, 'n-a')}`
    const passed = await call(f.state(a!.id, 'n-a'), both)
    expect(passed.headers().location ?? '', f.path).not.toContain(`${f.notice}=state`)
    // … and B's cookie never stands in for A's.
    expect((await call(f.state(a!.id, 'n-a'), f.cookie(b!.id, 'n-a'))).headers().location, f.path).toBe(
      spaNotice,
    )
  }
})
