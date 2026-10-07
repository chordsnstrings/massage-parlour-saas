import { expect, test } from '@playwright/test'
import { altApp, altBase, app, base, PATH, site, uniqueSlug } from './helpers'

// The platform answers on every configured domain: getting around stays on the domain the visitor is using, while a
// spa's own addresses (its site, invites, campaign links) always use the canonical domain.
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

  await test.step('a trailing-dot host is redirected to the plain domain', async () => {
    const port = new URL(base).port
    const res = await page.request.get(`http://127.0.0.1:${port}/features?x=1`, {
      headers: { host: `alt.localhost.:${port}` },
      maxRedirects: 0,
    })
    expect(res.status()).toBe(308)
    expect(res.headers().location).toBe(`http://alt.localhost:${port}/features?x=1`)
  })

  await test.step('second domain: sign up and land in the dashboard there', async () => {
    const slug = uniqueSlug('alt')
    await page.goto(`${altApp}/signup`)
    // A spa's address lives on the canonical domain, whichever domain it signs up on.
    await expect(
      page.getByText(PATH ? `localhost:${new URL(base).port}/s/` : `.localhost:${new URL(base).port}`, {
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.getByText('alt.localhost')).toHaveCount(0)
    await page.getByLabel('Your name').fill('Noor Haddad')
    await page.getByLabel('Work email').fill(`owner-${slug}@e2e.test`)
    await page.getByLabel('Password').fill('correct-horse-battery')
    await page.getByLabel('Spa name').fill('Alt Domain Spa')
    await page.getByLabel('Web address').fill(slug)
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL(`${altApp}/${slug}`)
    await expect(page.getByRole('link', { name: 'Website' }).first()).toBeVisible()

    // Navigation stays on this domain; the spa's free address is the canonical one.
    await page.goto(`${altApp}/${slug}/settings/domains`)
    await expect(page.getByText(site(slug).replace(/^https?:\/\//, ''), { exact: true })).toBeVisible()
  })
})
