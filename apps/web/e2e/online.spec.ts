import { expect, test } from '@playwright/test'
import { bookings, clients, notifications } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { app, screenshotAt, seedCatalog, signUpOwner, site, testDb } from './helpers'

test('visitor books online: service → tomorrow → first time → details → pending booking + WhatsApp confirm', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page, { spa: 'Juniper Spa' })
  const seed = await seedCatalog(slug)

  await page.goto(`${site(slug)}/book`)
  await expect(page.getByRole('heading', { name: 'Book a treatment' })).toBeVisible()
  const swedish = page.getByRole('region', { name: 'Swedish massage' })
  await expect(swedish.getByRole('button', { name: /90 min/ })).toBeVisible()
  await screenshotAt(page, 'online-services')

  await swedish.getByRole('button', { name: /60 min.*AED 350/ }).click()
  await page.getByRole('button', { name: /^Tomorrow/ }).click()
  const firstTime = page.getByTestId('slots').getByRole('button').first()
  await expect(firstTime).toBeVisible()
  await screenshotAt(page, 'online')
  const time = (await firstTime.textContent())?.trim()
  await firstTime.click()

  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible()
  await page.getByLabel('Your name').fill('Noura Haddad')
  await page.getByLabel('UAE mobile').fill('050 123 4567')
  await page.getByRole('button', { name: 'Request booking' }).click()

  await expect(page.getByRole('heading', { name: 'Booking requested' })).toBeVisible()
  const ref = (await page.getByTestId('booking-ref').textContent())?.trim() ?? ''
  expect(ref).toMatch(/^[A-Z2-9]{5}$/)
  await expect(page.getByText(time ?? '').first()).toBeVisible()
  const wa = page.getByRole('link', { name: 'Confirm on WhatsApp' })
  await expect(wa).toHaveAttribute('href', new RegExp(`^https://wa\\.me/971501112233\\?text=.*${ref}`))
  await expect(page.getByRole('link', { name: 'Add to calendar' })).toHaveAttribute(
    'href',
    /^data:text\/calendar/,
  )
  await screenshotAt(page, 'online-done')

  const db = testDb()
  const [row] = await db
    .select({ status: bookings.status, source: bookings.source, phone: clients.phoneE164 })
    .from(bookings)
    .innerJoin(clients, eq(clients.id, bookings.clientId))
    .where(and(eq(bookings.tenantId, seed.tenantId), eq(bookings.refCode, ref)))
  expect(row).toEqual({ status: 'pending', source: 'online', phone: '971501234567' })

  // The front desk's bell (PLAN §14.7 B2): the booking arrives as an unread notification with a deep link.
  await expect
    .poll(
      async () =>
        (await db.select().from(notifications).where(eq(notifications.tenantId, seed.tenantId))).length,
    )
    .toBe(1)
  await page.goto(`${app}/${slug}`)
  const bell = page.getByTestId('notification-bell')
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread')
  await bell.click()
  const item = page.getByRole('menuitem', { name: /New online booking.*Noura Haddad.*Swedish massage/ })
  await expect(item).toBeVisible()
  await screenshotAt(page, 'notifications-bell')
  await item.click()
  await expect(page).toHaveURL(/\/calendar\?date=\d{4}-\d{2}-\d{2}$/)
  await expect(bell).toHaveAccessibleName('Notifications')
  await page.goto(`${app}/${slug}/notifications`)
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: /New online booking/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark all as read' })).toHaveCount(0)
})

test('Arabic booking page renders right-to-left', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  await seedCatalog(slug)
  await page.goto(`${site(slug)}/book?lang=ar`)
  await expect(page.getByRole('heading', { name: 'احجز جلستك' })).toBeVisible()
  await expect(page.locator('[dir="rtl"]').first()).toBeVisible()
  await expect(page.getByRole('region', { name: 'مساج سويدي' })).toBeVisible()
  await page.getByRole('region', { name: 'مساج سويدي' }).getByRole('button').first().click()
  await expect(page.getByTestId('slots').or(page.getByText('لا توجد أوقات متاحة'))).toBeVisible()
  await screenshotAt(page, 'online-ar')
})
