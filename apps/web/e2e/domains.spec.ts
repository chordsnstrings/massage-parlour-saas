import { expect, type Page, test } from '@playwright/test'
import { domainOrders, domains, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import { admin, app, PORT, screenshotAt, signInPlatformAdmin, signUpOwner, testDb } from './helpers'

const HOST = 'www.serenity-test.ae'
/** Requests the dev server as if the browser had come in on the custom domain (served in both routing modes). */
const viaCustomDomain = (page: Page) =>
  page.request.get(`http://127.0.0.1:${PORT}/`, { headers: { host: HOST }, failOnStatusCode: false })

test('domains: owner adds a custom domain, support force-activates it, the site answers on it', async ({
  page,
  browser,
}) => {
  const { slug } = await signUpOwner(page)
  await page.goto(`${app}/${slug}/settings/domains`)
  await expect(page.getByRole('heading', { name: 'Domains', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(slug) }).first()).toBeVisible()

  // Add: the input is normalised (scheme, case, path).
  await page.getByLabel('Your domain').fill(`https://WWW.Serenity-Test.ae/booking`)
  await page.getByRole('button', { name: 'Add domain' }).click()
  await expect(page.getByText(`${HOST} added`)).toBeVisible()

  // DNS instructions carry the verification token, zone-relative names and the www/apex note.
  const [row] = await testDb().select().from(domains).where(eq(domains.hostname, HOST))
  expect(row?.status).toBe('pending')
  const card = page.locator('section', { has: page.getByRole('heading', { name: HOST }) })
  await expect(card.getByText(row!.verificationToken!, { exact: true })).toBeVisible()
  await expect(card.getByText('_spamanagement.www', { exact: true })).toBeVisible()
  await expect(card.getByText(`_spamanagement.${HOST}`, { exact: true })).toBeVisible()
  await expect(card.getByText('Also want serenity-test.ae to work?')).toBeVisible()
  await expect(card.getByText('Pending', { exact: true })).toBeVisible()

  // DNS will not resolve here: Check now records a pending status with the reason.
  await card.getByRole('button', { name: 'Check now' }).click()
  await expect(card.getByRole('status')).toContainText(/TXT record|look up/)
  await expect(card.getByText(/Last checked/)).toBeVisible()
  await expect(card.getByText('Pending', { exact: true })).toBeVisible()
  expect((await viaCustomDomain(page)).status()).toBe(404)
  await screenshotAt(page, 'domains')

  // Super-admin force-activates it.
  const adminContext = await browser.newContext()
  const ap = await adminContext.newPage()
  await signInPlatformAdmin(ap)
  await ap.goto(`${admin}/domains`)
  await expect(ap.getByRole('heading', { name: 'Domains', exact: true })).toBeVisible()
  await expect(ap.getByText('Cloudflare for SaaS is not configured yet')).toBeVisible()
  const adminRow = ap.locator('tr', { hasText: HOST })
  await expect(adminRow.getByText('pending', { exact: true })).toBeVisible()
  ap.once('dialog', (d) => d.accept())
  await adminRow.getByRole('button', { name: 'Activate' }).click()
  await expect(ap.getByText(`${HOST} activated`)).toBeVisible()
  await expect(adminRow.getByText('active', { exact: true })).toBeVisible()
  await screenshotAt(ap, 'admin-domains')
  await adminContext.close()

  // The tenant sees it active and primary; the host cache was invalidated so the site answers right away.
  await page.reload()
  await expect(card.getByText('Active', { exact: true })).toBeVisible()
  await expect(card.getByText(/Primary address/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Make primary' })).toBeVisible()
  const res = await viaCustomDomain(page)
  expect(res.status()).toBe(200)
  expect(await res.text()).toContain('Serenity Spa')
  await page.goto(`${app}/${slug}`)
  await expect(page.getByText(HOST).first()).toBeVisible()

  // Back to the free address as primary, then remove the domain.
  await page.goto(`${app}/${slug}/settings/domains`)
  await page.getByRole('button', { name: 'Make primary' }).click()
  await expect(page.getByText('Your free address is primary again')).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await card.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText(`${HOST} removed`)).toBeVisible()
  await expect(page.getByLabel('Your domain')).toBeVisible()
  expect((await viaCustomDomain(page)).status()).toBe(404)
})

test('domains: owner requests a domain to buy, cancels one, support declines the other', async ({
  page,
  browser,
}) => {
  const { slug } = await signUpOwner(page)
  await page.goto(`${app}/${slug}/settings/domains`)
  await expect(page.getByRole('heading', { name: 'Buy a domain' })).toBeVisible()

  // No Namecheap credentials in e2e: search explains purchases aren't on yet.
  await page.getByLabel('Search for a name').fill('serenity spa')
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByText(/Buying domains isn’t switched on yet/)).toBeVisible()

  // Requests (as if made with live prices) show with their status; an open one can be cancelled.
  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const base = { tenantId: tenant!.id, years: 1, priceUsd: '11.28', priceAed: '42.00' }
  await db.insert(domainOrders).values([
    { ...base, domain: `${slug}-one.com` },
    { ...base, domain: `${slug}-two.com` },
  ])
  await page.reload()
  const requests = page.locator('section', { has: page.getByRole('heading', { name: 'Domain requests' }) })
  await expect(requests.getByText('Awaiting approval')).toHaveCount(2)
  await expect(requests.getByText(/AED\s42 for 1 year/).first()).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await requests
    .locator('li', { hasText: `${slug}-one.com` })
    .getByRole('button', { name: 'Cancel' })
    .click()
  await expect(page.getByText(`Request for ${slug}-one.com cancelled`)).toBeVisible()
  await expect(requests.locator('li', { hasText: `${slug}-one.com` }).getByText('Cancelled')).toBeVisible()

  // Super-admin sees the queue (Namecheap not configured) and declines with a reason.
  const adminContext = await browser.newContext()
  const ap = await adminContext.newPage()
  await signInPlatformAdmin(ap)
  await ap.goto(`${admin}/domains`)
  await expect(ap.getByRole('heading', { name: 'Purchase requests' })).toBeVisible()
  await expect(ap.getByText('Namecheap not configured')).toBeVisible()
  const row = ap.locator('tr', { hasText: `${slug}-two.com` })
  await expect(row.getByText('USD 11.28')).toBeVisible()
  ap.once('dialog', (d) => d.accept('Please pick a shorter name'))
  await row.getByRole('button', { name: 'Decline' }).click()
  await expect(ap.getByText(`Declined ${slug}-two.com`)).toBeVisible()
  await expect(row.getByText('rejected', { exact: true })).toBeVisible()
  await screenshotAt(ap, 'admin-domain-orders')
  await adminContext.close()

  await page.reload()
  const two = requests.locator('li', { hasText: `${slug}-two.com` })
  await expect(two.getByText('Declined')).toBeVisible()
  await expect(two.getByText('“Please pick a shorter name”')).toBeVisible()
  await screenshotAt(page, 'domains-buy')
})
