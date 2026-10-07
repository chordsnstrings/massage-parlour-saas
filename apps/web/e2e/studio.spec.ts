import { expect, type Page, test } from '@playwright/test'
import { admin, app, seedCatalog, signInPlatformAdmin, signUpOwner } from './helpers'

const REQUEST = 'Please use our new rooftop photo on the home page.'

/** The studio lives on the app host; in subdomain mode the super-admin signs in there too. */
async function signInOnApp(page: Page, path: string) {
  const target = `${app}${path}`
  await page.goto(`${app}/login?next=${encodeURIComponent(new URL(target).pathname)}`)
  if (await page.getByLabel('Email').isVisible()) {
    await page.getByLabel('Email').fill('admin@e2e.test')
    await page.getByLabel('Password').fill('platform-admin-pass')
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  // Signing in (or an existing session) redirects to `next`; wait for it rather than racing a second goto.
  await page.waitForURL(target)
}

test('website studio: the spa asks, the super-admin builds and sends for review, the spa approves', async ({
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
    await expect(page.getByRole('cell', { name: new RegExp(REQUEST) })).toBeVisible()
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
    await expect(studio.getByRole('link', { name: 'Edit Home' })).toBeVisible()
    await studio.getByRole('button', { name: 'Resolve' }).click()
    await studio.getByLabel('Note to the spa (optional)').fill('Swapped in.')
    await studio.getByRole('button', { name: 'Close request' }).click()
    await expect(studio.getByText('Studio: Swapped in.').first()).toBeVisible()
    await studio.getByRole('button', { name: 'Send for review' }).click()
    await expect(studio.getByTestId('studio-status').getByText('Ready for review')).toBeVisible()
  })

  await test.step('spa: no editing, approves the review', async () => {
    await page.reload()
    await expect(page.getByTestId('studio-status').getByText('Ready for review')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Edit Home' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await page.getByRole('button', { name: 'Approve website' }).click()
    await expect(page.getByTestId('studio-status').getByText('Approved', { exact: true })).toBeVisible()
  })
})
