import { expect, type Page, test } from '@playwright/test'
import { domains } from '@spa/db'
import { eq } from 'drizzle-orm'
import { admin, app, PATH, PORT, screenshotAt, signUpOwner, testDb } from './helpers'

const HOST = 'www.serenity-test.ae'
/** Requests the dev server as if the browser had come in on the custom domain (host routing only). */
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
  if (!PATH) expect((await viaCustomDomain(page)).status()).toBe(404)
  await screenshotAt(page, 'domains')

  // Super-admin force-activates it.
  const adminContext = await browser.newContext()
  const ap = await adminContext.newPage()
  await ap.goto(`${app}/signup`)
  await ap.getByLabel('Your name').fill('Platform Admin')
  await ap.getByLabel('Work email').fill('admin@e2e.test')
  await ap.getByLabel('Password').fill('platform-admin-pass')
  await ap.getByLabel('Spa name').fill('Admin Test Spa')
  await ap.getByLabel('Web address').fill(`admin-${slug}`)
  await ap.getByRole('button', { name: 'Create account' }).click()
  await ap.waitForURL(`${app}/admin-${slug}`)
  await ap.goto(`${admin}/login`)
  if (!PATH) {
    await ap.getByLabel('Email').fill('admin@e2e.test')
    await ap.getByLabel('Password').fill('platform-admin-pass')
    await ap.getByRole('button', { name: 'Sign in' }).click()
    await expect(ap.getByRole('heading', { name: 'Overview' })).toBeVisible()
  }
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
  if (!PATH) {
    const res = await viaCustomDomain(page)
    expect(res.status()).toBe(200)
    expect(await res.text()).toContain('Serenity Spa')
  }
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
  if (!PATH) expect((await viaCustomDomain(page)).status()).toBe(404)
})
