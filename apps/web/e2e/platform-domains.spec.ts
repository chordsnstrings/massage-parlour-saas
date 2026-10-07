import { expect, test } from '@playwright/test'
import { altApp, altBase, app, base, PATH, uniqueSlug } from './helpers'

// The platform answers on every configured domain, and every link stays on the domain the visitor is using.
test('links and sign-in follow whichever platform domain is used', async ({ page }) => {
  await test.step('canonical domain links to the canonical app', async () => {
    await page.goto(`${base}/features`)
    await expect(page.getByRole('link', { name: 'Sign in' }).first()).toHaveAttribute('href', `${app}/login`)
  })

  await test.step('second domain: marketing pages link to the app on that domain', async () => {
    for (const path of ['/', '/features', '/website-builder', '/pricing', '/contact']) {
      await page.goto(`${altBase}${path}`)
      await expect(page.getByRole('link', { name: 'Sign in' }).first()).toHaveAttribute(
        'href',
        `${altApp}/login`,
      )
      await expect(page.getByRole('link', { name: 'Start', exact: true })).toHaveAttribute(
        'href',
        `${altApp}/signup`,
      )
    }
  })

  await test.step('second domain: sign up and land in the dashboard there', async () => {
    const slug = uniqueSlug('alt')
    await page.goto(`${altApp}/signup`)
    // The address preview uses this domain too.
    await expect(page.getByText(PATH ? `alt.localhost` : `.alt.localhost`).first()).toBeVisible()
    await page.getByLabel('Your name').fill('Noor Haddad')
    await page.getByLabel('Work email').fill(`owner-${slug}@e2e.test`)
    await page.getByLabel('Password').fill('correct-horse-battery')
    await page.getByLabel('Spa name').fill('Alt Domain Spa')
    await page.getByLabel('Web address').fill(slug)
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL(`${altApp}/${slug}`)
    await expect(page.getByRole('link', { name: 'Website' }).first()).toBeVisible()
  })
})
