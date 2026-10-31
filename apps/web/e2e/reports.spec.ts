import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { addDays, dubaiInstant } from '@spa/core'
import { bookingItems, bookings } from '@spa/db'
import { createSale } from '@spa/services'
import { app, openXlsx, seedCatalog, sheetRows, signUpOwner, testDb, today } from './helpers'

// F31: the Reports page shows rebooking, RevPATH, room utilisation, retention cohorts and the prepaid liability.
test('owner sees the extra KPIs on the Reports page and exports them', async ({ page }) => {
  const { slug } = await signUpOwner(page, { spa: 'Report Spa' })
  const seed = await seedCatalog(slug)
  const db = testDb()
  // Two completed visits by Fatima (Maya 10 days ago in Room 1, Ploy 3 days ago in Room 2): the first was rebooked.
  let n = 0
  for (const [daysAgo, staffId, roomId] of [
    [10, seed.staffIds[0]!, seed.roomIds[0]!],
    [3, seed.staffIds[1]!, seed.roomIds[1]!],
  ] as const) {
    const date = addDays(today(), -daysAgo)
    const startsAt = dubaiInstant(date, 12 * 60)
    const endsAt = dubaiInstant(date, 13 * 60)
    const [b] = await db
      .insert(bookings)
      .values({
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        clientId: seed.clientId,
        refCode: `RPT${++n}`,
        source: 'phone',
        status: 'completed',
        businessDate: date,
        startsAt,
        endsAt,
      })
      .returning()
    await db.insert(bookingItems).values({
      tenantId: seed.tenantId,
      bookingId: b!.id,
      serviceName: 'Swedish massage',
      durationMin: 60,
      startsAt,
      endsAt,
      roomId,
      staffIds: [staffId],
    })
  }
  // Today: a treatment by Maya (AED 350 → 333.33 ex VAT) and a AED 200 gift card, through POS (ledger postings).
  await db.transaction((tx) =>
    createSale(tx, {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      clientId: seed.clientId,
      lines: [
        {
          kind: 'service',
          refId: seed.variantIds[0]!,
          description: 'Swedish massage',
          qty: 1,
          unitPriceAed: 350,
          staffId: seed.staffIds[0]!,
        },
        { kind: 'gift_card', description: 'Gift card — Sara', qty: 1, unitPriceAed: 200 },
      ],
      payments: [{ method: 'cash', amountAed: 550 }],
    }),
  )

  await page.goto(`${app}/${slug}`)
  await page.getByRole('link', { name: 'Reports', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible()

  await test.step('rebooking by therapist', async () => {
    const card = page.getByTestId('report-rebooking')
    await expect(card).toContainText('1 of 2 visits rebooked')
    await expect(card).toContainText('Maya')
    await expect(card).toContainText('100%')
    await page.getByRole('link', { name: '60 days' }).click()
    await expect(page).toHaveURL(/rebook=60/)
    await expect(page.getByTestId('report-rebooking')).toContainText('1 of 2 visits rebooked')
  })

  await test.step('RevPATH from the seeded shifts (2 × 24 h today)', async () => {
    const card = page.getByTestId('report-revpath')
    await expect(card).toContainText(/AED\s6\.94/)
    await expect(card).toContainText(/AED\s333\.33/)
    await expect(card).toContainText('Shifts')
  })

  await test.step('rooms, cohorts and the prepaid liability', async () => {
    await expect(page.getByTestId('report-rooms')).toContainText('Room 1')
    await expect(page.getByTestId('report-cohorts')).toContainText('Client retention')
    const liability = page.getByTestId('report-liability')
    await expect(liability).toContainText('Gift cards (2100)')
    await expect(liability).toContainText(/AED\s200/)
    await expect(liability).toContainText('Matches the ledger')
  })

  await test.step('Excel export has one sheet per KPI', async () => {
    const download = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Export to Excel' }).click()
    const d = await download
    expect(d.suggestedFilename()).toMatch(/^reports-.+\.xlsx$/)
    const wb = await openXlsx(readFileSync((await d.path())!))
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Rebooking',
      'RevPATH',
      'Rooms',
      'Retention',
      'Liability',
    ])
    const rebook = sheetRows(wb.worksheets[0]!)
    expect(rebook.find((r) => r[0] === 'All therapists')).toEqual(['All therapists', 2, 1, 50])
  })

  await test.step('Thai labels', async () => {
    await page.getByRole('button', { name: 'ไทย' }).click()
    await expect(page.locator('.crm')).toHaveAttribute('lang', 'th')
    await expect(page.getByRole('heading', { name: 'รายงาน', exact: true })).toBeVisible()
    await expect(page.getByTestId('report-rebooking')).toContainText('อัตราการจองซ้ำ')
  })
})
