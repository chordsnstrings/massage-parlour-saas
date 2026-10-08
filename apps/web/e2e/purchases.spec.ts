import { expect, test } from '@playwright/test'
import { app, seedCatalog, signUpOwner } from './helpers'

test('purchases + warehouse: record a mixed purchase into the warehouse, transfer to the branch, void blocked', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page)
  await seedCatalog(slug)
  await page.goto(`${app}/${slug}/inventory`)
  await page.getByRole('button', { name: 'Add product' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Sweet almond oil')
  await page.getByRole('dialog').getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByText('Product added')).toBeVisible()

  await page.goto(`${app}/${slug}/purchases`)
  await expect(page.getByRole('heading', { name: 'Purchases' })).toBeVisible()
  await page.getByRole('button', { name: 'Record purchase' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Supplier').fill('Gulf Spa Supplies')
  await sheet.getByLabel('Category').selectOption('cleaning')
  await sheet.getByLabel('Item 1: stock product').selectOption({ label: 'Sweet almond oil (ml)' })
  await sheet.getByLabel('Quantity ml').fill('2000')
  await sheet.getByLabel('Unit cost (AED, before VAT)').first().fill('0.05')
  await sheet.getByRole('button', { name: 'Add item' }).click()
  await sheet.getByLabel('Item 2: description').fill('Floor cleaner')
  await sheet.getByLabel('Quantity', { exact: false }).nth(1).fill('2')
  await sheet.getByLabel('Unit cost (AED, before VAT)').nth(1).fill('25')
  await sheet.getByRole('button', { name: '5%' }).click()
  await expect(sheet.getByLabel('VAT (AED)')).toHaveValue('7.50')
  await sheet.getByRole('button', { name: 'Save purchase' }).click()
  await expect(page.getByText('Purchase recorded')).toBeVisible()
  await expect(page.getByText('Gulf Spa Supplies').first()).toBeVisible()
  await expect(page.getByText(/157\.50/).first()).toBeVisible()

  await page.goto(`${app}/${slug}/warehouse`)
  await expect(page.getByText('2,000 ml').first()).toBeVisible()
  await page.getByRole('button', { name: 'Transfer' }).first().click()
  await page.getByRole('dialog').getByLabel('Quantity (ml)').fill('1500')
  await page.getByRole('dialog').getByRole('button', { name: 'Transfer' }).click()
  await expect(page.getByText('1500 sent to the branch')).toBeVisible()
  await expect(page.getByText('500 ml').first()).toBeVisible()

  // The received stock has moved on, so the purchase can't be voided until it's back.
  await page.goto(`${app}/${slug}/purchases`)
  await page.getByRole('button', { name: 'Void' }).first().click()
  await page.getByRole('button', { name: /confirm/i }).first().click()
  await expect(page.getByText(/in stock there/)).toBeVisible()
})
