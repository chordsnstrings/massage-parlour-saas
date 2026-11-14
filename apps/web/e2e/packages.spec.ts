import { expect, test } from '@playwright/test'
import { app, screenshotAt, seedCatalog, signUpOwner } from './helpers'

test('packages & gifts: create a package, a membership plan and a promo code', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  await seedCatalog(slug)
  await page.goto(`${app}/${slug}/packages`)
  await expect(page.getByRole('heading', { name: 'Packages & gifts' })).toBeVisible()

  await page.getByRole('button', { name: 'New package' }).click()
  await page.getByLabel('Name', { exact: true }).fill('5 × Swedish')
  await page.getByLabel('Treatment 1', { exact: true }).selectOption({ label: 'Swedish massage' })
  await page.getByLabel('Package price (AED, incl. VAT)').fill('1500')
  await page.getByRole('button', { name: 'Create package' }).click()
  await expect(page.getByText('Package created')).toBeVisible()
  await expect(page.getByText('5× Swedish massage')).toBeVisible()
  await screenshotAt(page, 'packages')

  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByText('Paused')).toBeVisible()

  await page.getByRole('link', { name: 'Memberships' }).click()
  await page.getByRole('button', { name: 'New plan' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Monthly wellness')
  await page.getByLabel('Monthly fee (AED, incl. VAT)').fill('450')
  await page.getByRole('button', { name: 'Create plan' }).click()
  await expect(page.getByText('Plan created')).toBeVisible()
  await expect(page.getByText('10% off extras')).toBeVisible()

  await page.getByRole('link', { name: 'Promo codes' }).click()
  await page.getByRole('button', { name: 'New code' }).click()
  await page.getByRole('textbox', { name: 'Code' }).fill('ramadan20')
  await page.getByLabel('Value').fill('120')
  await page.getByRole('button', { name: 'Create code' }).click()
  await expect(page.getByText('At most 100%')).toBeVisible()
  await page.getByLabel('Value').fill('20')
  await page.getByRole('button', { name: 'Create code' }).click()
  await expect(page.getByText('Promo code created')).toBeVisible()
  await expect(page.getByText('RAMADAN20').first()).toBeVisible()

  await page.getByRole('link', { name: 'Gift cards' }).click()
  await expect(page.getByText('No gift cards sold yet')).toBeVisible()
})
