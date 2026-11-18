import { expect, test } from '@playwright/test'
import { app, screenshotAt, seedCatalog, signUpOwner } from './helpers'

test('inventory: add a consumable, receive stock, link it to a treatment, count it down', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page)
  await seedCatalog(slug)
  await page.goto(`${app}/${slug}/inventory`)
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible()

  await page.getByRole('button', { name: 'Add product' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Sweet almond oil')
  await page.getByLabel('Warn me when stock falls to').fill('500')
  await page.getByRole('dialog').getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByText('Product added')).toBeVisible()

  await page.getByRole('button', { name: 'Receive' }).first().click()
  await page.getByLabel('Quantity (ml)').fill('2000')
  await page.getByLabel('Total paid (AED)').fill('210')
  await page.getByRole('button', { name: 'Receive stock' }).click()
  await expect(page.getByText('Received 2000')).toBeVisible()
  await expect(page.getByText('2,000 ml').first()).toBeVisible()

  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByLabel('Treatment', { exact: true }).selectOption({ index: 1 })
  await page.getByLabel('Product', { exact: true }).selectOption({ index: 1 })
  await page.getByLabel('Amount per treatment').fill('30')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(/Usage saved/)).toBeVisible()
  await expect(page.getByText('30 ml Sweet almond oil')).toBeVisible()

  await page.getByRole('button', { name: 'Count' }).first().click()
  await page.getByLabel('Counted (ml)').fill('400')
  await page.getByRole('button', { name: 'Save count' }).click()
  await expect(page.getByText('Stock reduced by 1600')).toBeVisible()
  await expect(page.getByText('Low', { exact: true }).first()).toBeVisible()
  await screenshotAt(page, 'inventory')
})
