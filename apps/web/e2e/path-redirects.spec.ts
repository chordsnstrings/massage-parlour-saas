import { expect, type Page, test } from '@playwright/test'
import { admin, app, base, PATH, PORT } from './helpers'

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
