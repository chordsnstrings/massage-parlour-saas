import { expect, type Page, test } from '@playwright/test'
import {
  ADMIN,
  admin,
  app,
  passTwoFactor,
  seedCatalog,
  signInPlatformAdmin,
  signUpOwner,
  site,
} from './helpers'

/** The studio lives on the app host; in subdomain mode the super-admin signs in there too. */
async function signInOnApp(page: Page, path: string) {
  const target = `${app}${path}`
  await page.goto(`${app}/login?next=${encodeURIComponent(new URL(target).pathname)}`)
  if (await page.getByLabel('Email').isVisible()) {
    await page.getByLabel('Email').fill(ADMIN.email)
    await page.getByLabel('Password').fill(ADMIN.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    // Super-admins have 2FA (G3): the sign-in continues on the two-step page, then goes to `next`.
    await page.waitForURL(/\/two-factor/)
    await passTwoFactor(page)
  }
  // Signing in (or an existing session) redirects to `next`; wait for it rather than racing a second goto.
  await page.waitForURL(target)
}

// Owner decision (PLAN §18.1): the super-admin builds and publishes the site; the spa edits only services + prices.
test('website studio: the super-admin builds and publishes; the spa edits only services and prices', async ({
  page,
  browser,
}) => {
  // Two sign-ins, a publish and two public-site renders: more than the default budget on the dev server.
  test.setTimeout(240_000)
  const { slug } = await signUpOwner(page, { spa: 'Linden Spa' })
  await seedCatalog(slug)

  await test.step('spa: the website page is "Services & prices" — no studio tools, no change requests', async () => {
    await page.goto(`${app}/${slug}/website`)
    await expect(page.getByRole('heading', { name: 'Services & prices' })).toBeVisible()
    await expect(page.getByText('Swedish massage')).toBeVisible()
    await expect(page.getByText('60 min · AED 350')).toBeVisible()
    await expect(page.getByRole('link', { name: 'View live site' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Use / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Request a change' })).toHaveCount(0)
    await expect(page.getByTestId('studio-status')).toHaveCount(0)
  })

  const studio = await (await browser.newContext()).newPage()
  let sendForReview: { url: string; headers: Record<string, string>; body: string } | undefined
  await test.step('super-admin: builds the site, sends it for review and publishes', async () => {
    await signInPlatformAdmin(studio)
    await studio.goto(`${admin}/websites`)
    const row = studio.getByRole('row', { name: /Linden Spa/ })
    await expect(row.getByRole('link', { name: 'Open studio for Linden Spa' })).toBeVisible()

    await signInOnApp(studio, `/${slug}/website`)
    await studio.getByRole('button', { name: 'Use Nordic Clean' }).click()
    // Each studio action re-renders the whole website page; on the CI dev server the client can take >10 s to apply it
    // after the server has answered (seen in CI traces), so these steps get the 30 s allowance used for slow site steps.
    await expect(studio.getByRole('link', { name: 'Edit Home' })).toBeVisible({ timeout: 30_000 })
    // Keep the studio-status server action call so the spa can try to replay it below.
    const call = studio.waitForRequest((r) => r.method() === 'POST' && !!r.headers()['next-action'])
    await studio.getByRole('button', { name: 'Send for review' }).click()
    const req = await call
    sendForReview = { url: req.url(), headers: req.headers(), body: req.postData() ?? '' }
    await expect(studio.getByTestId('studio-status').getByText('Ready for review')).toBeVisible({
      timeout: 30_000,
    })
    await studio.getByRole('button', { name: 'Publish site' }).click()
    await studio.getByRole('dialog').getByRole('button', { name: 'Publish now' }).click()
    await expect(studio.getByText('Not published')).toHaveCount(0, { timeout: 30_000 })
  })

  await test.step('spa: calling the approve action directly is rejected server-side', async () => {
    expect(sendForReview?.body).toContain('"review"')
    // From the spa owner's own page (same origin + session; the browser resolves *.localhost, the API client doesn't).
    await page.goto(`${app}/${slug}/website`)
    const text = await page.evaluate(
      async ({ url, action, type, body }) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'next-action': action, 'content-type': type, accept: 'text/x-component' },
          body,
        })
        return r.text()
      },
      {
        url: sendForReview!.url,
        action: sendForReview!.headers['next-action']!,
        type: sendForReview!.headers['content-type'] ?? 'text/plain;charset=UTF-8',
        body: sendForReview!.body.replace('"review"', '"approved"'),
      },
    )
    expect(text).toContain('Only our studio team can change the website design or publish it.')
    await studio.reload()
    await expect(studio.getByTestId('studio-status').getByText('Ready for review')).toBeVisible()
  })

  await test.step('spa: edits a price; the live site shows it without a republish', async () => {
    await page.goto(site(slug))
    await expect(page.getByText('AED 350').first()).toBeVisible()
    await page.goto(`${app}/${slug}/website`)
    await page.getByRole('button', { name: 'Edit Swedish massage' }).click()
    const sheet = page.getByRole('dialog')
    // Menu-only edit: name, description, durations and prices — no operational settings, no delete.
    await expect(sheet.getByLabel('Price 1 (AED)')).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Delete' })).toHaveCount(0)
    await sheet.getByLabel('Price 1 (AED)').fill('375')
    await sheet.getByRole('button', { name: 'Save service' }).click()
    await expect(page.getByText('60 min · AED 375')).toBeVisible({ timeout: 30_000 })
    await page.goto(site(slug))
    await expect(page.getByText('AED 375').first()).toBeVisible()
    await expect(page.getByText('AED 350')).toHaveCount(0)
  })

  await test.step('super-admin: approves the site directly', async () => {
    await studio.getByRole('button', { name: 'Approve', exact: true }).click()
    await studio.getByRole('button', { name: 'Approve website' }).click()
    await expect(studio.getByTestId('studio-status').getByText('Approved', { exact: true })).toBeVisible({
      timeout: 30_000,
    })
  })
})
