import { expect, type Page, test } from '@playwright/test'
import { auditLog, domains, pageVersions, sitePages, sites, tenants } from '@spa/db'
import { ensureSite, publishAll } from '@spa/services'
import { and, eq, like } from 'drizzle-orm'
import { admin, PATH, PORT, signInPlatformAdmin, signUpOwner, site, studioUrl, testDb } from './helpers'

type Method = 'GET' | 'HEAD' | 'POST'
/** Same-host request as the browser would send it (Node can't resolve *.localhost: ask 127.0.0.1 with the Host). */
const viaHost = (page: Page, url: string, method: Method = 'GET') => {
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
const pageData = (title: string) => ({
  root: { props: { title: { en: title, ar: '' } } },
  content: [{ type: 'Heading', props: { id: 'h-1', text: { en: title, ar: '' }, level: 'h1' } }],
})

// R33: a spa's own redirects (console Websites → spa → Redirects): addresses of the old website → pages of the site,
// a 301 on every public address of the spa; a live page at the same address always wins.
test('R33: redirects send old addresses to the spa’s pages (301, every address, the page wins)', async ({
  browser,
}) => {
  test.slow() // owner sign-up, super-admin console, domain activation
  const ownerCtx = await browser.newContext()
  const { slug } = await signUpOwner(await ownerCtx.newPage(), { spa: 'Redirect Spa' })
  await ownerCtx.close()
  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  await db.transaction(async (tx) => {
    await ensureSite(tx, tenant!.id, {
      key: 'r33',
      name: 'R33',
      theme: {},
      pages: [
        { slug: '', title: { en: 'Home' }, data: pageData('Welcome') },
        { slug: 'new-page', title: { en: 'New page' }, data: pageData('New page') },
        { slug: 'offers', title: { en: 'Offers' }, data: pageData('Offers') },
      ],
    })
    await publishAll(tx, tenant!.id)
  })
  const adminCtx = await browser.newContext()
  const ops = await adminCtx.newPage()
  await signInPlatformAdmin(ops)
  const S = site(slug)
  /** The home page's address with a query (path routing serves it without the trailing slash). */
  const homeQ = (q: string) => (PATH ? `${S}?${q}` : `${S}/?${q}`)

  const redirects = async (from: string, to: string, method: Method = 'GET') => {
    const res = await viaHost(ops, from, method)
    expect(res.status(), `${method} ${from}`).toBe(301)
    expect(res.headers().location, `${method} ${from}`).toBe(to)
    expect(res.headers()['cache-control'], from).toBe('private, max-age=300')
  }
  const served = async (url: string, status = 200) => {
    const res = await viaHost(ops, url)
    expect(res.headers().location, url).toBeUndefined()
    expect(res.status(), url).toBe(status)
    return res
  }
  const rowOf = (from: string) => ops.locator('tr', { hasText: from })
  const addRedirect = async (from: string, to: string) => {
    await ops.getByRole('button', { name: 'Add redirect' }).click()
    const sheet = ops.getByRole('dialog')
    await sheet.getByLabel('Old address').fill(from)
    await sheet.getByLabel('New address').selectOption(to)
    await sheet.getByRole('button', { name: 'Add redirect' }).click()
    return sheet
  }

  await test.step('console: add one (the site’s own routes are refused)', async () => {
    await ops.goto(studioUrl(slug))
    await expect(ops.getByTestId('redirects-card')).toContainText('Send old website addresses')
    await ops.getByRole('link', { name: 'Manage redirects' }).click()
    await expect(ops.getByRole('heading', { name: 'Redirects', exact: true })).toBeVisible()
    const refused = await addRedirect('/book', '/new-page')
    await expect(refused.getByText('/book is used by the site itself (online booking).')).toBeVisible()
    await refused.getByLabel('Old address').fill('/Old-Page/')
    await refused.getByRole('button', { name: 'Add redirect' }).click()
    await expect(ops.getByText('Redirect added')).toBeVisible()
    await expect(rowOf('/old-page')).toContainText('/new-page')
  })

  await test.step('console: import a Search Console list (Preview shows the bad line, then Add)', async () => {
    await ops.getByRole('button', { name: 'Import list' }).click()
    const sheet = ops.getByRole('dialog')
    await sheet
      .getByLabel('Old addresses')
      .fill(
        [
          'URL,Last crawled',
          `${S}/Old-Services/,2026-10-01`,
          `${homeQ('p=12')} /offers`,
          'https://elsewhere.example/page,2026-09-30',
          '/about-us',
        ].join('\n'),
      )
    await sheet.getByRole('button', { name: 'Preview' }).click()
    const preview = sheet.getByTestId('redirect-preview')
    await expect(preview).toContainText('3 redirects to add or change, 1 line skipped')
    await expect(preview.getByTestId('redirect-errors')).toContainText(
      'Line 4: elsewhere.example isn’t one of this spa’s addresses.',
    )
    await sheet.getByRole('button', { name: 'Add 3 redirects' }).click()
    await expect(ops.getByText('3 redirects added, 1 skipped')).toBeVisible()
    await expect(rowOf('/old-services')).toContainText('Imported')
    await expect(rowOf('/?p=12')).toContainText('/offers')
  })

  await test.step('GET/HEAD 301 to the page, short cache, the visitor’s other params kept', async () => {
    await redirects(`${S}/old-page?gclid=1`, `${S}/new-page?gclid=1`)
    await redirects(`${S}/OLD-PAGE`, `${S}/new-page`, 'HEAD')
    // One-column import lines went to the form's default: the home page.
    await redirects(`${S}/old-services?utm_source=g`, homeQ('utm_source=g'))
    // A query rule (WordPress ?p=12): its params are consumed, the rest carried over.
    await redirects(homeQ('p=12&gclid=2'), `${S}/offers?gclid=2`)
    await served(homeQ('p=13'))
  })

  await test.step('a trailing slash: Next’s own 308 first, then the 301', async () => {
    const slash = await viaHost(ops, `${S}/old-page/`)
    expect(slash.status()).toBe(308)
    const next = new URL(slash.headers().location!, `${S}/old-page/`).toString()
    expect(next).toBe(`${S}/old-page`)
    await redirects(next, `${S}/new-page`)
  })

  await test.step('never redirected: other methods, the site’s own routes; the sitemap has no old address', async () => {
    const post = await viaHost(ops, `${S}/old-page`, 'POST')
    expect(post.headers().location).toBeUndefined()
    expect([301, 302, 307, 308]).not.toContain(post.status())
    await served(`${S}/book`)
    await served(`${S}/robots.txt`)
    const xml = await (await served(`${S}/sitemap.xml`)).text()
    expect(xml).toContain('/new-page')
    expect(xml).not.toContain('old-page')
    expect(xml).not.toContain('old-services')
    expect((await viaHost(ops, `${S}/crm-data.json`)).headers().location).toBeUndefined()
  })

  await test.step('a page published at an old address wins (console: inactive; saving it is refused)', async () => {
    const [s] = await db.select().from(sites).where(eq(sites.tenantId, tenant!.id))
    const [about] = await db
      .insert(sitePages)
      .values({ tenantId: tenant!.id, siteId: s!.id, slug: 'about-us', title: { en: 'About us' } })
      .returning()
    await db
      .insert(pageVersions)
      .values({ tenantId: tenant!.id, pageId: about!.id, status: 'published', data: pageData('About us') })
    await ops.reload()
    await expect(rowOf('/about-us')).toContainText('Inactive: a page uses this address')
    const sheet = await addRedirect('/about-us', '/offers')
    await expect(sheet.getByText(/A live page uses this address/)).toBeVisible()
    // A successful save clears the proxy's cache at once (the worker's writes wait for its 30 s TTL).
    await sheet.getByLabel('Old address').fill('/gone-page')
    await sheet.getByRole('button', { name: 'Add redirect' }).click()
    await expect(ops.getByText('Redirect added').first()).toBeVisible()
    const res = await served(`${S}/about-us`)
    expect(await res.text()).toContain('About us')
    await redirects(`${S}/gone-page`, `${S}/offers`)
  })

  const HOST = `${slug}.test`
  const TWIN = `www.${slug}.test`
  const own = (path: string) => `https://${HOST}${path}`
  await test.step('an active own domain: served there; the temporary address and the www twin in one hop', async () => {
    await db
      .insert(domains)
      .values({ tenantId: tenant!.id, hostname: HOST, kind: 'custom', status: 'pending', isPrimary: true })
    // Console → Domains → Activate (clears the web app's domain + redirect caches).
    await ops.goto(`${admin}/domains?q=${HOST}`)
    ops.once('dialog', (d) => d.accept())
    await ops.locator('tr', { hasText: HOST }).getByRole('button', { name: 'Activate' }).click()
    await expect(ops.getByText(`${HOST} activated`)).toBeVisible()
    await redirects(`http://${HOST}/old-page?gclid=3`, `http://${HOST}/new-page?gclid=3`)
    await redirects(`${S}/old-page?gclid=3`, own('/new-page?gclid=3'))
    await redirects(`http://${TWIN}/Old-Page`, own('/new-page'))
    await redirects(`http://${TWIN}/new-page`, own('/new-page'))
    await served(`http://${HOST}/new-page`)
  })

  await test.step('delete → the 404 again; clear all; every change audited', async () => {
    await ops.goto(studioUrl(slug, '/redirects'))
    ops.once('dialog', (d) => d.accept())
    await rowOf('/old-page').getByRole('button', { name: 'Delete redirect /old-page' }).click()
    await expect(ops.getByText('Redirect deleted')).toBeVisible()
    await expect(rowOf('/old-page')).toHaveCount(0)
    await served(`http://${HOST}/old-page`, 404)
    await redirects(`http://${HOST}/old-services`, `http://${HOST}/`)
    ops.once('dialog', (d) => d.accept())
    await ops.getByRole('button', { name: 'Clear all' }).click()
    await expect(ops.getByText('4 redirects deleted')).toBeVisible()
    await served(`http://${HOST}/old-services`, 404)
    const actions = (
      await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, tenant!.id), like(auditLog.action, 'site.redirect%')))
    ).map((a) => a.action)
    expect(new Set(actions)).toEqual(
      new Set([
        'site.redirect.added',
        'site.redirects.imported',
        'site.redirect.deleted',
        'site.redirects.cleared',
      ]),
    )
  })

  await adminCtx.close()
})
