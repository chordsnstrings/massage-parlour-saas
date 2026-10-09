import { expect, test } from '@playwright/test'
import { bookingItems, bookings, members, sales, staff, tips, user } from '@spa/db'
import { recordBookingCommissions } from '@spa/services'
import { eq } from 'drizzle-orm'
import { app, hoursOnToday, seedBooking, seedCatalog, signUpOwner, testDb, today } from './helpers'

// G14: a therapist checks in / starts / completes their own bookings (not others') and sees only their own earnings.
test('therapist: own booking status and "My earnings"', async ({ page, browser }) => {
  test.setTimeout(180_000)
  const { slug } = await signUpOwner(page, { spa: 'Orchid Spa' })
  const seed = await seedCatalog(slug)
  const db = testDb()

  let invite = ''
  await test.step('owner invites a therapist', async () => {
    await page.goto(`${app}/${slug}/team`)
    await page.getByRole('button', { name: 'Invite' }).click()
    await page.getByLabel('Email').fill(`maya-${slug}@e2e.test`)
    await page.getByLabel('Role').selectOption({ label: 'Therapist' })
    await page.getByRole('button', { name: 'Create invitation' }).click()
    const link = page.getByText(/\/invite\//)
    await expect(link).toBeVisible()
    invite = (await link.textContent()) ?? ''
  })

  const ctx = await browser.newContext()
  const tp = await ctx.newPage()
  await tp.goto(invite)
  await tp.getByLabel('Your name').fill('Maya Reyes')
  await tp.getByLabel('Password').fill('therapist-strong-pass')
  await tp.getByRole('button', { name: 'Create account & join' }).click()
  // Therapists are outside the owner/manager 2FA policy: straight to their home.
  await tp.waitForURL(`${app}/${slug}`)

  // Link the account to Maya's staff profile; Maya has one booking, Ploy another.
  const [m] = await db
    .select({ id: members.id })
    .from(members)
    .innerJoin(user, eq(user.id, members.userId))
    .where(eq(user.email, `maya-${slug}@e2e.test`))
  await db.update(staff).set({ memberId: m!.id }).where(eq(staff.id, seed.staffIds[0]!))
  const mine = await seedBooking(seed, hoursOnToday(2))
  const theirs = await seedBooking(seed, hoursOnToday(5))
  await db
    .update(bookingItems)
    .set({ staffIds: [seed.staffIds[1]!] })
    .where(eq(bookingItems.bookingId, theirs.id))

  await test.step('my booking: check in → start → complete; no cancel / reschedule', async () => {
    await tp.goto(`${app}/${slug}/calendar`)
    await tp
      .getByRole('group', { name: 'Maya' })
      .getByRole('button', { name: /Fatima/ })
      .click()
    const sheet = tp.getByRole('dialog')
    await expect(sheet.getByText('Confirmed', { exact: true })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Cancel…' })).toHaveCount(0)
    await expect(sheet.getByRole('button', { name: 'Reschedule' })).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Check in' }).click()
    await expect(sheet.getByText('Checked in', { exact: true })).toBeVisible()
    await sheet.getByRole('button', { name: 'Start service' }).click()
    await expect(sheet.getByText('In service', { exact: true })).toBeVisible()
    await sheet.getByRole('button', { name: 'Complete' }).click()
    await expect(sheet.getByText('Completed', { exact: true })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Check in' })).toHaveCount(0)
    const [row] = await db.select({ s: bookings.status }).from(bookings).where(eq(bookings.id, mine.id))
    expect(row!.s).toBe('completed')
    // Ploy's booking is not on Maya's calendar.
    await expect(tp.getByRole('group', { name: 'Ploy' })).toHaveCount(0)
  })

  await test.step('"My earnings" shows own commission + tips only', async () => {
    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.bookingId, mine.id))
    await db.transaction((tx) =>
      recordBookingCommissions(tx, {
        bookingId: mine.id,
        amounts: [{ bookingItemId: item!.id, staffId: seed.staffIds[0]!, amountAed: 45 }],
      }),
    )
    const [sale] = await db
      .insert(sales)
      .values({
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        number: 9001,
        businessDate: today(),
        subtotalAed: '350',
        totalAed: '370',
        tipsAed: '30',
        status: 'paid',
      })
      .returning()
    await db.insert(tips).values([
      {
        tenantId: seed.tenantId,
        saleId: sale!.id,
        staffId: seed.staffIds[0]!,
        amountAed: '20',
        method: 'cash',
      },
      {
        tenantId: seed.tenantId,
        saleId: sale!.id,
        staffId: seed.staffIds[1]!,
        amountAed: '10',
        method: 'cash',
      },
    ])
    await tp.goto(`${app}/${slug}`)
    await expect(tp.getByRole('heading', { name: 'My earnings' })).toBeVisible()
    // Today, this week and this month all hold the same entries: AED 65 = 45 commission + 20 tips (Ploy's 10 not).
    await expect(tp.getByText(/^Commission AED.45 · Tips AED.20$/)).toHaveCount(3)
    await expect(tp.getByText(/^AED.65$/)).toHaveCount(3)
    // No spa revenue figures on a therapist's home.
    await expect(tp.getByText(/AED\s?370/)).toHaveCount(0)
  })

  await test.step('someone else’s booking stays closed to the therapist', async () => {
    const res = await tp.goto(`${app}/${slug}/bookings/${theirs.id}`)
    expect(res?.status()).toBe(404)
  })
  await ctx.close()
})
