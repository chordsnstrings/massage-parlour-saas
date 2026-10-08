import { expect, test } from '@playwright/test'
import { app, screenshotAt, seedBooking, seedCatalog, signUpOwner } from './helpers'

test('reception checks out a booking with split payment + tip, then closes the day balanced', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  const booking = await seedBooking(seed)

  await test.step('checkout is prefilled from the booking', async () => {
    await page.goto(`${app}/${slug}/sales/new?booking=${booking.id}`)
    await expect(page.getByRole('heading', { name: 'Check out', level: 1 })).toBeVisible()
    await expect(page.getByText('Fatima Al Mansoori')).toBeVisible()
    await expect(page.getByText('Swedish massage · 60 min').first()).toBeVisible()
    await expect(page.getByLabel('Therapist for item 1')).toHaveValue(seed.staffIds[0]!)
    await expect(page.getByTestId('sale-total')).toHaveText(/350/)
    await screenshotAt(page, 'pos-checkout')
  })

  await test.step('AED 200 cash + the rest on the card terminal, AED 20 tip for Maya', async () => {
    await page.getByLabel('Payment 1 method').selectOption('cash')
    await page.getByLabel('Payment 1 amount').fill('200')
    await expect(page.getByTestId('remaining')).toHaveText(/150/)
    await page.getByRole('button', { name: 'Split payment' }).click()
    await expect(page.getByLabel('Payment 2 method')).toHaveValue('card_terminal')
    await expect(page.getByLabel('Payment 2 amount')).toHaveValue('150')
    await expect(page.getByTestId('remaining')).toHaveText(/AED\s*0/)
    await page.getByRole('button', { name: 'Add tip' }).click()
    await expect(page.getByLabel('Tip 1 therapist')).toHaveValue(seed.staffIds[0]!)
    await page.getByLabel('Tip 1 amount').fill('20')
    await page.getByRole('button', { name: /Complete sale/ }).click()
    await page.waitForURL(/\/sales\/[0-9a-f-]{36}$/)
  })

  await test.step('the receipt is a simplified tax invoice with payments, tip and WhatsApp share', async () => {
    await expect(page.getByRole('heading', { name: 'Sale #1', level: 1 })).toBeVisible()
    const receipt = page.locator('#receipt')
    await expect(receipt.getByText('Simplified tax invoice')).toBeVisible()
    await expect(receipt.getByText('Serenity Spa', { exact: true }).first()).toBeVisible()
    await expect(receipt.getByText('VAT 5% included')).toBeVisible()
    await expect(receipt.getByText('Cash', { exact: true })).toBeVisible()
    await expect(receipt.getByText('Card terminal', { exact: true })).toBeVisible()
    await expect(receipt.getByText('Maya · Cash')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute(
      'href',
      /wa\.me\/971501234567\?text=/,
    )
  })

  await test.step('refund by line: pick the quantity, see the total, record it', async () => {
    await page.getByRole('button', { name: 'Refund', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Record a refund' })
    const qty = sheet.getByLabel(/^Refund quantity for Swedish massage/)
    await expect(sheet.getByText(/1 of 1 refundable · AED\s*350 each/)).toBeVisible()
    await expect(sheet.getByTestId('refund-total')).toHaveText(/AED\s*0/)
    await qty.fill('1')
    await expect(sheet.getByTestId('refund-total')).toHaveText(/AED\s*350/)
    // Card back to the terminal so the cash count below is unchanged.
    await sheet.getByLabel('Paid back by').selectOption('card_terminal')
    await sheet.getByLabel('Reason').fill('Client felt unwell')
    await sheet.getByRole('button', { name: 'Record refund' }).click()
    const receipt = page.locator('#receipt')
    await expect(receipt.getByText(/Card terminal · Client felt unwell/)).toBeVisible()
    await expect(receipt.getByText('Refunded', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refund', exact: true })).toHaveCount(0)
  })

  await test.step('sales list shows today’s totals', async () => {
    await page.goto(`${app}/${slug}/sales`)
    await expect(page.getByRole('heading', { name: 'Sales', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: /#1 Fatima Al Mansoori/ }).first()).toBeVisible()
    await screenshotAt(page, 'pos')
  })

  await test.step('daily close: float 100 + cash 200 + cash tip 20 → count 320, zero variance', async () => {
    await page.getByRole('link', { name: 'Daily close' }).click()
    await expect(page.getByRole('heading', { name: 'Daily close', level: 1 })).toBeVisible()
    await page.getByLabel('Opening float (AED)').fill('100')
    await expect(page.getByTestId('expected-cash')).toHaveText(/320/)
    await page.getByLabel('Counted cash (AED)').fill('310')
    await expect(page.getByTestId('variance')).toHaveText(/−AED\s*10/)
    await page.getByLabel('Counted cash (AED)').fill('320')
    await expect(page.getByTestId('variance')).toHaveText(/^AED\s*0$/)
    await screenshotAt(page, 'pos-close')
    await page.getByRole('button', { name: 'Close the day' }).click()
    await expect(page.getByRole('heading', { name: 'Day closed' })).toBeVisible()
    await expect(page.getByText('Balanced').first()).toBeVisible()
  })
})
