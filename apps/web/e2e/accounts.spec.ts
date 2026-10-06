import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { app, screenshotAt, signUpOwner } from './helpers'

test('accounts: record an expense, see it in P&L, VAT and journal, void it, close a period', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page)
  await page.goto(`${app}/${slug}/accounts`)
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
  await expect(page.getByText('No expenses this month yet.')).toBeVisible()

  await page.getByRole('navigation', { name: 'Accounts' }).getByRole('link', { name: 'Expenses' }).click()
  await page.getByRole('button', { name: 'Add expense' }).click()
  await page.getByLabel('Amount paid (AED)').fill('10500')
  await page.getByLabel('Category').selectOption({ label: 'Rent' })
  await page.getByLabel('Supplier').fill('Al Barsha Properties')
  await page.getByRole('button', { name: 'Record expense' }).click()
  await expect(page.getByText('Expense recorded')).toBeVisible()
  await expect(page.getByText('Al Barsha Properties').first()).toBeVisible()
  await expect(page.getByText(/AED\s?500/).first()).toBeVisible()
  await screenshotAt(page, 'expenses')

  await page.getByRole('navigation', { name: 'Accounts' }).getByRole('link', { name: 'Overview' }).click()
  const pl = page.locator('section', { has: page.getByRole('heading', { name: 'Profit & loss' }) })
  await expect(pl.getByText('Rent')).toBeVisible()
  await expect(pl.getByText(/-?AED\s?10,000/).first()).toBeVisible()
  await expect(page.getByText('Recoverable input VAT')).toBeVisible()
  await screenshotAt(page, 'accounts')

  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'CSV' }).click()
  const file = await (await download).path()
  expect(readFileSync(file, 'utf8')).toContain('"6100","Rent","10000.00"')

  await page.getByRole('navigation', { name: 'Accounts' }).getByRole('link', { name: 'Journal' }).click()
  await expect(page.getByText('Expense', { exact: true })).toBeVisible()
  await page.goto(`${app}/${slug}/accounts/expenses`)
  await page.getByRole('button', { name: 'Void' }).first().click()
  await page.getByRole('button', { name: 'Confirm void' }).first().click()
  await expect(page.getByText('Expense voided')).toBeVisible()
  await page.goto(`${app}/${slug}/accounts/journal`)
  await expect(page.getByText('Expense voided')).toBeVisible()

  await page.goto(`${app}/${slug}/accounts`)
  const yesterday = new Date(Date.now() + 4 * 3600_000 - 86_400_000).toISOString().slice(0, 10)
  await page.getByLabel('Close through').fill(yesterday)
  await page.getByRole('button', { name: 'Close period' }).click()
  await expect(page.getByText(/Books closed through/)).toBeVisible()
  await expect(page.getByText(/Closed through/)).toBeVisible()
})
