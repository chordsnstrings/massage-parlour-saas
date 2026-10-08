import { expect, test } from '@playwright/test'
import { bookingCommissions } from '@spa/db'
import { eq, sql } from 'drizzle-orm'
import { app, screenshotAt, seedBooking, seedCatalog, signUpOwner, testDb } from './helpers'

// PLAN §14.8 R2: bookings list + detail, Completed needs the therapist commission, re-opening reverses it.
test('bookings: list, complete with commission, re-open', async ({ page }) => {
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
  await page.getByRole('link', { name: 'Bookings', exact: true }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Bookings', exact: true })).toBeVisible()
  await expect(page.getByText('Pending').first()).toBeVisible()
  await page.getByRole('link', { name: booking.refCode }).click()

  await expect(page.getByRole('heading', { name: `Booking ${booking.refCode}` })).toBeVisible()
  await page.getByLabel('Commission for Maya · Swedish massage').fill('40')
  await page.getByRole('button', { name: 'Mark completed' }).click()
  await expect(page.getByText(`Booking ${booking.refCode} completed`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save commission' })).toBeVisible()
  expect(await owed()).toBe(40)
  await screenshotAt(page, 'booking-detail')

  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Mark pending' }).click()
  await expect(page.getByText(`Booking ${booking.refCode} marked Pending`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark completed' })).toBeVisible()
  expect(await owed()).toBe(0)

  await page.goto(`${app}/${slug}/bookings?mark=pending`)
  await expect(page.getByRole('link', { name: booking.refCode })).toBeVisible()
  await page.goto(`${app}/${slug}/bookings?mark=completed`)
  await expect(page.getByText('No bookings match')).toBeVisible()
})
