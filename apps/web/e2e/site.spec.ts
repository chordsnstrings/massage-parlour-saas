import { expect, test } from '@playwright/test'
import { branches, domains, tenants } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import {
  app,
  base,
  makeStudio,
  PATH,
  PORT,
  screenshotAt,
  seedCatalog,
  signUpOwner,
  site,
  testDb,
} from './helpers'

const HERO = 'Calm, clear and restorative.'

test('owner picks a template, publishes from the editor and the public site renders it in EN and AR', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page, { spa: 'Birch Spa' })
  await makeStudio(slug) // the website is built by the studio (super-admin)
  await seedCatalog(slug)

  await test.step('nothing published yet → placeholder site', async () => {
    await page.goto(site(slug))
    await expect(page.getByRole('heading', { name: 'Birch Spa' })).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  })

  await test.step('website overview: choose Nordic Clean', async () => {
    await page.goto(`${app}/${slug}/website`)
    await expect(page.getByRole('heading', { name: 'Choose a template' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Nordic Clean preview' })).toBeAttached()
    await page.getByRole('button', { name: 'Use Nordic Clean' }).click()
    await expect(page.getByRole('link', { name: 'Edit Home' })).toBeVisible()
    await expect(page.getByText('Not published').first()).toBeVisible()
    await screenshotAt(page, 'site-dashboard')
  })

  await test.step('editor shows the page with live data, toggles AR and publishes', async () => {
    await page.getByRole('link', { name: 'Edit Home' }).click()
    await page.waitForURL(/\/website\/editor\//)
    const canvas = page.frameLocator('#preview-frame')
    await expect(canvas.getByRole('heading', { name: HERO })).toBeVisible({ timeout: 30_000 })
    await expect(canvas.getByText('AED 350').first()).toBeVisible()
    await page.screenshot({ path: 'test-results/screens/site-editor-1280.png' })
    await page.getByRole('button', { name: 'Edit Arabic' }).click()
    await expect(canvas.getByRole('heading', { name: 'هدوء وصفاء وتجدد.' })).toBeVisible()
    await page.getByRole('button', { name: 'Edit English' }).click()
    await page.getByRole('button', { name: 'Tablet 768' }).click()
    await expect(canvas.getByRole('heading', { name: HERO })).toBeVisible()
    await page.getByRole('button', { name: 'Desktop 1280' }).click()
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await page.getByRole('button', { name: 'Publish now' }).click()
    await expect(page.getByText('Published — your page is live')).toBeVisible()
    await expect(page.getByText('Live', { exact: true })).toBeVisible()
  })

  await test.step('public site renders the published page with live prices', async () => {
    await page.goto(site(slug))
    await expect(page.getByRole('heading', { name: HERO })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Swedish massage' })).toBeVisible()
    await expect(page.getByText('AED 350').first()).toBeVisible()
    await expect(page.locator('a[href$="/book"]').first()).toBeVisible()
    await expect(page.locator('a[href^="https://wa.me/971501112233"]').first()).toBeAttached()
    // Sections are tagged for block-level analytics.
    await expect(page.locator('[data-block-id][data-block-type="Hero"]').first()).toBeAttached()
    // Scroll through so scroll-driven entrance animations have run before the full-page screenshots.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 30))
      }
      window.scrollTo(0, 0)
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await screenshotAt(page, 'site')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  })

  await test.step('the address opens Google Maps; an exact pin from Settings wins', async () => {
    const address = 'Shop 4, Marina Walk, Dubai'
    await page.goto(`${app}/${slug}/settings`)
    await page.getByLabel('Address', { exact: true }).fill(address)
    // a lookalike host and a Google host outside the allowlist are refused server-side
    for (const bad of ['https://evil.test/maps/place', 'https://www.google.xyz/maps/place/x']) {
      await page.getByLabel('Google Maps link').fill(bad)
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect(page.getByText('Paste a Google Maps link').first()).toBeVisible()
    }
    await page.getByLabel('Google Maps link').fill('')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Settings saved').first()).toBeVisible()

    await page.goto(site(slug))
    const search = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    const link = page.getByRole('link', { name: `${address} (Open in Google Maps)` }).first()
    await expect(link).toHaveAttribute('href', search)
    await expect(link).toHaveAttribute('target', '_blank')

    const pin = 'https://maps.app.goo.gl/BirchSpaPin1'
    await page.goto(`${app}/${slug}/settings`)
    // stored normalized (URL.href), never the raw paste
    await page.getByLabel('Google Maps link').fill('HTTPS://Maps.App.Goo.gl/BirchSpaPin1')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Settings saved').first()).toBeVisible()
    await page.goto(`${site(slug)}?lang=ar`)
    const maps = page.locator('a[data-maps-link]')
    await expect(maps.first()).toHaveAttribute('href', pin)
    await expect(maps.first()).toHaveAttribute('title', 'افتح في خرائط Google')
    for (const href of await maps.evaluateAll((els) => els.map((e) => e.getAttribute('href'))))
      expect(href).toBe(pin)
  })

  await test.step('Arabic renders right-to-left; unpublished pages 404', async () => {
    await page.goto(`${site(slug)}?lang=ar`)
    await expect(page.locator('.site-root')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { name: 'هدوء وصفاء وتجدد.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'مساج سويدي' })).toBeVisible()
    const missing = await page.goto(`${site(slug)}/contact`)
    expect(missing?.status()).toBe(404)
  })

  // F12: robots.txt, sitemap.xml, canonical/hreflang, social cards and schema.org JSON-LD.
  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  // Node can't resolve *.localhost: ask 127.0.0.1 with the URL's host (custom domains answer the same way).
  const fetchAs = (url: string) => {
    const u = new URL(url)
    return page.request.get(`http://127.0.0.1:${PORT}${u.pathname}${u.search}`, {
      headers: { host: u.host },
      failOnStatusCode: false,
    })
  }
  const jsonLd = async () => {
    const raw = await page.locator('script[type="application/ld+json"]').first().textContent()
    // biome-ignore lint/suspicious/noExplicitAny: assertions walk loosely typed JSON-LD
    return JSON.parse(raw ?? '') as { '@context': string; '@graph': Record<string, any>[] }
  }
  const home = PATH ? site(slug) : `${site(slug)}/`

  await test.step('search: robots.txt and sitemap.xml list the published pages with EN/AR alternates', async () => {
    const robots = await (await fetchAs(PATH ? `${base}/robots.txt` : `${site(slug)}/robots.txt`)).text()
    expect(robots).toContain(`Sitemap: ${site(slug)}/sitemap.xml`)
    expect(robots).toContain(PATH ? 'Disallow: /s/*/book/embed' : 'Disallow: /book/embed')
    const res = await fetchAs(`${site(slug)}/sitemap.xml`)
    expect(res.headers()['content-type']).toContain('application/xml')
    const xml = await res.text()
    expect(xml).toContain(`<loc>${home}</loc>`)
    expect(xml).toContain(`<loc>${home}?lang=ar</loc>`)
    expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="ar" href="${home}?lang=ar"/>`)
    expect(xml).toContain(`<loc>${site(slug)}/book</loc>`)
    expect(xml).not.toContain('/contact') // never published
  })

  await test.step('page: canonical, hreflang, social card and valid JSON-LD (spa text cannot break out)', async () => {
    const hostile = 'Shop 4 </script><img src=x onerror="window.__xss=1"> Marina, Dubai'
    await db
      .update(branches)
      .set({ address: hostile, phone: '+971 4 123 4567' })
      .where(eq(branches.tenantId, tenant!.id))
    await page.goto(site(slug))
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', home)
    await expect(page.locator('link[rel="alternate"][hreflang="ar"]')).toHaveAttribute(
      'href',
      `${home}?lang=ar`,
    )
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', home)
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', /summary/)
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0)
    const ld = await jsonLd()
    expect(ld['@context']).toBe('https://schema.org')
    const spa = ld['@graph'][0]!
    expect(spa).toMatchObject({
      '@type': 'DaySpa',
      name: 'Birch Spa',
      url: home,
      telephone: '+971 4 123 4567',
      address: { streetAddress: hostile, addressRegion: 'Dubai', addressCountry: 'AE' },
      hasMap: 'https://maps.app.goo.gl/BirchSpaPin1',
      currenciesAccepted: 'AED',
    })
    expect(spa.sameAs).toContain('https://maps.app.goo.gl/BirchSpaPin1')
    expect(spa.openingHoursSpecification).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        opens: '09:00',
        closes: '23:00',
      },
    ])
    const swedish = spa.hasOfferCatalog.itemListElement.find(
      (o: { itemOffered: { name: string } }) => o.itemOffered.name === 'Swedish massage',
    )
    expect(swedish).toMatchObject({ '@type': 'Offer', priceCurrency: 'AED', price: '350' })
    expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined()
    await expect(page.locator('img[src="x"]')).toHaveCount(0)
  })

  await test.step('custom domain: canonical address everywhere; suspended spas are kept out of search', async () => {
    const custom = `www.${slug}.test`
    await db
      .insert(domains)
      .values({ tenantId: tenant!.id, hostname: custom, kind: 'custom', status: 'active', isPrimary: true })
    try {
      await page.goto(site(slug))
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://${custom}/`)
      expect((await jsonLd())['@graph'][0]!.url).toBe(`https://${custom}/`)
      const robots = await (await fetchAs(`http://${custom}/robots.txt`)).text()
      expect(robots).toContain(`Sitemap: https://${custom}/sitemap.xml`)
      const xml = await (await fetchAs(`http://${custom}/sitemap.xml`)).text()
      expect(xml).toContain(`<loc>https://${custom}/</loc>`)
      expect(xml).toContain(`<loc>https://${custom}/book?lang=ar</loc>`)

      // A second, not-yet-seen host reads the tenant fresh (the host lookup is cached 60 s).
      const second = `shop.${slug}.test`
      await db.update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, tenant!.id))
      await db
        .insert(domains)
        .values({ tenantId: tenant!.id, hostname: second, kind: 'custom', status: 'active' })
      const robotsOff = await (await fetchAs(`http://${second}/robots.txt`)).text()
      expect(robotsOff).not.toContain('Sitemap:')
      expect(await (await fetchAs(`http://${second}/sitemap.xml`)).text()).not.toContain('<url>')
      expect(await (await fetchAs(`http://${second}/`)).text()).toMatch(
        /<meta name="robots" content="noindex, nofollow"/,
      )
    } finally {
      await db.update(tenants).set({ status: tenant!.status }).where(eq(tenants.id, tenant!.id))
      await db.delete(domains).where(and(eq(domains.tenantId, tenant!.id), eq(domains.kind, 'custom')))
    }
  })
})
