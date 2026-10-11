import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { staff } from '@spa/db'
import { eq } from 'drizzle-orm'
import { app, screenshotAt, seedCatalog, signUpOwner, testDb } from './helpers'

test('payroll: advance, prepare, WPS file, finalise', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  const [maya] = seed.staffIds
  await testDb().update(staff).set({ payType: 'salary', baseSalaryAed: '3000.00' }).where(eq(staff.id, maya!))

  await page.goto(`${app}/${slug}/payroll`)
  await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Advance' }).click()
  await page.getByLabel('Team member').selectOption({ index: 1 })
  await page.getByLabel('Amount (AED)').fill('500')
  await page.getByRole('button', { name: 'Record advance' }).click()
  await expect(page.getByText(/Advance recorded/)).toBeVisible()

  await page.getByRole('button', { name: 'Set up WPS' }).click()
  await page.getByLabel('MOHRE establishment ID').fill('1234567890123')
  await page.getByLabel('Employer bank routing code').fill('803320101')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('WPS details saved')).toBeVisible()

  await expect(page.getByText('Tips & advances payout')).toBeVisible()
  await expect(page.getByText('Not set — receptionists on a booking fee earn nothing yet.')).toBeVisible()

  await page.getByRole('button', { name: 'Prepare payroll' }).click()
  await expect(page.getByText(/Payroll prepared/)).toBeVisible()
  await expect(page.getByText('Draft', { exact: true })).toBeVisible()
  await expect(page.getByText(/AED\s?2,500/).first()).toBeVisible()

  await page.getByRole('button', { name: 'Add IBAN' }).first().click()
  await page.getByLabel('MOHRE person code').fill('10012345678901')
  await page.getByLabel('IBAN').fill('AE07 0331 2345 6789 0123 456')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Pay details saved')).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'WPS file' }).click()
  const d = await download
  expect(d.suggestedFilename()).toMatch(/^1234567890123\d{12}\.SIF$/)
  const sif = readFileSync(await d.path(), 'utf8')
  expect(sif).toContain('EDR,10012345678901,803320101,AE070331234567890123456')
  expect(sif).toMatch(/SCR,1234567890123,803320101,.*,1,2500\.00,AED/)
  await screenshotAt(page, 'payroll')

  await page.getByRole('button', { name: 'Finalise' }).click()
  await expect(page.getByText(/Payroll finalised/)).toBeVisible()
  await expect(page.getByText('Finalised', { exact: true })).toBeVisible()
  await expect(page.getByText('No open advances.')).toBeVisible()
})
