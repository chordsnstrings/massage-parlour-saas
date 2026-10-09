import { expect, test } from '@playwright/test'
import { en, th } from '@spa/core/i18n'
import { app, base } from './helpers'

// Marketing: the Spa CRM page (docs/PLAN.md §18.5) — EN/TH demo uses the dashboard's real catalogue strings.
test('the Spa CRM page sells the dashboard in English and Thai', async ({ page }) => {
  await page.goto(`${base}/crm`)
  await expect(page).toHaveTitle(/Spa CRM/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The dashboard your whole team uses.')

  await test.step('CTAs point at the application and pricing', async () => {
    const hero = page.locator('.mkt-hero')
    await expect(hero.getByRole('link', { name: 'Apply for your spa' })).toHaveAttribute(
      'href',
      `${app}/signup`,
    )
    await hero.getByRole('link', { name: 'See pricing' }).click()
    await expect(page).toHaveURL(`${base}/pricing`)
    await page.goBack()
  })

  await test.step('the language toggle switches labels to the Thai catalogue; typed names stay', async () => {
    const demo = page.getByTestId('crm-demo')
    await expect(demo).toHaveAttribute('lang', 'en')
    await expect(demo.getByText(en.nav.calendar, { exact: true })).toBeVisible()
    await expect(demo.getByText(en.sales.checkout.total, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'ภาษาไทย' }).click()
    await expect(page.getByRole('button', { name: 'ภาษาไทย' })).toHaveAttribute('aria-pressed', 'true')
    await expect(demo).toHaveAttribute('lang', 'th')
    await expect(demo.getByText(th.nav.calendar, { exact: true })).toBeVisible()
    await expect(demo.getByText(th.overview.upNext.title, { exact: true })).toBeVisible()
    await expect(demo.getByText(th.sales.checkout.total, { exact: true })).toBeVisible()
    await expect(demo.getByText(en.nav.calendar, { exact: true })).toHaveCount(0)
    await expect(demo.getByText('Layla', { exact: true })).toBeVisible()
    await expect(demo.getByText(th.overview.upNext.walkIn, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'English' }).click()
    await expect(demo.getByText(en.nav.calendar, { exact: true })).toBeVisible()
  })

  await test.step('home and features link to the CRM page', async () => {
    for (const path of ['/', '/features']) {
      await page.goto(`${base}${path}`)
      const link = page.locator('main a[href="/crm"]').first()
      await expect(link).toBeVisible()
    }
    await page.locator('main a[href="/crm"]').first().click()
    await expect(page).toHaveURL(`${base}/crm`)
  })

  await test.step('features: built items are in the areas; "Coming next" lists only what is not built', async () => {
    await page.goto(`${base}/features`)
    await expect(page.locator('#bookings')).toContainText('Waitlist for busy days')
    await expect(page.locator('#bookings')).toContainText('Booking widget for the website you already have')
    await expect(page.locator('#team')).toContainText('Staff time clock')
    const next = page.locator('section', { has: page.getByText('Coming next', { exact: true }) })
    await expect(next.getByRole('listitem')).toHaveText(['Reserve with Google'])
  })
})
