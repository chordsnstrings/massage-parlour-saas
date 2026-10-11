import { expect, type Page, test } from '@playwright/test'
import { auditLog, tenants } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import {
  admin,
  altApp,
  altBase,
  app,
  base,
  PATH,
  PORT,
  signInPlatformAdmin,
  signUpOwner,
  site,
  testDb,
  uniqueSlug,
} from './helpers'

/** Same-host request as the browser would send it (Node can't resolve *.localhost: ask 127.0.0.1 with the Host). */
const viaHost = (page: Page, url: string) => {
  const u = new URL(url)
  return page.request.get(`http://127.0.0.1:${PORT}${u.pathname}${u.search}`, {
    headers: { host: u.host },
    failOnStatusCode: false,
    maxRedirects: 0,
  })
}
const altSite = (slug: string) => (PATH ? `${altBase}/s/${slug}` : `http://${slug}.alt.localhost:${PORT}`)
/** The site's home page (path routing serves it without the trailing slash). */
const home = (slug: string) => (PATH ? site(slug) : `${site(slug)}/`)

// F23: a super-admin renames a spa's address; the old site + dashboard addresses 301 to the new ones (every platform
// domain, path + query kept), the old slug stays reserved to the spa for 12 months, and generated links follow.
test('F23: renaming a spa slug redirects the old site and dashboard addresses (301)', async ({ browser }) => {
  test.slow() // owner + super-admin sign-up, console, site and dashboard in one run (dev server compiles each)
  const ownerCtx = await browser.newContext()
  const adminCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()
  const ops = await adminCtx.newPage()
  const { slug: old } = await signUpOwner(owner, { spa: 'Rename Spa' })
  const next = uniqueSlug('renamed')
  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, old))
  await signInPlatformAdmin(ops)

  await test.step('console: validation like the Apply form, then rename', async () => {
    await ops.goto(`${admin}/tenants/${tenant!.id}`)
    const card = ops.locator('form').filter({ has: ops.getByLabel('New address') })
    await ops.getByLabel('New address').fill('admin')
    await card.getByRole('button', { name: 'Rename' }).click()
    await expect(card.getByText('This name is reserved.')).toBeVisible()
    await ops.getByLabel('New address').fill(next)
    await card.getByRole('button', { name: 'Rename' }).click()
    await expect(ops.getByText(`Address changed to ${next}`)).toBeVisible()
    await ops.reload()
    await expect(ops.getByRole('list', { name: 'Previous addresses' })).toContainText(old)
    await expect(ops.getByRole('list', { name: 'Previous addresses' })).toContainText('reserved until')
    await expect(ops.getByRole('link', { name: 'Website', exact: true })).toHaveAttribute('href', site(next))
    const [row] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, tenant!.id), eq(auditLog.action, 'platform.tenant.slug_renamed')))
    expect(row?.data).toMatchObject({ from: old, to: next })
  })

  await test.step('old site address → 301 to the new one, path + query kept, on both platform domains', async () => {
    for (const [from, to] of [
      [`${site(old)}/book?src=qr&lang=ar`, `${site(next)}/book?src=qr&lang=ar`],
      [home(old), home(next)],
      [`${altSite(old)}/sitemap.xml`, `${altSite(next)}/sitemap.xml`],
    ]) {
      const res = await viaHost(ops, from!)
      expect(res.status(), from).toBe(301)
      // Next sends a same-host Location relative (path routing): compare it resolved.
      expect(new URL(res.headers().location!, from).href).toBe(to)
    }
    // The new address serves the site.
    expect((await viaHost(ops, home(next))).status()).toBe(200)
  })

  await test.step('old dashboard paths → 301 (both domains), the owner lands on the new dashboard', async () => {
    for (const [from, to] of [
      [`${app}/${old}/calendar?date=2026-10-10`, `${app}/${next}/calendar?date=2026-10-10`],
      [`${altApp}/${old}`, `${altApp}/${next}`],
      [`${app}/${old}/app.webmanifest`, `${app}/${next}/app.webmanifest`],
    ]) {
      const res = await viaHost(ops, from!)
      expect(res.status(), from).toBe(301)
      expect(new URL(res.headers().location!, from).href).toBe(to)
    }
    await owner.goto(`${app}/${old}/clients?q=x`)
    await owner.waitForURL(`${app}/${next}/clients?q=x`)
    await expect(owner.getByRole('heading', { name: 'Clients' }).first()).toBeVisible()
    // Generated links use the new slug: the installable app's manifest.
    const manifest = await (await viaHost(owner, `${app}/${next}/app.webmanifest`)).json()
    expect(manifest.start_url).toBe(PATH ? `/app/${next}` : `/${next}`)
  })

  await test.step('host routing: an old path-routed address with the old slug → the current one, one hop', async () => {
    if (PATH) return
    for (const [from, to] of [
      [`${base}/s/${old}/book?src=qr`, `${site(next)}/book?src=qr`],
      [`${altBase}/app/${old}/calendar?date=2026-10-10`, `${app}/${next}/calendar?date=2026-10-10`],
    ]) {
      const res = await viaHost(ops, from!)
      expect(res.status(), from).toBe(301)
      expect(res.headers().location).toBe(to)
    }
    await owner.goto(`${base}/app/${old}/clients?q=y`)
    await owner.waitForURL(`${app}/${next}/clients?q=y`)
    await expect(owner.getByRole('heading', { name: 'Clients' }).first()).toBeVisible()
  })

  await test.step('the old address is reserved: Apply refuses it; Caddy may still issue its certificate', async () => {
    const fresh = await browser.newContext()
    const visitor = await fresh.newPage()
    await visitor.goto(`${app}/signup`)
    await visitor.getByLabel('Web address').fill(old)
    await expect(visitor.getByText('That address is taken.')).toBeVisible()
    await fresh.close()
    if (!PATH) {
      const ask = await ops.request.get(`${base}/api/domains/allowed?domain=${old}.localhost`)
      expect(ask.status()).toBe(200)
      const unknown = await ops.request.get(
        `${base}/api/domains/allowed?domain=${uniqueSlug('nope')}.localhost`,
        {
          failOnStatusCode: false,
        },
      )
      expect(unknown.status()).toBe(404)
    }
  })
  await ownerCtx.close()
  await adminCtx.close()
})
