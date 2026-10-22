import { expect, test } from '@playwright/test'
import { auditLog, bookings, clients, sales, treatmentNotes } from '@spa/db'
import { createSale } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { app, seedBooking, seedCatalog, signUpOwner, testDb } from './helpers'

test('G12: the owner erases a client; visits and sales stay, personal data goes', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  const booking = await seedBooking(seed)
  const db = testDb()
  const { sale } = await db.transaction((tx) =>
    createSale(tx, {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      bookingId: booking.id,
      lines: [{ kind: 'service', description: 'Swedish massage', qty: 1, unitPriceAed: 350 }],
      payments: [{ method: 'cash', amountAed: 350 }],
    }),
  )
  await db
    .insert(treatmentNotes)
    .values({ tenantId: seed.tenantId, clientId: seed.clientId, text: 'Tight shoulders' })

  await page.goto(`${app}/${slug}/clients/${seed.clientId}`)
  await expect(page.getByRole('heading', { name: /Fatima Al Mansoori/, level: 1 })).toBeVisible()
  await expect(page.getByTestId('treatment-notes')).toContainText('Tight shoulders')

  await test.step('the sheet explains what goes, links the export and needs the box ticked', async () => {
    await page.getByRole('button', { name: 'Erase client' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toContainText('Kept for accounting')
    await expect(sheet.getByRole('link', { name: 'Download export' })).toHaveAttribute(
      'href',
      /settings\/data\/export\?type=full/,
    )
    await sheet.getByRole('button', { name: 'Erase permanently' }).click()
    await expect(sheet.getByText('Tick the box to confirm')).toBeVisible()
    await sheet.getByLabel(/permanently erases this client/).check()
    await sheet.getByRole('button', { name: 'Erase permanently' }).click()
    await expect(sheet).toBeHidden()
  })

  await test.step('the profile shows an erased client with the visit still listed', async () => {
    await expect(page.getByRole('heading', { name: /Erased client/, level: 1 })).toBeVisible()
    await expect(page.getByTestId('client-erased')).toBeVisible()
    await expect(page.getByText('+971 50 123 4567')).toHaveCount(0)
    await expect(page.getByTestId('visit-history')).toContainText('Swedish massage')
    await expect(page.getByTestId('treatment-notes')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Erase client' })).toHaveCount(0)
  })

  await test.step('the database keeps the sale and booking, anonymised, and audits the erase', async () => {
    const [c] = await db.select().from(clients).where(eq(clients.id, seed.clientId))
    expect(c).toMatchObject({ name: 'Erased client', phoneE164: null })
    const [s] = await db.select().from(sales).where(eq(sales.id, sale.id))
    expect(s).toMatchObject({ clientId: seed.clientId, totalAed: '350.00' })
    const [b] = await db.select().from(bookings).where(eq(bookings.id, booking.id))
    expect(b!.clientId).toBe(seed.clientId)
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.action, 'client.erased')))
    expect(audits).toHaveLength(1)
  })
})
