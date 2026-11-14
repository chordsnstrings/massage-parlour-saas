import { expect, test } from '@playwright/test'
import { addDays, dubaiInstant } from '@spa/core'
import { auditLog, bookings, branches, siteEnquiries } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { app, seedCatalog, signUpOwner, testDb, today } from './helpers'

/**
 * Owner 2026-10-13 ("Inbox button only"): a website booking request (R26 design form → site_enquiries.booking) is
 * booked without retyping it. Enquiries → Make booking opens the calendar's New booking prefilled (client, service,
 * length, therapist, date, time, notes); the normal save links it back ("Booked"), and Reply on WhatsApp confirms it.
 * A small-hours time offered under the night before (open 11:00–02:00) is booked on the next calendar day.
 */
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

test('Enquiries → Make booking: a website booking request becomes a booking in the calendar', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  const db = testDb()
  await db
    .update(branches)
    .set({ openingHours: Object.fromEntries(DAYS.map((d) => [d, [{ open: '11:00', close: '02:00' }]])) })
    .where(eq(branches.id, seed.branchId))
  // Tomorrow night at 00:30, as the design sends it: the night's date (stored before the flag: computed).
  const night = addDays(today(), 1)
  const next = addDays(night, 1)
  const [maya] = seed.staffIds
  const [sixty] = seed.variantIds
  const [request] = await db
    .insert(siteEnquiries)
    .values({
      tenantId: seed.tenantId,
      name: 'Layla Test',
      phone: '+971509876543',
      message: 'Strong pressure',
      locale: 'en',
      page: '',
      booking: {
        service: 'Swedish massage',
        serviceId: seed.serviceId,
        durationMin: 60,
        date: night,
        time: '00:30',
        guests: 2,
        staff: 'Maya',
        staffId: maya!,
      },
    })
    .returning()
  const row = () => page.getByRole('row').filter({ hasText: 'Layla Test' })
  const reply = async () =>
    decodeURIComponent(
      (await row()
        .getByRole('link', { name: /Reply to Layla Test/ })
        .getAttribute('href'))!,
    )

  await test.step('the inbox shows the night and the request reply names it', async () => {
    await page.goto(`${app}/${slug}/enquiries`)
    await expect(
      row().getByText(
        /Swedish massage · 60 min · 2 guests · .+ night · 00:30 \(after midnight, .+\) · with Maya/,
      ),
    ).toBeVisible()
    expect(await reply()).toContain('thank you for your booking request at')
    expect(await reply()).toContain(`on the night of ${night} at 00:30 (after midnight, ${next})`)
  })

  await test.step('Make booking → New booking prefilled on the right day', async () => {
    await row().getByRole('link', { name: 'Make a booking for Layla Test' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'New booking' })).toBeVisible({ timeout: 30_000 })
    // The night's business date (cutoff 05:00); the URL drops ?enquiry= so a reload doesn't reopen it.
    await expect(page).toHaveURL(new RegExp(`/calendar\\?date=${night}`))
    await expect(sheet.getByLabel('Name')).toHaveValue('Layla Test')
    await expect(sheet.getByLabel('Mobile (WhatsApp)')).toHaveValue('+971509876543')
    await expect(sheet.getByLabel('Service')).toHaveValue(sixty!)
    await expect(sheet.getByLabel('Time')).toHaveValue('00:30')
    await expect(sheet.getByLabel('Therapist')).toHaveValue(maya!)
    // A request came from the spa's website: Website, recorded as a website booking (2026-10-13).
    await expect(sheet.getByLabel('Source')).toHaveValue('online')
    await expect(sheet.getByLabel('Notes')).toHaveValue('Website booking request · 2 guests\nStrong pressure')
  })

  await test.step('the normal save books it on the next calendar day and links the request', async () => {
    const sheet = page.getByRole('dialog')
    // R32: the fee is prefilled from the list price; reception types the therapist's commission.
    await expect(sheet.getByLabel('Fee (AED)')).toHaveValue('350')
    await sheet.getByLabel('Commission (AED)').fill('40')
    await sheet.getByRole('button', { name: 'Create booking' }).click()
    await expect(sheet.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible()
    const [enquiry] = await db.select().from(siteEnquiries).where(eq(siteEnquiries.id, request!.id))
    expect(enquiry!.booking?.bookingId).toBeTruthy()
    const [made] = await db.select().from(bookings).where(eq(bookings.id, enquiry!.booking!.bookingId!))
    expect(made).toMatchObject({
      source: 'online',
      attribution: 'website',
      businessDate: night,
      status: 'confirmed',
    })
    expect(made!.startsAt.toISOString()).toBe(dubaiInstant(next, 30).toISOString())
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'site.enquiry.booked'), eq(auditLog.entityId, request!.id)))
    expect(audits).toHaveLength(1)
    await sheet.getByRole('button', { name: 'Done' }).click()
  })

  await test.step('the row shows Booked; Reply on WhatsApp confirms the booking', async () => {
    await page.goto(`${app}/${slug}/enquiries`)
    await expect(
      row().getByRole('link', { name: 'Open the booking for Layla Test in the calendar' }),
    ).toHaveText('Booked')
    await expect(row().getByRole('link', { name: 'Make a booking for Layla Test' })).toHaveCount(0)
    expect(await reply()).toContain(
      `is confirmed for Swedish massage on the night of ${night} at 00:30 (after midnight, ${next})`,
    )
    await row().getByRole('link', { name: 'Open the booking for Layla Test in the calendar' }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Layla Test' })).toBeVisible({
      timeout: 30_000,
    })
  })

  await test.step('a known number → that client; a service the CRM never named → choose one', async () => {
    const [known] = await db
      .insert(siteEnquiries)
      .values({
        tenantId: seed.tenantId,
        name: 'Fatima',
        phone: '+971501234567',
        message: '',
        locale: 'en',
        page: '',
        booking: {
          service: 'Something else',
          serviceId: null,
          durationMin: null,
          date: night,
          time: '19:00',
          guests: 1,
          staff: null,
          staffId: null,
        },
      })
      .returning()
    await page.goto(`${app}/${slug}/enquiries`)
    await page.getByRole('link', { name: 'Make a booking for Fatima' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'New booking' })).toBeVisible({ timeout: 30_000 })
    await expect(sheet.getByText('Fatima Al Mansoori')).toBeVisible()
    await expect(sheet.getByLabel('Service')).toHaveValue('')
    await expect(sheet.getByLabel('Time')).toHaveValue('19:00')
    await expect(sheet.getByLabel('Therapist')).toHaveValue('')
    await expect(sheet.getByLabel('Notes')).toHaveValue('Website booking request')
    await sheet.getByRole('button', { name: 'Create booking' }).click()
    await expect(sheet.locator('p.text-danger', { hasText: 'Choose a service' })).toBeVisible()
    const [still] = await db.select().from(siteEnquiries).where(eq(siteEnquiries.id, known!.id))
    expect(still!.booking?.bookingId).toBeUndefined()
  })
})
