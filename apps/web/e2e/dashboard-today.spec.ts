import { expect, type Page, test } from '@playwright/test'
import { addDays, dubaiInstant } from '@spa/core'
import {
  bookings,
  clients,
  members,
  notificationReads,
  notifications,
  roles,
  siteEnquiries,
  user,
} from '@spa/db'
import { createBooking, createNotification, createSale, finishBooking, setBookingStatus } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import {
  app,
  createLogin,
  OWNER_PASSWORD,
  screenshotAt,
  seedCatalog,
  signUpOwner,
  site,
  testDb,
  today,
} from './helpers'

/**
 * R36 (owner 2026-10-21): the dashboard home's "Today's bookings & sales" (every booking of the business day with its
 * sale, plus sales on no booking of that day; chips, totals = the Revenue KPI, next step per row, day arrows) and
 * "From the website" (online bookings to confirm, new enquiries with the Enquiries page's reply / Make booking rules),
 * both refreshing themselves every 30 s; money only with dashboard.revenue or pos.use. Then the CRM pop-up: a website
 * booking / enquiry arriving after the page loaded shows once in the top end corner (Confirm, Open, close, Sound).
 */
type Seed = Awaited<ReturnType<typeof seedCatalog>>
const db = testDb()
const at = (date: string, hm: string) =>
  dubaiInstant(date, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)))

/** A 60-min Swedish massage with Maya in Room 1 for a new client (fee = the list price, AED 350). */
async function book(
  seed: Seed,
  name: string,
  date: string,
  hm: string,
  o: { source?: 'phone' | 'online'; status?: 'confirmed' | 'pending'; commissionAed?: number | null } = {},
) {
  const [client] = await db
    .insert(clients)
    .values({ tenantId: seed.tenantId, name, phoneE164: `97150${Math.floor(1e6 + Math.random() * 8e6)}` })
    .returning()
  return db.transaction((tx) =>
    createBooking(tx, {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      clientId: client!.id,
      source: o.source ?? 'phone',
      status: o.status ?? 'confirmed',
      allowOffShift: true,
      items: [
        {
          serviceVariantId: seed.variantIds[0]!,
          start: at(date, hm),
          staffIds: [seed.staffIds[0]!],
          roomId: seed.roomIds[0]!,
          commissionAed: o.commissionAed === undefined ? 0 : o.commissionAed,
        },
      ],
    }),
  )
}

const enquiry = (seed: Seed, name: string, phone: string, message: string, request = false) =>
  db
    .insert(siteEnquiries)
    .values({
      tenantId: seed.tenantId,
      name,
      phone,
      message,
      locale: 'en',
      page: '',
      booking: request
        ? {
            service: 'Swedish massage',
            serviceId: seed.serviceId,
            durationMin: 60,
            date: addDays(today(), 1),
            time: '18:00',
            guests: 1,
            staff: 'Maya',
            staffId: seed.staffIds[0]!,
          }
        : null,
    })
    .returning()
    .then((r) => r[0]!)

/** Readers of a spa-wide notification (one row per member who read it). */
const readBy = async (id: string) =>
  (await db.select().from(notificationReads).where(eq(notificationReads.notificationId, id))).length

/** Opens and closes the bell menu: the shell is hydrated, so its poll timer is running. */
async function bellAnswers(page: Page) {
  await page.getByTestId('notification-bell').click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
}

const noOverflow = async (page: Page, width: number) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)

test('home: today’s bookings & sales + from the website (owner), money hidden without revenue / POS', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)
  const { slug } = await signUpOwner(page, { spa: 'Lotus Spa' })
  const seed = await seedCatalog(slug)
  const D = today()
  const tomorrow = addDays(D, 1)

  // The business day: paid in cash · finished, not paid · confirmed · pending online · cancelled; a card sale on no
  // booking; tomorrow's booking (day arrows); a website booking request.
  const paid = await book(seed, 'Aisha Karim', D, '10:00')
  const finished = await db.transaction((tx) =>
    finishBooking(tx, {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      bookingId: paid.id,
      clientId: paid.clientId,
      lines: [
        {
          kind: 'service',
          refId: seed.variantIds[0]!,
          description: 'Swedish massage · 60 min',
          qty: 1,
          unitPriceAed: 350,
          staffId: seed.staffIds[0]!,
        },
      ],
      payments: [{ method: 'cash', amountAed: 350 }],
    }),
  )
  const unpaid = await book(seed, 'Huda Saleh', D, '11:30')
  await db.transaction((tx) => setBookingStatus(tx, unpaid.id, 'completed'))
  const confirmed = await book(seed, 'Fatima Noor', D, '13:00')
  const online = await book(seed, 'Noura Haddad', D, '14:30', {
    source: 'online',
    status: 'pending',
    commissionAed: null,
  })
  const cancelled = await book(seed, 'Sara Ali', D, '16:00')
  await db.transaction((tx) => setBookingStatus(tx, cancelled.id, 'cancelled', 'Client called to cancel'))
  const { sale: shop } = await db.transaction((tx) =>
    createSale(tx, {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      lines: [{ kind: 'other', description: 'Aroma oil set', qty: 1, unitPriceAed: 200 }],
      payments: [{ method: 'card_terminal', amountAed: 200 }],
    }),
  )
  const next = await book(seed, 'Mariam Yousef', tomorrow, '12:00')
  const request = await enquiry(seed, 'Layla Test', '+971509876543', 'Strong pressure', true)

  // Reply on WhatsApp opens wa.me in a new tab: answer it locally (no outside call).
  await page.context().route('https://wa.me/**', (r) => r.fulfill({ contentType: 'text/html', body: 'wa' }))
  // The cards poll every 30 s: a controllable clock (it still runs in real time until fast-forwarded).
  await page.clock.install()
  await page.goto(`${app}/${slug}`)
  const card = page.getByTestId('today-orders')
  const row = (key: string) => card.locator(`tr[data-order="${key}"]`)
  const stat = (label: string) => card.locator('.crm-stat', { has: page.getByText(label, { exact: true }) })
  const chip = (label: string, n: number) =>
    card.getByRole('button', { name: new RegExp(`^${label}\\s*${n}$`) })
  const web = page.getByTestId('website-inbox')

  await test.step('every booking of the day with its sale, and the sale on no booking', async () => {
    await expect(card.getByRole('heading', { name: 'Today’s bookings & sales' })).toBeVisible()
    await expect(card.locator('tbody tr')).toHaveCount(6)
    await expect(card.locator(`tr[data-order="b:${next.id}"]`)).toHaveCount(0)
    await expect(row(`b:${paid.id}`)).toHaveAttribute('data-stage', 'paid')
    await expect(row(`b:${paid.id}`)).toContainText('Aisha')
    await expect(row(`b:${paid.id}`)).not.toContainText('Karim')
    await expect(row(`b:${paid.id}`)).toContainText('Cash')
    await expect(row(`b:${paid.id}`).getByRole('link', { name: 'Open sale' })).toHaveAttribute(
      'href',
      new RegExp(`/sales/${finished.sale.id}$`),
    )
    await expect(row(`b:${unpaid.id}`)).toHaveAttribute('data-stage', 'not_paid')
    await expect(row(`b:${unpaid.id}`)).toContainText('Not paid')
    await expect(row(`b:${unpaid.id}`).getByRole('link', { name: 'Take payment' })).toHaveAttribute(
      'href',
      new RegExp(`/bookings/${unpaid.id}$`),
    )
    await expect(row(`b:${confirmed.id}`)).toHaveAttribute('data-stage', 'to_finish')
    await expect(row(`b:${confirmed.id}`)).toContainText('Swedish massage')
    await expect(row(`b:${confirmed.id}`)).toContainText('60 min')
    await expect(row(`b:${confirmed.id}`)).toContainText('Maya')
    await expect(row(`b:${confirmed.id}`).getByRole('link', { name: 'Finish' })).toHaveAttribute(
      'href',
      new RegExp(`/bookings/${confirmed.id}$`),
    )
    const pending = row(`b:${online.id}`)
    await expect(pending).toHaveAttribute('data-stage', 'to_confirm')
    await expect(pending).toContainText('Website')
    await expect(pending).toContainText('Booked online')
    await expect(pending).toContainText('To confirm')
    await expect(pending.getByRole('button', { name: 'Confirm the booking of Noura' })).toBeVisible()
    await expect(row(`b:${cancelled.id}`)).toHaveAttribute('data-stage', 'cancelled')
    await expect(row(`b:${cancelled.id}`)).toContainText('Client called to cancel')
    await expect(row(`b:${cancelled.id}`).getByRole('link')).toHaveCount(0)
    await expect(row(`b:${cancelled.id}`).getByRole('button')).toHaveCount(0)
    const sale = row(`s:${shop.id}`)
    await expect(sale).toHaveAttribute('data-stage', 'paid')
    await expect(sale).toContainText(`Sale #${shop.number}`)
    await expect(sale).toContainText('No booking')
    await expect(sale).toContainText('Aroma oil set')
    await expect(sale).toContainText('AED 200')
    await expect(sale).toContainText('Card')
  })

  await test.step('totals: Paid today = the Revenue KPI, split cash / card', async () => {
    const revenue = page.locator('section', { has: page.getByText('Revenue', { exact: true }) }).first()
    await expect(revenue).toContainText('AED 550')
    await expect(stat('Paid today').locator('.crm-n')).toHaveText('AED 550')
    await expect(stat('Paid today')).toContainText('Cash AED 350 · Card AED 200')
    await expect(stat('Booked').locator('.crm-n')).toHaveText('AED 1,400')
    await expect(stat('Booked')).toContainText('4 bookings')
    await expect(stat('Finished, not paid').locator('.crm-n')).toHaveText('AED 350')
    await expect(stat('Finished, not paid')).toContainText('1 to collect')
    await expect(stat('Still to finish').locator('.crm-n')).toHaveText('AED 700')
    await expect(stat('Still to finish')).toContainText('2 bookings')
  })

  await test.step('filter chips count and filter the rows', async () => {
    await expect(chip('All', 6)).toHaveAttribute('aria-pressed', 'true')
    await expect(chip('To confirm', 1)).toBeVisible()
    await expect(chip('To finish', 1)).toBeVisible()
    await expect(chip('Cancelled', 1)).toBeVisible()
    await chip('Not paid', 1).click()
    await expect(chip('Not paid', 1)).toHaveAttribute('aria-pressed', 'true')
    await expect(card.locator('tbody tr')).toHaveCount(1)
    await expect(row(`b:${unpaid.id}`)).toBeVisible()
    await chip('Paid', 2).click()
    await expect(card.locator('tbody tr')).toHaveCount(2)
    await expect(row(`b:${paid.id}`)).toBeVisible()
    await expect(row(`s:${shop.id}`)).toBeVisible()
    await chip('Cancelled', 1).click()
    await expect(card.locator('tbody tr')).toHaveCount(1)
    await expect(row(`b:${cancelled.id}`)).toBeVisible()
    await chip('All', 6).click()
    await expect(card.locator('tbody tr')).toHaveCount(6)
  })

  await test.step('from the website: the online booking to confirm and the booking request', async () => {
    const item = web.locator(`[data-web-booking="${online.id}"]`)
    await expect(item).toContainText('Noura')
    await expect(item).toContainText('Swedish massage, 60 min')
    await expect(item).toContainText('Today 14:30')
    await expect(item).toContainText('AED 350')
    await expect(item).toContainText('booked ')
    await expect(item.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      new RegExp(`/calendar\\?date=${D}&branch=${seed.branchId}&open=${online.id}$`),
    )
    const e = web.locator(`[data-web-enquiry="${request.id}"]`)
    await expect(e).toContainText('Layla Test')
    await expect(e).toContainText('Booking request')
    await expect(e).toContainText('Strong pressure')
    await expect(e.getByRole('link', { name: 'Make a booking for Layla Test' })).toHaveAttribute(
      'href',
      new RegExp(`/calendar\\?enquiry=${request.id}$`),
    )
    await expect(e.getByRole('link', { name: 'Reply to Layla Test on WhatsApp' })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/971509876543\?text=Hi%20Layla.*thank%20you%20for%20your%20booking%20request%20at/,
    )
    await expect(web.getByRole('link', { name: 'All enquiries' })).toBeVisible()
    // No VAPID key in e2e: the phone-alerts row stays hidden.
    await expect(web.getByText('Phone alerts for website bookings')).toHaveCount(0)
  })

  await screenshotAt(page, 'dashboard-today')

  await test.step('the cards refresh themselves: a new enquiry shows within 30 s, no reload', async () => {
    const reem = await enquiry(seed, 'Reem Odeh', '+971507654321', 'Do you have a slot tonight?')
    await expect(web.locator(`[data-web-enquiry="${reem.id}"]`)).toHaveCount(0)
    // The clock also runs in real time: a check already in flight (read before the insert) can swallow one forwarded
    // tick, so forward again until the card shows it.
    await expect(async () => {
      await page.clock.fastForward('00:31')
      await expect(web.locator(`[data-web-enquiry="${reem.id}"]`)).toContainText(
        'Do you have a slot tonight?',
        {
          timeout: 2000,
        },
      )
    }).toPass()
  })

  await test.step('Reply on WhatsApp (click-to-send) marks the enquiry replied and leaves the card', async () => {
    const popup = page.waitForEvent('popup')
    await web
      .locator(`[data-web-enquiry="${request.id}"]`)
      .getByRole('link', { name: 'Reply to Layla Test on WhatsApp' })
      .click()
    await (await popup).close()
    await expect
      .poll(
        async () =>
          (await db.select().from(siteEnquiries).where(eq(siteEnquiries.id, request.id)))[0]?.status,
      )
      .toBe('replied')
    await expect(web.locator(`[data-web-enquiry="${request.id}"]`)).toHaveCount(0)
  })

  await test.step('inline Confirm (the R32 form): out of To confirm and out of the website card', async () => {
    await row(`b:${online.id}`).getByRole('button', { name: 'Confirm the booking of Noura' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: `Confirm booking ${online.refCode}` })).toBeVisible()
    await expect(sheet.getByLabel('Fee (AED)')).toHaveValue('350')
    await sheet.getByLabel('Commission (AED)').fill('40')
    await sheet.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(sheet).toBeHidden()
    await expect(row(`b:${online.id}`)).toHaveAttribute('data-stage', 'to_finish')
    await expect(chip('To confirm', 0)).toBeVisible()
    await expect(chip('To finish', 2)).toBeVisible()
    await expect(web.locator(`[data-web-booking="${online.id}"]`)).toHaveCount(0)
    await expect(web.getByText('No online bookings waiting.')).toBeVisible()
    const [b] = await db.select().from(bookings).where(eq(bookings.id, online.id))
    expect(b!.status).toBe('confirmed')
  })

  await test.step('day arrows: tomorrow shows its own bookings; Today goes back', async () => {
    await card.getByRole('link', { name: 'Next day' }).click()
    await expect(page).toHaveURL(new RegExp(`[?&]day=${tomorrow}`))
    await expect(card.getByRole('heading', { name: 'Bookings & sales' })).toBeVisible()
    await expect(card.locator('tbody tr')).toHaveCount(1)
    await expect(row(`b:${next.id}`)).toContainText('Mariam')
    await expect(stat('Paid').locator('.crm-n')).toHaveText('AED 0')
    await expect(stat('Booked').locator('.crm-n')).toHaveText('AED 350')
    // The KPI row keeps following the Today / 7 / 30 switch, not the card's day.
    await expect(
      page.locator('section', { has: page.getByText('Revenue', { exact: true }) }).first(),
    ).toContainText('AED 550')
    await card.getByRole('link', { name: 'Today', exact: true }).click()
    await expect(page).not.toHaveURL(/day=/)
    await expect(card.getByRole('heading', { name: 'Today’s bookings & sales' })).toBeVisible()
    await expect(card.locator('tbody tr')).toHaveCount(6)
  })

  await test.step('fits a 360 px phone (the table scrolls inside its box)', async () => {
    await page.setViewportSize({ width: 360, height: 780 })
    await expect(card.locator('tbody tr')).toHaveCount(6)
    await noOverflow(page, 360)
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  await test.step('dashboard.view without dashboard.revenue / pos.use: bookings without money', async () => {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    const email = `viewer-${slug.slice(-8)}@e2e.test`
    await createLogin(p, { name: 'Dashboard viewer', email, password: OWNER_PASSWORD })
    const [role] = await db
      .insert(roles)
      .values({ tenantId: seed.tenantId, key: 'viewer', name: 'Viewer', permissions: ['dashboard.view'] })
      .returning({ id: roles.id })
    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
    await db.insert(members).values({ tenantId: seed.tenantId, userId: u!.id, roleId: role!.id })
    await p.goto(`${app}/${slug}`)
    const c = p.getByTestId('today-orders')
    await expect(c.getByRole('heading', { name: 'Today’s bookings & sales' })).toBeVisible()
    // Booking rows (all five) but no sale-only row, no fee / paid columns, no totals, no actions.
    await expect(c.locator('tbody tr')).toHaveCount(5)
    await expect(c.locator('tr[data-order^="s:"]')).toHaveCount(0)
    await expect(c.locator(`tr[data-order="b:${paid.id}"]`)).toContainText('Aisha')
    await expect(c.getByRole('columnheader', { name: 'Fee' })).toHaveCount(0)
    await expect(c.getByRole('columnheader', { name: 'Paid' })).toHaveCount(0)
    await expect(c.locator('.crm-stat')).toHaveCount(0)
    await expect(c).not.toContainText('AED')
    await expect(c.locator('tbody').getByRole('link')).toHaveCount(0)
    await expect(c.locator('tbody').getByRole('button')).toHaveCount(0)
    // No paid / not-paid state (chips or stages) and no typed notes / cancel reasons (no calendar.view).
    await expect(c.getByRole('button', { name: /^(Not paid|Paid)\s*\d+$/ })).toHaveCount(0)
    await expect(c.locator(`tr[data-order="b:${paid.id}"]`)).not.toHaveAttribute('data-stage')
    await expect(c.locator(`tr[data-order="b:${cancelled.id}"]`)).not.toContainText('Client called to cancel')
    // Neither website section (calendar.manage / clients.view): no card.
    await expect(p.getByTestId('website-inbox')).toHaveCount(0)
    await ctx.close()
  })
})

test('CRM pop-up: a website booking / enquiry arriving later shows once, with Confirm, Open, close and Sound', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)
  const { slug } = await signUpOwner(page, { spa: 'Orchid Spa' })
  const seed = await seedCatalog(slug)
  // Count the chime's notes (WebAudio oscillators) without hearing them.
  await page.addInitScript(() => {
    const w = window as unknown as { __notes: number }
    w.__notes = 0
    const make = AudioContext.prototype.createOscillator
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      w.__notes++
      return make.call(this)
    }
  })
  await page.clock.install()
  // Anywhere in the CRM: the Clients page (not the dashboard home, which also refreshes itself).
  await page.goto(`${app}/${slug}/clients`)
  const stack = page.getByRole('status', { name: 'Website alerts' })
  const toast = page.getByTestId('website-toast')
  await expect(page.getByTestId('notification-bell')).toHaveAccessibleName('Notifications')
  await expect(toast).toHaveCount(0)
  // A click lets the browser start audio (the chime stays silent until then): the bell, once it answers (hydrated).
  await bellAnswers(page)

  await test.step('a visitor books online: the pop-up appears within 30 s, with the chime', async () => {
    const ctx = await browser.newContext()
    const v = await ctx.newPage()
    await v.goto(`${site(slug)}/book`)
    await v
      .getByRole('region', { name: 'Swedish massage' })
      .getByRole('button', { name: /60 min/ })
      .click()
    await v.getByRole('button', { name: /^Tomorrow/ }).click()
    await v.getByTestId('slots').getByRole('button').first().click()
    await v.getByLabel('Your name').fill('Noura Haddad')
    await v.getByLabel('UAE mobile').fill('050 765 4321')
    await v.getByRole('button', { name: 'Request booking' }).click()
    await expect(v.getByRole('heading', { name: 'Booking requested' })).toBeVisible()
    await ctx.close()
    await expect
      .poll(
        async () =>
          (await db.select().from(notifications).where(eq(notifications.tenantId, seed.tenantId))).length,
      )
      .toBe(1)
    // (No "not yet" check here: a real-time bell tick may already have shown it.)
    await page.clock.fastForward('00:31')
    await expect(stack.getByTestId('website-toast')).toHaveCount(1)
    await expect(toast).toContainText('New online booking')
    await expect(toast).toContainText('Noura Haddad · Swedish massage')
    await expect(toast).toContainText('waiting for confirmation')
    await expect(toast.getByRole('button', { name: 'Open' })).toBeVisible()
    await expect(toast.getByRole('button', { name: 'Dismiss' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __notes: number }).__notes)).toBe(2)
    await expect(page.getByTestId('notification-bell')).toHaveAccessibleName('Notifications, 1 unread')
  })

  await screenshotAt(page, 'website-toast')

  await test.step('Sound switch: off and on again, remembered on this device', async () => {
    const sound = toast.getByRole('switch', { name: 'Sound' })
    await expect(sound).toHaveAttribute('aria-checked', 'true')
    await sound.click()
    await expect(sound).toHaveAttribute('aria-checked', 'false')
    expect(await page.evaluate(() => localStorage.getItem('crm.popup.sound'))).toBe('off')
    await sound.click()
    await expect(sound).toHaveAttribute('aria-checked', 'true')
    expect(await page.evaluate(() => localStorage.getItem('crm.popup.sound'))).toBe('on')
  })

  await test.step('shown once: the next poll and a reload do not repeat it', async () => {
    // The next poll (a server action POST on this page) has answered: still one pop-up, no second chime.
    const polled = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/clients'),
    )
    await page.clock.fastForward('00:31')
    await polled
    await expect(toast).toHaveCount(1)
    expect(await page.evaluate(() => (window as unknown as { __notes: number }).__notes)).toBe(2)
    await page.reload()
    await expect(page.getByTestId('notification-bell')).toHaveAccessibleName('Notifications, 1 unread')
    // Hydrated (the 30 s poll runs) before the next alert arrives.
    await bellAnswers(page)
    await expect(toast).toHaveCount(0)
  })

  await test.step('Confirm from the pop-up (R32 form) confirms the booking and reads the alert', async () => {
    const [booking] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.tenantId, seed.tenantId), eq(bookings.source, 'online')))
    // A second online booking (pending) arrives as the front desk would get it.
    const row = await db.transaction((tx) =>
      createNotification(tx, {
        tenantId: seed.tenantId,
        kind: 'booking.online',
        params: {
          name: 'Noura Haddad',
          service: 'Swedish massage',
          at: booking!.startsAt.toISOString(),
          bookingId: booking!.id,
          status: 'pending',
        },
        url: `/${slug}/calendar?date=${booking!.businessDate}`,
        dedupeKey: `e2e.booking.online:${booking!.id}`,
      }),
    )
    await page.clock.fastForward('00:31')
    await expect(toast).toHaveCount(1)
    await toast.getByRole('button', { name: 'Confirm the booking of Noura Haddad' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: `Confirm booking ${booking!.refCode}` })).toBeVisible()
    await expect(sheet.getByLabel('Fee (AED)')).toHaveValue('350')
    await sheet.getByLabel('Commission (AED)').fill('50')
    await sheet.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(sheet).toBeHidden()
    await expect(toast).toContainText('Booking confirmed')
    await expect(toast.getByRole('button', { name: /^Confirm the booking/ })).toHaveCount(0)
    await expect
      .poll(async () => (await db.select().from(bookings).where(eq(bookings.id, booking!.id)))[0]?.status)
      .toBe('confirmed')
    await expect.poll(() => readBy(row!.id)).toBe(1)
    await toast.getByRole('button', { name: 'Dismiss' }).click()
    await expect(toast).toHaveCount(0)
  })

  await test.step('a website enquiry pops up; Open goes to Enquiries and marks it read', async () => {
    const row = await db.transaction((tx) =>
      createNotification(tx, {
        tenantId: seed.tenantId,
        kind: 'enquiry.site',
        params: { name: 'Reem Odeh', message: 'Do you have a slot tonight?' },
        url: `/${slug}/enquiries`,
        dedupeKey: `e2e.enquiry.site:${slug}`,
      }),
    )
    await page.clock.fastForward('00:31')
    await expect(toast).toHaveCount(1)
    await expect(toast).toContainText('New website enquiry')
    await expect(toast).toContainText('Reem Odeh: Do you have a slot tonight?')
    await expect(toast.getByRole('button', { name: /^Confirm/ })).toHaveCount(0)
    await toast.getByRole('button', { name: 'Open' }).click()
    await expect(page).toHaveURL(new RegExp(`/${slug}/enquiries$`))
    await expect(toast).toHaveCount(0)
    await expect.poll(() => readBy(row!.id)).toBe(1)
  })
})
