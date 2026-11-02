import { expect, test } from '@playwright/test'
import { bookingCommissions, bookings, sales } from '@spa/db'
import { eq, sql } from 'drizzle-orm'
import { app, screenshotAt, seedBooking, seedCatalog, signUpOwner, testDb } from './helpers'

// PLAN §14.8 R2 + R32: bookings list + detail; the order's fee + commission are set before Finish & pay, the
// commission posts with the sale, and a checked-out booking can't be re-opened while its sale is live.
test('bookings: list, fee + commission, finish & pay, re-open blocked', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  const booking = await seedBooking(seed)
  const owed = async () =>
    Number(
      (
        await testDb()
          .select({ v: sql<string>`coalesce(sum(${bookingCommissions.amountAed}), 0)` })
          .from(bookingCommissions)
          .where(eq(bookingCommissions.bookingId, booking.id))
      )[0]?.v,
    )

  await page.goto(`${app}/${slug}`)
  await page.getByRole('link', { name: 'Bookings & sales', exact: true }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Bookings & sales', exact: true })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: booking.refCode }).getByText('Pending')).toBeVisible()
  await page.getByRole('link', { name: booking.refCode }).click()

  await test.step('the order: fee + planned commission (off the ledger until Finish)', async () => {
    await expect(page.getByRole('heading', { name: `Booking ${booking.refCode}` })).toBeVisible()
    await expect(page.getByLabel('Fee (AED)')).toHaveValue('350')
    await expect(page.getByLabel('Commission (AED)')).toHaveValue('0')
    await page.getByLabel('Commission (AED)').fill('40')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Fee and commission saved')).toBeVisible()
    expect(await owed()).toBe(0)
  })

  await test.step('Finish & pay = the checkout with the commission prefilled', async () => {
    // R45: Finish & pay opens the pop-up; the full checkout is one link away in it.
    await page.getByRole('button', { name: 'Finish & pay' }).click()
    await page
      .getByRole('dialog')
      .getByRole('link', { name: 'More options (tips, discount, products)' })
      .click()
    await expect(page.getByRole('heading', { name: 'Check out', level: 1 })).toBeVisible()
    await expect(page.getByLabel('Commission for Maya · Swedish massage')).toHaveValue('40')
    await page.getByLabel('Payment 1 amount').fill('350')
    await page.getByRole('button', { name: /Complete sale/ }).click()
    await page.waitForURL(/\/sales\/[0-9a-f-]{36}$/)
    expect(await owed()).toBe(40)
    const [row] = await testDb().select().from(bookings).where(eq(bookings.id, booking.id))
    expect(row!.status).toBe('completed')
  })

  await test.step('the booking shows its sale; re-opening is blocked while the sale is live', async () => {
    await page.goto(`${app}/${slug}/bookings/${booking.id}`)
    await expect(page.getByRole('link', { name: 'Sale #1' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save commission' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Finish & pay' })).toHaveCount(0)
    await screenshotAt(page, 'booking-detail')
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: 'Mark pending' }).click()
    await expect(page.getByText(/checked out — void or refund the sale first/)).toBeVisible()
    expect(await owed()).toBe(40)
  })

  await page.goto(`${app}/${slug}/bookings?mark=completed`)
  await expect(page.getByRole('link', { name: booking.refCode })).toBeVisible()
  await page.goto(`${app}/${slug}/bookings?mark=pending`)
  await expect(page.getByText('No bookings match')).toBeVisible()
})

// R45 (owner 2026-11-02): one "Bookings & sales" page — the payment on every row and Complete & pay in a pop-up
// (the booking's sale + commission in one step), the money of the dates at the top.
test('bookings & sales: complete & pay in the pop-up records the sale', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  const booking = await seedBooking(seed)
  await page.goto(`${app}/${slug}/bookings`)
  await expect(page.getByRole('heading', { level: 1, name: 'Bookings & sales' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Counter sale' })).toBeVisible()
  const row = page.getByRole('row').filter({ hasText: booking.refCode })
  await row.getByRole('button', { name: 'Complete & pay' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByLabel('Price (AED)')).toHaveValue('350')
  await sheet.getByRole('button', { name: 'Card', exact: true }).click()
  await sheet.getByRole('button', { name: 'Save payment' }).click()
  await expect(sheet).toBeHidden()
  await expect(row.getByRole('link', { name: /#1/ })).toContainText('Card terminal')
  await expect(row.getByRole('button', { name: 'Complete & pay' })).toHaveCount(0)
  const [b] = await testDb().select().from(bookings).where(eq(bookings.id, booking.id))
  expect(b!.status).toBe('completed')
  const [sale] = await testDb().select().from(sales).where(eq(sales.bookingId, booking.id))
  expect([sale!.status, sale!.totalAed]).toEqual(['paid', '350.00'])
  await screenshotAt(page, 'bookings-sales')
})
