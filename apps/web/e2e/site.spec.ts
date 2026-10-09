import { expect, test } from '@playwright/test'
import { app, makeStudio, screenshotAt, seedCatalog, signUpOwner, site } from './helpers'

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
})
