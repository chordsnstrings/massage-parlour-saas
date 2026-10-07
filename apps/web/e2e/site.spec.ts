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
    await expect(page.locator('iframe[title="Nordic Clean preview"]')).toBeAttached()
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

  await test.step('Arabic renders right-to-left; unpublished pages 404', async () => {
    await page.goto(`${site(slug)}?lang=ar`)
    await expect(page.locator('.site-root')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { name: 'هدوء وصفاء وتجدد.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'مساج سويدي' })).toBeVisible()
    const missing = await page.goto(`${site(slug)}/contact`)
    expect(missing?.status()).toBe(404)
  })
})
