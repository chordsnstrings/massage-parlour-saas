import { expect, test } from '@playwright/test'
import { addDays, dubaiInstant } from '@spa/core'
import { auditLog, clients, treatmentNotes } from '@spa/db'
import { createBooking, setBookingStatus } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { app, seedBooking, seedCatalog, signUpOwner, testDb, today } from './helpers'

test('merge duplicate clients: suggestion, preview, merge moves everything to the kept client', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  await seedBooking(seed)
  const db = testDb()
  const [dup] = await db
    .insert(clients)
    .values({ tenantId: seed.tenantId, name: 'fatima  al mansoori', tags: ['vip'] })
    .returning()
  await db
    .insert(treatmentNotes)
    .values({ tenantId: seed.tenantId, clientId: dup!.id, text: 'Likes it firm' })

  await page.goto(`${app}/${slug}/clients`)
  await page.getByRole('link', { name: 'Duplicates' }).click()
  await expect(page.getByRole('heading', { name: 'Duplicate clients', level: 1 })).toBeVisible()
  const row = page.getByTestId('duplicate-pair')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Same name')
  await row.getByRole('link', { name: /Review/ }).click()

  await expect(page.getByRole('heading', { name: 'Merge clients', level: 1 })).toBeVisible()
  await expect(page.getByTestId('merge-moves')).toContainText('1 treatment note')
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Merge clients' }).click()
  await expect(page.getByText('Clients merged')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/${slug}/clients/${seed.clientId}$`))
  await expect(page.getByTestId('treatment-notes')).toContainText('Likes it firm')

  expect(await db.select().from(clients).where(eq(clients.id, dup!.id))).toHaveLength(0)
  const [kept] = await db.select().from(clients).where(eq(clients.id, seed.clientId))
  expect(kept!.tags).toContain('vip')
  const [entry] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.action, 'client.merged')))
  expect(entry!.data).toMatchObject({ keptId: seed.clientId, mergedId: dup!.id })
})

test('waitlist: add from the calendar, a cancellation notifies, then book the entry', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  // Tomorrow's business day at 12:00 (within opening hours and shifts, never in the past).
  const date = addDays(today(), 1)
  const hhmm = '12:00'
  const booking = await testDb().transaction((tx) =>
    createBooking(tx, {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      clientId: seed.clientId,
      source: 'phone',
      status: 'confirmed',
      items: [{ serviceVariantId: seed.variantIds[0]!, start: dubaiInstant(date, 12 * 60) }],
    }),
  )

  await page.goto(`${app}/${slug}/calendar?date=${date}`)
  await page.getByRole('link', { name: 'Waitlist' }).click()
  await expect(page.getByRole('heading', { name: 'Waitlist', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Add to waitlist' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Client name').fill('Noura Waitlist')
  await sheet.getByLabel('Mobile').fill('050 765 4321')
  await sheet.getByLabel('Treatment').selectOption({ label: 'Swedish massage' })
  await sheet.getByRole('button', { name: 'Add to waitlist' }).click()
  await expect(page.getByText('Added to the waitlist')).toBeVisible()
  const row = page.getByTestId('waitlist-row').filter({ hasText: 'Noura Waitlist' })
  await expect(row).toContainText('Waiting')

  // The seeded booking is cancelled (bookings service) → the entry is notified + a WhatsApp message queued.
  await testDb().transaction((tx) => setBookingStatus(tx, booking.id, 'cancelled', 'Client ill'))
  await page.reload()
  await expect(row).toContainText('Notified')
  await page.goto(`${app}/${slug}/messages`)
  await expect(page.getByText(/Noura, good news: a Swedish massage slot just opened/)).toBeVisible()

  await page.goto(`${app}/${slug}/waitlist?date=${date}`)
  await row.getByRole('button', { name: /Book/ }).click()
  const book = page.getByRole('dialog')
  await book.getByLabel('Start time').fill(hhmm)
  await book.getByRole('button', { name: 'Create booking' }).click()
  await expect(page.getByText(/Booked — ref/)).toBeVisible()
  await expect(page.getByTestId('waitlist-row').filter({ hasText: 'Noura Waitlist' })).toHaveCount(0)
})
