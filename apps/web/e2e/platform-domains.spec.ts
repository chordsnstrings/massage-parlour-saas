import { expect, test } from '@playwright/test'
import { platformSettings } from '@spa/db'
import {
  altApp,
  altBase,
  app,
  applyForSpa,
  approveApplication,
  base,
  enableTotp,
  enrolUrl,
  PATH,
  PORT,
  site,
  testDb,
  uniqueSlug,
} from './helpers'

// The platform answers on every configured domain: getting around stays on the domain the visitor is using, while a
// spa's own addresses (its site, invites, campaign links) always use the canonical domain.
test('links and sign-in follow whichever platform domain is used', async ({ page }) => {
  await test.step('canonical domain links to the canonical app', async () => {
    await page.goto(`${base}/features`)
    await expect(page.getByRole('link', { name: 'Sign in' }).first()).toHaveAttribute('href', `${app}/login`)
  })

  await test.step('legal pages load and are linked from the footer and sign-in', async () => {
    for (const [path, title] of [
      ['/privacy', 'Privacy policy'],
      ['/terms', 'Terms of service'],
      ['/data-deletion', 'Delete your data'],
    ] as const) {
      await page.goto(`${base}${path}`)
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    }
    const foot = page.locator('footer')
    for (const [name, href] of [
      ['Privacy', '/privacy'],
      ['Terms', '/terms'],
      ['Data deletion', '/data-deletion'],
    ] as const)
      await expect(foot.getByRole('link', { name, exact: true })).toHaveAttribute('href', href)
    await page.goto(`${app}/login`)
    await expect(page.getByRole('link', { name: 'Privacy', exact: true })).toHaveAttribute(
      'href',
      `${base}/privacy`,
    )
  })

  await test.step('footer: five columns, every link answers 200 and every #anchor exists', async () => {
    await page.goto(`${base}/`)
    const nav = page.getByRole('navigation', { name: 'Footer' })
    await expect(nav.getByRole('heading', { level: 2 })).toHaveText([
      'Product',
      'Features',
      'Website studio',
      'Built for the UAE',
      'Company',
    ])
    await expect(page.locator('footer')).toContainText(
      `© ${new Date().getFullYear()} 1997labs · spamanagement.co`,
    )
    const hrefs = await nav
      .getByRole('link')
      .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))
    expect(hrefs.length).toBeGreaterThanOrEqual(25)
    const [settings] = await testDb().select().from(platformSettings).limit(1)
    expect(hrefs.filter((h) => h.startsWith('mailto:'))).toEqual([
      `mailto:${settings?.email || 'ask@spamanagement.co'}`,
    ])
    expect(hrefs).toContain(`${app}/signup`)
    const anchors = new Map<string, Set<string>>()
    for (const href of hrefs.filter((h) => !h.startsWith('mailto:'))) {
      const u = new URL(href)
      const url = `${u.origin}${u.pathname}`
      if (!anchors.has(url)) anchors.set(url, new Set())
      if (u.hash) anchors.get(url)?.add(u.hash.slice(1))
    }
    for (const [url, ids] of anchors) {
      // Node can't resolve *.localhost, so ask 127.0.0.1 with the link's host (no redirects: each link lands as is).
      const u = new URL(url)
      const res = await page.request.get(`http://127.0.0.1:${PORT}${u.pathname}`, {
        headers: { host: u.host },
        maxRedirects: 0,
        failOnStatusCode: false,
      })
      expect(res.status(), url).toBe(200)
      if (!ids.size) continue
      await page.goto(url)
      for (const id of ids) await expect(page.locator(`[id="${id}"]`), `${url}#${id}`).toHaveCount(1)
    }
  })

  await test.step('second domain: marketing pages link to the app on that domain', async () => {
    for (const path of ['/', '/features', '/crm', '/website-builder', '/pricing', '/contact']) {
      await page.goto(`${altBase}${path}`)
      await expect(page.getByRole('link', { name: 'Sign in' }).first()).toHaveAttribute(
        'href',
        `${altApp}/login`,
      )
      await expect(page.getByRole('link', { name: 'Get started', exact: true })).toHaveAttribute(
        'href',
        `${altApp}/signup`,
      )
    }
  })

  await test.step('a trailing-dot host is redirected to the plain domain', async () => {
    const port = new URL(base).port
    const res = await page.request.get(`http://127.0.0.1:${port}/features?x=1`, {
      headers: { host: `alt.localhost.:${port}` },
      maxRedirects: 0,
    })
    expect(res.status()).toBe(308)
    expect(res.headers().location).toBe(`http://alt.localhost:${port}/features?x=1`)
  })

  await test.step('second domain: apply, get accepted and land in the dashboard there', async () => {
    const slug = uniqueSlug('alt')
    await page.goto(`${altApp}/signup`)
    // A spa's address lives on the canonical domain, whichever domain it signs up on.
    await expect(
      page.getByText(PATH ? `localhost:${new URL(base).port}/s/` : `.localhost:${new URL(base).port}`, {
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.getByText('alt.localhost')).toHaveCount(0)
    // Apply on this domain (the waiting page stays here too), then the owner accepts.
    const email = `owner-${slug}@e2e.test`
    await applyForSpa(page, { slug, email, name: 'Noor Haddad', spa: 'Alt Domain Spa', base: altApp })
    await approveApplication(email)
    // G23: the owner is asked to enrol 2FA first — on this domain too.
    await page.goto(`${altApp}/${slug}`)
    await page.waitForURL((u) => u.href.startsWith(altApp) && enrolUrl(slug).test(u.href))
    await enableTotp(`owner-${slug}@e2e.test`)
    await page.goto(`${altApp}/${slug}`)
    await page.waitForURL(`${altApp}/${slug}`)
    await expect(page.getByRole('link', { name: 'Website' }).first()).toBeVisible()

    // Navigation stays on this domain; the spa's free address is the canonical one.
    await page.goto(`${altApp}/${slug}/settings/domains`)
    await expect(page.getByText(site(slug).replace(/^https?:\/\//, ''), { exact: true })).toBeVisible()
  })
})
