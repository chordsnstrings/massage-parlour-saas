import { expect, type Page, test } from '@playwright/test'
import { bookings, clients, notifications, outbox } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import {
  app,
  hoursOnToday,
  screenshotAt,
  seedBooking,
  seedCatalog,
  signUpOwner,
  site,
  testDb,
  today,
} from './helpers'

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

test('G21: a returning client is auto-confirmed online and gets the WhatsApp confirmation + reminders', async ({
  page,
}) => {
  const { slug, dashboard } = await signUpOwner(page, { spa: 'Juniper Spa' })
  const seed = await seedCatalog(slug)
  const db = testDb()
  // Fatima (050 123 4567) has one completed visit.
  const past = await seedBooking(seed, hoursOnToday(-3))
  await db.update(bookings).set({ status: 'completed' }).where(eq(bookings.id, past.id))

  await test.step('owner turns on "Auto-confirm returning clients" (after 1 visit)', async () => {
    await page.goto(`${dashboard}/settings`)
    const toggle = page.getByRole('switch', { name: 'Auto-confirm returning clients' })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(page.getByLabel('After completed visits')).toHaveValue('1')
    await page.getByRole('button', { name: 'Save online booking' }).click()
    await expect(page.getByText('Online booking settings saved')).toBeVisible()
  })

  await test.step('Fatima books online: confirmed at once, messages queued', async () => {
    await page.goto(`${site(slug)}/book`)
    await page
      .getByRole('region', { name: 'Swedish massage' })
      .getByRole('button', { name: /60 min/ })
      .click()
    await page.getByRole('button', { name: /^Tomorrow/ }).click()
    await page.getByTestId('slots').getByRole('button').first().click()
    await page.getByLabel('Your name').fill('Fatima')
    await page.getByLabel('UAE mobile').fill('050 123 4567')
    await page.getByRole('button', { name: 'Request booking' }).click()
    await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Message us on WhatsApp' })).toBeVisible()
    const ref = (await page.getByTestId('booking-ref').textContent())?.trim() ?? ''
    const [row] = await db
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.tenantId, seed.tenantId), eq(bookings.refCode, ref)))
    expect(row!.status).toBe('confirmed')
    const kinds = (await db.select({ kind: outbox.kind }).from(outbox).where(eq(outbox.bookingId, row!.id)))
      .map((r) => r.kind)
      .sort()
    // The day-before reminder is planned only while its moment is still ahead (tomorrow's first slot).
    expect(kinds).toEqual(expect.arrayContaining(['booking_confirmation', 'reminder_2h']))
  })

  await test.step('a new client still waits for the spa to confirm', async () => {
    await page.goto(`${site(slug)}/book`)
    await page
      .getByRole('region', { name: 'Swedish massage' })
      .getByRole('button', { name: /60 min/ })
      .click()
    await page.getByRole('button', { name: /^Tomorrow/ }).click()
    await page.getByTestId('slots').getByRole('button').last().click()
    await page.getByLabel('Your name').fill('Noura Haddad')
    await page.getByLabel('UAE mobile').fill('050 765 4321')
    await page.getByRole('button', { name: 'Request booking' }).click()
    await expect(page.getByRole('heading', { name: 'Booking requested' })).toBeVisible()
  })
})

/** Service → tomorrow → first free time → details → request; returns the booking ref. */
async function bookTomorrow(page: Page, name: string, phone: string) {
  await page
    .getByRole('region', { name: 'Swedish massage' })
    .getByRole('button', { name: /60 min/ })
    .click()
  await page.getByRole('button', { name: /^Tomorrow/ }).click()
  await page.getByTestId('slots').getByRole('button').first().click()
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('UAE mobile').fill(phone)
  await page.getByRole('button', { name: 'Request booking' }).click()
}

test('F13: a visitor from Instagram (?src=ig) books online; the booking and the KPIs show Instagram', async ({
  page,
}) => {
  const { slug, dashboard } = await signUpOwner(page, { spa: 'Attribution Spa' })
  const seed = await seedCatalog(slug)
  const db = testDb()

  // The Instagram bio link: the tracker keeps the entry for the tab session, the booking page reads it.
  await page.goto(`${site(slug)}/?src=ig`)
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('spa_entry') ?? ''))
    .toContain('"src":"ig"')
  await page.goto(`${site(slug)}/book`)
  await bookTomorrow(page, 'Layla Insta', '050 222 3344')
  await expect(page.getByRole('heading', { name: 'Booking requested' })).toBeVisible()
  const ref = (await page.getByTestId('booking-ref').textContent())?.trim() ?? ''
  const [row] = await db
    .select({ id: bookings.id, source: bookings.source, attribution: bookings.attribution })
    .from(bookings)
    .where(and(eq(bookings.tenantId, seed.tenantId), eq(bookings.refCode, ref)))
  expect(row).toMatchObject({ source: 'online', attribution: 'instagram' })

  await page.goto(`${dashboard}/bookings/${row!.id}`)
  await expect(page.getByText('Online · Instagram')).toBeVisible()

  // Home KPIs end today: move the booking onto today's business date so "Today" counts it.
  await db.update(bookings).set({ businessDate: today() }).where(eq(bookings.id, row!.id))
  await page.goto(dashboard)
  const online = page.getByTestId('online-sources')
  await expect(online).toContainText('Online bookings by website source')
  await expect(online).toContainText('Instagram')
  await expect(online).toContainText('1 · 100%')
})

test('F9: without a Turnstile token (script blocked) the booking is refused and nothing is stored', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  await page.route('https://challenges.cloudflare.com/**', (route) => route.abort())
  await page.goto(`${site(slug)}/book`)
  await bookTomorrow(page, 'Robot Test', '050 999 8877')
  await expect(page.getByText("We couldn't confirm you're not a robot").first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible()
  const rows = await testDb().select().from(bookings).where(eq(bookings.tenantId, seed.tenantId))
  expect(rows).toHaveLength(0)
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
