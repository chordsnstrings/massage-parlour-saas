import { expect, type Page, test } from '@playwright/test'
import { ADMIN, admin, app, passTwoFactor, seedCatalog, signInPlatformAdmin, signUpOwner } from './helpers'

const REQUEST = 'Please use our new rooftop photo on the home page.'

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

test('website studio: the spa asks, the super-admin builds, sends for review and approves', async ({
  page,
  browser,
}) => {
  const { slug } = await signUpOwner(page, { spa: 'Linden Spa' })
  await seedCatalog(slug)

  await test.step('spa: read-only website page, sends the studio a request', async () => {
    await page.goto(`${app}/${slug}/website`)
    await expect(page.getByText('Our studio is crafting your website')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Use / })).toHaveCount(0)
    await page.getByRole('button', { name: 'Request a change' }).click()
    await page.getByLabel('What should change?').fill(REQUEST)
    await page.getByRole('button', { name: 'Send to studio' }).click()
    await expect(page.getByText(REQUEST)).toBeVisible()
  })

  const studio = await (await browser.newContext()).newPage()
  await test.step('super-admin: Websites lists the open request; the studio builds the site', async () => {
    await signInPlatformAdmin(studio)
    await studio.goto(`${admin}/websites`)
    const row = studio.getByRole('row', { name: /Linden Spa/ })
    await expect(row.getByText('1 open')).toBeVisible()
    await expect(row.getByRole('link', { name: 'Open studio for Linden Spa' })).toBeVisible()

    await signInOnApp(studio, `/${slug}/website`)
    await studio.getByRole('button', { name: 'Use Nordic Clean' }).click()
    // Each studio action re-renders the whole website page; on the CI dev server the client can take >10 s to apply it
    // after the server has answered (seen in CI traces), so these steps get the 30 s allowance used for slow site steps.
    await expect(studio.getByRole('link', { name: 'Edit Home' })).toBeVisible({ timeout: 30_000 })
    await studio.getByRole('button', { name: 'Resolve' }).click()
    await studio.getByLabel('Note to the spa (optional)').fill('Swapped in.')
    await studio.getByRole('button', { name: 'Close request' }).click()
    await expect(studio.getByText('Studio: Swapped in.').first()).toBeVisible({ timeout: 30_000 })
    await studio.getByRole('button', { name: 'Send for review' }).click()
    await expect(studio.getByTestId('studio-status').getByText('Ready for review')).toBeVisible({
      timeout: 30_000,
    })
  })

  await test.step('spa: no editing and no approving — it can only ask for changes', async () => {
    await page.reload()
    await expect(page.getByTestId('studio-status').getByText('Ready for review')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Edit Home' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Request a change' })).toBeVisible()
  })

  await test.step('super-admin: approves the site', async () => {
    await studio.reload()
    await studio.getByRole('button', { name: 'Approve', exact: true }).click()
    await studio.getByRole('button', { name: 'Approve website' }).click()
    await expect(studio.getByTestId('studio-status').getByText('Approved', { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await page.reload()
    await expect(page.getByTestId('studio-status').getByText('Approved', { exact: true })).toBeVisible()
  })
})
