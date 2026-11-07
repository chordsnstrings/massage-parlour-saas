import { expect, type Page, test } from '@playwright/test'
import { admin, app, base, PATH, PORT, site } from './helpers'

/** Same-host request as the browser would send it (Node can't resolve *.localhost: ask 127.0.0.1 with the Host). */
const viaHost = (page: Page, url: string, method: 'GET' | 'HEAD' | 'POST' = 'GET') => {
  const u = new URL(url)
  return page.request.fetch(`http://127.0.0.1:${PORT}${u.pathname}${u.search}`, {
    method,
    headers: {
      host: u.host,
      ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    data: method === 'POST' ? 'a=1' : undefined,
    failOnStatusCode: false,
    maxRedirects: 0,
  })
}
const alt = `http://alt.localhost:${PORT}`
const wwwAlt = `http://www.alt.localhost:${PORT}`

// After the move from path routing to host routing (ROUTING=host): the old path addresses on any platform domain land
// on their host-routed home on the canonical domain (ROOT_DOMAIN). Host routing is the e2e default.
test('old path-routed addresses redirect to the host-routed ones on the canonical domain', async ({
  page,
}) => {
  test.skip(PATH, 'host routing only (path routing still serves these paths)')

  await test.step('GET/HEAD → 301, rest of the path + query kept, from every platform domain + www.', async () => {
    for (const [from, to] of [
      [`${base}/app`, `${app}/`],
      [`${base}/app/login?next=%2Fpilot`, `${app}/login?next=%2Fpilot`],
      [`${alt}/app/some-spa/calendar?date=2026-10-10`, `${app}/some-spa/calendar?date=2026-10-10`],
      [`${base}/admin/tenants?q=x`, `${admin}/tenants?q=x`],
      [`${wwwAlt}/admin`, `${admin}/`],
      [`${base}/s/some-spa`, `http://some-spa.localhost:${PORT}/`],
      [`${alt}/s/some-spa/book?src=qr&lang=ar`, `http://some-spa.localhost:${PORT}/book?src=qr&lang=ar`],
      [`${base}/s/some-spa/book/embed`, `http://some-spa.localhost:${PORT}/book/embed`],
    ]) {
      const res = await viaHost(page, from!)
      expect(res.status(), from).toBe(301)
      expect(res.headers().location, from).toBe(to)
      expect(res.headers()['cache-control'], from).toBe('private, max-age=300')
    }
    const head = await viaHost(page, `${base}/admin/tenants`, 'HEAD')
    expect(head.status()).toBe(301)
    expect(head.headers().location).toBe(`${admin}/tenants`)
  })

  await test.step('other methods → 308 (method + body kept)', async () => {
    const res = await viaHost(page, `${alt}/app/login?x=1`, 'POST')
    expect(res.status()).toBe(308)
    expect(res.headers().location).toBe(`${app}/login?x=1`)
  })

  await test.step('left alone: other paths, non-slugs, API/files/discovery, non-platform hosts', async () => {
    for (const [url, status] of [
      [`${base}/pricing`, 200],
      [`${base}/apps`, 404],
      [`${base}/s`, 404],
      [`${base}/s/www`, 404], // reserved, never a spa
      [`${base}/s/x`, 404],
      [`${base}/api/health`, 200],
      [`${alt}/api/health`, 200],
    ] as const) {
      const res = await viaHost(page, url)
      expect(res.status(), url).toBe(status)
      expect(res.headers().location, url).toBeUndefined()
    }
    for (const url of [
      `${base}/files/00000000-0000-0000-0000-000000000000`,
      `${base}/.well-known/oauth-authorization-server`,
    ])
      expect((await viaHost(page, url)).headers().location, url).toBeUndefined()
    // A spa's custom domain (any non-platform host) never served /app or /s: it keeps its own site routing.
    const custom = await viaHost(page, `http://www.serenityspa-e2e.test:${PORT}/app/some-spa`)
    expect(custom.headers().location).toBeUndefined()
  })

  await test.step('a browser follows an old link to the sign-in page', async () => {
    await page.goto(`${base}/app/login`)
    await page.waitForURL(`${app}/login`)
    await expect(page.getByLabel('Email')).toBeVisible()
  })
})

// R29: an old/extra platform domain (EXTRA_ROOT_DOMAINS; production: the old sslip.io address) → every page 308s to the
// same surface, path + query on the canonical domain, so sign-ins and Meta/Google connects only start there; POSTs
// (forms, server actions), the API, OAuth discovery and Caddy's certificate check keep working on it.
test('R29: pages on an old platform domain redirect to the canonical domain; APIs keep working', async ({
  page,
}) => {
  const altHost = (sub: string) => `http://${sub}alt.localhost:${PORT}`
  await test.step('GET/HEAD → 308, same surface, path + query kept, short cache', async () => {
    const cases: [string, string][] = PATH
      ? [
          [`${alt}/pricing?x=1`, `${base}/pricing?x=1`],
          [`${alt}/app/login?next=%2Fx`, `${app}/login?next=%2Fx`],
          [`${wwwAlt}/admin/tenants`, `${admin}/tenants`],
          [`${alt}/s/some-spa/book?src=qr`, `${site('some-spa')}/book?src=qr`],
        ]
      : [
          [`${alt}/pricing?x=1`, `${base}/pricing?x=1`],
          [`${wwwAlt}/`, `${base}/`],
          [`${altHost('app.')}/login?next=%2Fx`, `${app}/login?next=%2Fx`],
          [
            `${altHost('app.')}/some-spa/settings/integrations?ig=connected`,
            `${app}/some-spa/settings/integrations?ig=connected`,
          ],
          [`${altHost('admin.')}/tenants?q=x`, `${admin}/tenants?q=x`],
          [`${altHost('some-spa.')}/book?src=qr&lang=ar`, `${site('some-spa')}/book?src=qr&lang=ar`],
          [`${altHost('some-spa.')}/book/embed`, `${site('some-spa')}/book/embed`],
        ]
    for (const [from, to] of cases) {
      const res = await viaHost(page, from)
      expect(res.status(), from).toBe(308)
      expect(res.headers().location, from).toBe(to)
      expect(res.headers()['cache-control'], from).toBe('private, max-age=300')
    }
    const head = await viaHost(page, PATH ? `${alt}/admin/tenants` : `${altHost('admin.')}/tenants`, 'HEAD')
    expect(head.status()).toBe(308)
    expect(head.headers().location).toBe(`${admin}/tenants`)
  })

  await test.step('left alone there: POSTs, API, OAuth discovery, files', async () => {
    const dash = PATH ? `${alt}/app` : altHost('app.')
    const api = PATH ? alt : altHost('app.') // API routes live on the app origin (the bare domain under path routing)
    expect((await viaHost(page, `${dash}/login`, 'POST')).headers().location).toBeUndefined()
    for (const url of [
      `${api}/api/auth/get-session`,
      `${api}/api/integrations/meta/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=y`,
      `${api}/.well-known/oauth-authorization-server`,
      `${alt}/api/health`,
      `${alt}/files/00000000-0000-0000-0000-000000000000`,
    ])
      expect((await viaHost(page, url)).headers().location, url).toBeUndefined()
  })

  await test.step("Caddy may still issue the old hosts' certificates (the redirect is served over HTTPS)", async () => {
    for (const host of PATH
      ? ['alt.localhost']
      : ['alt.localhost', 'app.alt.localhost', 'admin.alt.localhost']) {
      const ask = await page.request.get(`${base}/api/domains/allowed?domain=${host}`, {
        failOnStatusCode: false,
      })
      expect(ask.status(), host).toBe(200)
    }
  })

  await test.step('a browser on an old sign-in link ends on the canonical sign-in page', async () => {
    await page.goto(`${PATH ? `${alt}/app` : altHost('app.')}/login`)
    await page.waitForURL(`${app}/login`)
    await expect(page.getByLabel('Email')).toBeVisible()
  })
})
