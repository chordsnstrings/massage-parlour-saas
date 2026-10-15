import { expect, test } from '@playwright/test'
import {
  bookingCommissions,
  bookingItems,
  bookings,
  dayCloses,
  rotationEntries,
  sales,
  tenants,
} from '@spa/db'
import { and, eq, sql } from 'drizzle-orm'
import {
  addMember,
  app,
  createLogin,
  OWNER_PASSWORD,
  seedCatalog,
  signUpOwner,
  testDb,
  today,
} from './helpers'

// R32 (PLAN §14.8): booking ↔ sale = one order. Confirm = fee + commission (prefilled from the last amounts), Finish =
// payment + tips → completed + linked sale; own clients don't use the walk-in turn; drawer expenses come off the
// expected cash; corrections are void + re-create; a closed day changes only with an owner/manager.
test('R32 order flow: phone lines, confirm, finish & pay, own client, drawer expense, correct, day lock', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  const db = testDb()
  const [maya, ploy] = seed.staffIds as [string, string]

  await test.step('owner: Settings → Daily sales sheet saves the four phone lines', async () => {
    await page.goto(`${app}/${slug}/settings`)
    const lines = ['04 111 1111', '04 222 2222', '04 333 3333', '050 444 4444']
    for (const [i, n] of lines.entries()) await page.getByLabel(`Line P${i + 1}`).fill(n)
    await page.getByRole('button', { name: 'Save day sheet settings' }).click()
    await expect(page.getByText('Day sheet settings saved')).toBeVisible()
    const [t] = await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.slug, slug))
    expect(t!.s.phoneLines).toEqual(lines)
    expect(t!.s.daySheet).toEqual({ tips: true, commission: false })
  })

  // Reception does the rest (calendar.manage + calendar.commission + pos.use + pos.close; no pos.correct).
  const desk = await (await browser.newContext()).newPage()
  const email = `desk-${slug.slice(-8)}@e2e.test`
  await createLogin(desk, { name: 'Desk Noor', email, password: OWNER_PASSWORD })
  await addMember(slug, email, 'receptionist')

  let bookingId = ''
  await test.step('new phone booking on P2, Regular: fee 350 → 150, commission 40 → sheet shows P2/R', async () => {
    await desk.goto(`${app}/${slug}/calendar`)
    await desk.getByRole('button', { name: 'New booking', exact: true }).first().click()
    const sheet = desk.getByRole('dialog')
    await sheet.getByLabel('Client', { exact: true }).fill('Fati')
    await sheet.getByRole('button', { name: /Fatima Al Mansoori/ }).click()
    await sheet.getByLabel('Time').fill('20:00')
    await sheet.getByLabel('Therapist').selectOption({ label: 'Maya' })
    await expect(sheet.getByLabel('Source')).toHaveValue('phone')
    await sheet.getByRole('button', { name: 'P2 · 04 222 2222' }).click()
    await sheet.getByRole('button', { name: 'Regular', exact: true }).click()
    await expect(sheet.getByLabel('Fee (AED)')).toHaveValue('350')
    await expect(sheet.getByLabel('Commission (AED)')).toHaveValue('')
    await sheet.getByLabel('Fee (AED)').fill('150')
    await sheet.getByLabel('Commission (AED)').fill('40')
    await sheet.getByRole('button', { name: 'Create booking' }).click()
    await expect(sheet.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Done' }).click()
    const [b] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.tenantId, seed.tenantId), eq(bookings.source, 'phone')))
    expect(b).toMatchObject({ phoneLine: 2, clientType: 'regular', ownLead: false, status: 'confirmed' })
    bookingId = b!.id
    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.bookingId, bookingId))
    expect(item).toMatchObject({ priceAed: '150.00', commissionAed: '40.00' })
    await desk
      .getByRole('group', { name: 'Maya' })
      .getByRole('button', { name: /Fatima Al Mansoori/ })
      .click()
    await expect(desk.getByRole('dialog').getByText('P2/R', { exact: true })).toBeVisible()
  })

  await test.step('Finish & pay: commission 40 prefilled; card 150 + cash tip 10 → completed + linked sale', async () => {
    await desk.getByRole('dialog').getByRole('link', { name: 'Finish & pay' }).click()
    await expect(desk.getByRole('heading', { name: 'Check out', level: 1 })).toBeVisible()
    await expect(desk.getByLabel('Commission for Maya · Swedish massage')).toHaveValue('40')
    await expect(desk.getByTestId('sale-total')).toHaveText(/150/)
    await desk.getByLabel('Payment 1 method').selectOption('card_terminal')
    await desk.getByLabel('Payment 1 amount').fill('150')
    await desk.getByRole('button', { name: 'Add tip' }).click()
    await desk.getByLabel('Tip 1 amount').fill('10')
    await desk.getByLabel('Tip 1 method').selectOption('cash')
    await desk.getByRole('button', { name: /Complete sale/ }).click()
    await desk.waitForURL(/\/sales\/[0-9a-f-]{36}$/)
    const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId))
    expect(b!.status).toBe('completed')
    const [sale] = await db.select().from(sales).where(eq(sales.bookingId, bookingId))
    expect(sale).toMatchObject({
      status: 'paid',
      totalAed: '150.00',
      tipsAed: '10.00',
      businessDate: today(),
    })
    const [c] = await db
      .select({ v: sql<string>`sum(${bookingCommissions.amountAed})` })
      .from(bookingCommissions)
      .where(eq(bookingCommissions.bookingId, bookingId))
    expect(Number(c!.v)).toBe(40)
  })

  await test.step('the next booking of the same treatment is prefilled with the last fee + commission', async () => {
    await desk.goto(`${app}/${slug}/calendar`)
    await desk.getByRole('button', { name: 'New booking', exact: true }).first().click()
    const sheet = desk.getByRole('dialog')
    await expect(sheet.getByLabel('Fee (AED)')).toHaveValue('150')
    await expect(sheet.getByLabel('Commission (AED)')).toHaveValue('40')
    await desk.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  })

  await test.step('an own-client walk-in with Ploy picked by hand keeps the rotation; pill reads Own client', async () => {
    await desk.getByRole('button', { name: 'Walk-in' }).first().click()
    const sheet = desk.getByRole('dialog')
    await sheet.getByLabel('Therapist').selectOption({ label: 'Ploy' })
    await sheet.getByLabel('Name').fill('Reem')
    await sheet.getByRole('switch', { name: 'Own client' }).click()
    await sheet.getByRole('button', { name: 'Start walk-in' }).click()
    await expect(desk.getByText('Walk-in checked in with Ploy')).toBeVisible()
    await expect(sheet).toBeHidden()
    const rot = await db.select().from(rotationEntries).where(eq(rotationEntries.branchId, seed.branchId))
    expect(rot.find((r) => r.staffId === ploy)?.turns).toBe(0)
    expect(rot.find((r) => r.staffId === maya)?.turns ?? 0).toBe(0)
    await desk.getByRole('group', { name: 'Ploy' }).getByRole('button', { name: /Reem/ }).click()
    await expect(desk.getByRole('dialog').getByText('Own client', { exact: true })).toBeVisible()
    await desk.keyboard.press('Escape')
  })

  await test.step('Daily close: Laundry 58 from the drawer comes off the expected cash (10 − 58)', async () => {
    await desk.goto(`${app}/${slug}/sales/close`)
    await desk.getByLabel('Opening float (AED)').fill('0')
    await expect(desk.getByTestId('expected-cash')).toHaveText(/10/)
    await desk.getByLabel('What for').fill('Laundry')
    await desk.getByLabel('Category').selectOption({ label: 'Laundry' })
    await desk.getByLabel('Amount (AED)').fill('58')
    await desk.getByRole('button', { name: 'Add expense' }).click()
    await expect(desk.getByText('Expense added')).toBeVisible()
    await expect(desk.getByRole('cell', { name: 'Laundry' }).first()).toBeVisible()
    await desk.getByLabel('Opening float (AED)').fill('0')
    await expect(desk.getByTestId('expected-cash')).toHaveText(/48/)
    await expect(desk.getByText(/−AED\s*48/).first()).toBeVisible()
  })

  await test.step('Correct payment (card → cash): a new sale, the old one void, same business day', async () => {
    await desk.goto(`${app}/${slug}/bookings/${bookingId}`)
    await desk.getByRole('button', { name: 'Correct payment' }).click()
    const sheet = desk.getByRole('dialog', { name: 'Correct the payment' })
    await sheet.getByLabel('Payment 1 method').selectOption('cash')
    await sheet.getByLabel('Reason for the correction').fill('Paid cash, not card')
    await sheet.getByRole('button', { name: 'Correct payment' }).click()
    await expect(desk.getByText('Payment corrected (sale #2)')).toBeVisible()
    const all = await db.select().from(sales).where(eq(sales.bookingId, bookingId))
    expect(all.find((s) => s.number === 1)).toMatchObject({
      status: 'void',
      voidReason: 'Corrected: Paid cash, not card',
    })
    expect(all.find((s) => s.number === 2)).toMatchObject({ status: 'paid', businessDate: today() })
  })

  let closedPdf = ''
  await test.step('close the day: 150 cash + 10 cash tip − 58 laundry = 102, balanced', async () => {
    await desk.goto(`${app}/${slug}/sales/close`)
    await desk.getByLabel('Opening float (AED)').fill('0')
    await expect(desk.getByTestId('expected-cash')).toHaveText(/102/)
    await desk.getByLabel('Counted cash (AED)').fill('102')
    await desk.getByRole('button', { name: 'Close the day' }).click()
    await expect(desk.getByRole('heading', { name: 'Day closed' })).toBeVisible()
    const [close] = await db.select().from(dayCloses).where(eq(dayCloses.branchId, seed.branchId))
    expect(close).toMatchObject({ expectedCashAed: '102.00', varianceAed: '0.00', amendedAt: null })
    expect(close!.totals.expenses).toBe('58.00')
    // R32: the day-sheet PDF is saved with the close.
    expect(close!.pdfFileId).toBeTruthy()
    closedPdf = close!.pdfFileId!
    // Reception can no longer add drawer expenses to the closed day.
    await expect(desk.getByRole('button', { name: 'Add expense' })).toHaveCount(0)
  })

  await test.step('closed day: reception reads only; the owner corrects it and the close shows Amended', async () => {
    await desk.goto(`${app}/${slug}/bookings/${bookingId}`)
    await expect(desk.getByText('This day is closed. Only an owner or manager can change it.')).toBeVisible()
    await expect(desk.getByRole('button', { name: 'Correct payment' })).toHaveCount(0)
    await expect(desk.getByRole('button', { name: 'Save commission' })).toHaveCount(0)

    await page.goto(`${app}/${slug}/bookings/${bookingId}`)
    await page.getByRole('button', { name: 'Correct payment' }).click()
    const sheet = page.getByRole('dialog', { name: 'Correct the payment' })
    await sheet.getByLabel('Tip 1 amount').fill('15')
    await sheet.getByLabel('Reason for the correction').fill('Tip was 15')
    await sheet.getByRole('button', { name: 'Correct payment' }).click()
    await expect(page.getByText('Payment corrected (sale #3)')).toBeVisible()
    const [close] = await db.select().from(dayCloses).where(eq(dayCloses.branchId, seed.branchId))
    expect(close!.amendedAt).not.toBeNull()
    // The counted cash and variance stay as recorded at close.
    expect(close).toMatchObject({ countedCashAed: '102.00', varianceAed: '0.00' })
    // …and the saved day sheet is regenerated (marked "Amended after close").
    expect(close!.pdfFileId).toBeTruthy()
    expect(close!.pdfFileId).not.toBe(closedPdf)
    await page.goto(`${app}/${slug}/sales/close`)
    await expect(page.getByText(/^Amended /)).toBeVisible()
  })
  await desk.context().close()
})
