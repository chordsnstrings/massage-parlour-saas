import { expect, test } from '@playwright/test'
import { addDays, businessDateOf } from '@spa/core'
import { expenses, staffDocuments, storedFiles, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import { app, screenshotAt, seedCatalog, signUpOwner, testDb } from './helpers'

// 1×1 PNG — stands in for a phone photo of a visa or a receipt.
const png = {
  name: 'scan.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
}

test('engage: document expiry tracker, notifications card, insights card, receipt scan', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  await seedCatalog(slug)
  const dubaiToday = businessDateOf(new Date(), '00:00')

  // Dashboard home: weekly insights card, gracefully off without AI.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Weekly insights' })).toBeVisible()
  await expect(page.getByText(/AI insights aren.t switched on yet/)).toBeVisible()
  await page.getByRole('heading', { name: 'Weekly insights' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/screens/engage-insights.png' })

  // Documents: add Maya's visa expiring in 10 days with a scan → flagged as due within 30 days.
  await page.goto(`${app}/${slug}/documents`)
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible()
  await expect(page.getByText('No documents yet')).toBeVisible()
  await page.getByRole('button', { name: 'Add document' }).first().click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Staff member').selectOption({ label: 'Maya' })
  await sheet.getByLabel('Document', { exact: true }).selectOption({ label: 'Visa / residence permit' })
  await sheet.getByLabel('Number').fill('201/2026/1234567')
  await sheet.getByLabel('Expiry date').fill(addDays(dubaiToday, 10))
  await sheet.getByLabel('Upload scan or photo').setInputFiles(png)
  await expect(sheet.getByText('scan.png')).toBeVisible()
  await sheet.getByRole('button', { name: 'Add document' }).click()
  await expect(page.getByText('Document added')).toBeVisible()
  await expect(page.getByText('Expires in 10 days').first()).toBeVisible()
  await expect(page.getByText('Due in 30 days').first()).toBeVisible()

  // A business document that already expired.
  await page.getByRole('button', { name: 'Add document' }).first().click()
  await sheet.getByRole('button', { name: 'The business' }).click()
  await sheet.getByLabel('Document', { exact: true }).selectOption({ label: 'Trade licence' })
  await sheet.getByLabel('Expiry date').fill(addDays(dubaiToday, -3))
  await sheet.getByRole('button', { name: 'Add document' }).click()
  await expect(page.getByText('Document added')).toBeVisible()
  await expect(page.getByText('Expired 3 days ago').first()).toBeVisible()

  // Status tiles filter; "Belongs to" narrows to one person.
  await page.getByRole('link', { name: /Within 30 days/ }).click()
  await expect(page).toHaveURL(/status=due30/)
  await expect(page.getByText('Trade licence')).toHaveCount(0)
  await page.getByRole('link', { name: 'Clear filters' }).click()
  await expect(page).not.toHaveURL(/status=/)
  await page.getByLabel('Belongs to').selectOption({ label: 'The business' })
  await expect(page).toHaveURL(/who=business/)
  await expect(page.getByText('Visa / residence permit')).toHaveCount(0)
  await expect(page.getByText('Trade licence').first()).toBeVisible()
  await page.getByRole('link', { name: 'Clear filters' }).click()
  await expect(page.getByText('Visa / residence permit').first()).toBeVisible()
  await screenshotAt(page, 'engage')

  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const [visa] = await db.select().from(staffDocuments).where(eq(staffDocuments.tenantId, tenant!.id))
  expect(visa).toMatchObject({ type: 'visa', number: '201/2026/1234567' })
  expect(visa!.fileUrl).toMatch(/^\/files\/[0-9a-f-]{36}$/)

  // Removing the scan (wrong passport attached) clears the link and deletes the stored file.
  const scanId = visa!.fileUrl!.split('/').pop()!
  await page
    .getByRole('row')
    .filter({ hasText: 'Visa / residence permit' })
    .getByRole('button', { name: 'Edit document' })
    .click()
  await sheet.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(sheet.getByText('The file will be deleted when you save.')).toBeVisible()
  await sheet.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Document updated')).toBeVisible()
  const [visaAfter] = await db.select().from(staffDocuments).where(eq(staffDocuments.id, visa!.id))
  expect(visaAfter!.fileUrl).toBeNull()
  expect(await db.select().from(storedFiles).where(eq(storedFiles.id, scanId))).toHaveLength(0)

  // Account page: notifications card in its not-configured state (no VAPID keys in tests).
  await page.goto(`${app}/account`)
  await expect(page.getByRole('heading', { name: 'Notifications on this device' })).toBeVisible()
  await expect(page.getByText('Not set up')).toBeVisible()
  await expect(page.getByText(/Push notifications aren.t set up on this platform yet/)).toBeVisible()
  await page.setViewportSize({ width: 360, height: 780 })
  await page.screenshot({ path: 'test-results/screens/engage-account-360.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 800 })

  // Expenses: "Scan receipt" attaches the photo; without AI it asks for manual details.
  await page.goto(`${app}/${slug}/accounts/expenses`)
  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(sheet.getByRole('button', { name: 'Scan receipt' })).toBeVisible()
  await sheet.getByLabel('Receipt photo').setInputFiles({ ...png, name: 'dewa.png' })
  await expect(sheet.getByText(/Automatic reading isn.t switched on yet/)).toBeVisible()
  await expect(sheet.getByText('dewa.png')).toBeVisible()
  await page.screenshot({ path: 'test-results/screens/engage-receipt.png' })
  await sheet.getByLabel('Amount paid (AED)').fill('525')
  await sheet.getByLabel('Category').selectOption({ label: 'Utilities (DEWA, internet)' })
  await sheet.getByLabel('Supplier').fill('DEWA')
  await sheet.getByRole('button', { name: 'Record expense' }).click()
  await expect(page.getByText('Expense recorded')).toBeVisible()
  await expect(page.getByRole('link', { name: 'View receipt' }).first()).toHaveAttribute('href', /^\/files\//)
  const [expense] = await db.select().from(expenses).where(eq(expenses.tenantId, tenant!.id))
  expect(expense!.receiptUrl).toMatch(/^\/files\/[0-9a-f-]{36}$/)
})
