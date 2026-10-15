import { expect, test } from '@playwright/test'
import {
  auditLog,
  bookingCommissions,
  bookingItems,
  bookings,
  dayCloses,
  expenses,
  rotationEntries,
  sales,
  tenants,
} from '@spa/db'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  addMember,
  app,
  createLogin,
  OWNER_PASSWORD,
  seedBooking,
  seedCatalog,
  signUpOwner,
  testDb,
  today,
} from './helpers'

const DAY_CLOSED = 'That day is closed — ask a manager to change it'

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
    await sheet.getByRole('button', { name: 'Regular', exact: true }).click()
    await expect(sheet.getByLabel('Fee (AED)')).toHaveValue('350')
    await expect(sheet.getByLabel('Commission (AED)')).toHaveValue('')
    await sheet.getByLabel('Fee (AED)').fill('150')
    await sheet.getByLabel('Commission (AED)').fill('40')
    // Lines are set in Settings, so a phone booking must say which line rang.
    await sheet.getByRole('button', { name: 'Create booking' }).click()
    await expect(sheet.getByText('Choose the phone line')).toBeVisible()
    await sheet.getByRole('button', { name: 'P2 · 04 222 2222' }).click()
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

  await test.step('CONFIRM a pending online booking: fee + commission prefilled from the last used; no Check in', async () => {
    // An online request of the same treatment: no fee typed yet (the list price 350 is copied), nothing planned.
    const pending = await seedBooking(seed, '22:00', {
      source: 'online',
      status: 'pending',
      commissionAed: null,
    })
    await desk.goto(`${app}/${slug}/calendar`)
    await desk
      .getByRole('group', { name: 'Maya' })
      .getByRole('button', { name: /^22:00–23:00/ })
      .click()
    const sheet = desk.getByRole('dialog')
    await expect(sheet.getByText('Pending', { exact: true })).toBeVisible()
    // Confirm is the only way forward: no Check in / Start service while pending.
    await expect(sheet.getByRole('button', { name: 'Check in' })).toHaveCount(0)
    await expect(sheet.getByRole('button', { name: 'Start service' })).toHaveCount(0)
    await expect(sheet.getByLabel('Fee (AED)')).toHaveValue('150')
    await expect(sheet.getByLabel('Commission (AED)')).toHaveValue('40')
    await sheet.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(desk.getByText(`Booking ${pending.refCode} confirmed`)).toBeVisible()
    await expect(sheet.getByText('Confirmed', { exact: true })).toBeVisible()
    const [b] = await db.select().from(bookings).where(eq(bookings.id, pending.id))
    expect(b!.status).toBe('confirmed')
    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.bookingId, pending.id))
    expect(item).toMatchObject({ priceAed: '150.00', commissionAed: '40.00' })
    expect(item!.termsSetAt).toBeInstanceOf(Date)

    // Order details after booking: Regular/New and own client (not a walk-in, so it may change).
    await sheet.getByRole('button', { name: 'Order details' }).click()
    await sheet.getByRole('button', { name: 'New', exact: true }).click()
    await sheet.getByRole('switch', { name: 'Own client' }).click()
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(desk.getByText('Order details saved')).toBeVisible()
    await expect(sheet.getByText('Own client', { exact: true })).toBeVisible()
    await expect(sheet.getByText('B/N', { exact: true })).toBeVisible()
    const [d] = await db.select().from(bookings).where(eq(bookings.id, pending.id))
    expect(d).toMatchObject({ clientType: 'new', ownLead: true })
    const [confirmed] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, pending.id), eq(auditLog.action, 'booking.confirmed')))
    expect(confirmed!.data).toMatchObject({
      before: [{ feeAed: 350, commissionAed: null }],
      after: [{ feeAed: 150, commissionAed: 40 }],
      closedDay: false,
    })
    await desk.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  })

  await test.step('an own-client walk-in with Ploy picked by hand keeps the rotation; pill reads Own client', async () => {
    await desk.getByRole('button', { name: 'Walk-in' }).first().click()
    const sheet = desk.getByRole('dialog')
    await sheet.getByLabel('Name').fill('Reem')
    await sheet.getByRole('switch', { name: 'Own client' }).click()
    // A rotation pick is never her own client: the therapist must be chosen by hand.
    await sheet.getByRole('button', { name: 'Start walk-in' }).click()
    await expect(sheet.getByText('Choose the therapist for her own client')).toBeVisible()
    await sheet.getByLabel('Therapist').selectOption({ label: 'Ploy' })
    await sheet.getByRole('button', { name: 'Start walk-in' }).click()
    await expect(desk.getByText('Walk-in checked in with Ploy')).toBeVisible()
    await expect(sheet).toBeHidden()
    const rot = await db.select().from(rotationEntries).where(eq(rotationEntries.branchId, seed.branchId))
    expect(rot.find((r) => r.staffId === ploy)?.turns).toBe(0)
    expect(rot.find((r) => r.staffId === maya)?.turns ?? 0).toBe(0)
    await desk.getByRole('group', { name: 'Ploy' }).getByRole('button', { name: /Reem/ }).click()
    const walkIn = desk.getByRole('dialog')
    await expect(walkIn.getByText('Own client', { exact: true })).toBeVisible()
    // A walk-in's own client decided her turn when it started: Order details can't switch it any more.
    await walkIn.getByRole('button', { name: 'Order details' }).click()
    await expect(walkIn.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    await expect(walkIn.getByRole('switch', { name: 'Own client' })).toHaveCount(0)
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
    const [rec] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.action, 'expense.recorded')))
    expect(rec!.data).toMatchObject({
      description: 'Laundry',
      amountAed: '58.00',
      accountCode: '6180',
      fromDrawer: true,
      closedDay: false,
    })
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
    // Audited with the numbers before and after (the only record of them once a closed day is amended).
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, bookingId), eq(auditLog.action, 'booking.order_corrected')))
    expect(entry!.data).toMatchObject({
      reason: 'Paid cash, not card',
      before: { saleNumber: 1, payments: [{ method: 'card_terminal', amountAed: 150 }] },
      after: { saleNumber: 2, payments: [{ method: 'cash', amountAed: 150 }] },
      voidedSale: all.find((s) => s.number === 1)!.id,
      sale: 2,
      closedDay: false,
    })
  })

  let closedPdf = ''
  // Two desk tabs opened before the close: they still show the open-day forms afterwards (stale pages).
  const staleBooking = await desk.context().newPage()
  const staleClose = await desk.context().newPage()
  await test.step('close the day: 150 cash + 10 cash tip − 58 laundry = 102, balanced', async () => {
    await staleBooking.goto(`${app}/${slug}/bookings/${bookingId}`)
    await expect(staleBooking.getByRole('button', { name: 'Correct payment' })).toBeVisible()
    await staleClose.goto(`${app}/${slug}/sales/close`)
    await expect(staleClose.getByRole('button', { name: 'Add expense' })).toBeVisible()
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

  await test.step('closed day: the server refuses reception from the stale tabs (no new rows)', async () => {
    const count = async () => ({
      sales: (await db.select().from(sales).where(eq(sales.tenantId, seed.tenantId))).length,
      commissions: (
        await db.select().from(bookingCommissions).where(eq(bookingCommissions.bookingId, bookingId))
      ).length,
      expenses: (await db.select().from(expenses).where(eq(expenses.tenantId, seed.tenantId))).length,
    })
    const was = await count()
    await staleBooking.getByRole('button', { name: 'Correct payment' }).click()
    const correct = staleBooking.getByRole('dialog', { name: 'Correct the payment' })
    await correct.getByLabel('Tip 1 amount').fill('12')
    await correct.getByLabel('Reason for the correction').fill('Tip was 12')
    await correct.getByRole('button', { name: 'Correct payment' }).click()
    await expect(staleBooking.getByText(DAY_CLOSED).first()).toBeVisible()
    await staleBooking.keyboard.press('Escape')
    await expect(correct).toBeHidden()
    // Wait for that toast to go, so the next refusal is its own.
    await expect(staleBooking.getByText(DAY_CLOSED)).toHaveCount(0)
    await staleBooking.getByLabel('Commission for Maya · Swedish massage').fill('45')
    await staleBooking.getByRole('button', { name: 'Save commission' }).click()
    await expect(staleBooking.getByText(DAY_CLOSED).first()).toBeVisible()
    await staleClose.getByLabel('What for').fill('Water')
    await staleClose.getByLabel('Amount (AED)').fill('5')
    await staleClose.getByRole('button', { name: 'Add expense' }).click()
    await expect(staleClose.getByText(DAY_CLOSED).first()).toBeVisible()
    // New money on the closed day: a retail checkout is refused too.
    await desk.goto(`${app}/${slug}/sales/new`)
    await desk.getByLabel('Add a service').selectOption(seed.variantIds[0]!)
    await desk.getByLabel('Payment 1 method').selectOption('cash')
    await desk.getByLabel('Payment 1 amount').fill('350')
    await desk.getByRole('button', { name: /Complete sale/ }).click()
    await expect(desk.getByText(DAY_CLOSED).first()).toBeVisible()
    expect(await count()).toEqual(was)
    const [c] = await db
      .select({ v: sql<string>`sum(${bookingCommissions.amountAed})` })
      .from(bookingCommissions)
      .where(eq(bookingCommissions.bookingId, bookingId))
    expect(Number(c!.v)).toBe(40)
    await staleBooking.close()
    await staleClose.close()
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
    const corrections = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, bookingId), eq(auditLog.action, 'booking.order_corrected')))
      .orderBy(asc(auditLog.id))
    expect(corrections).toHaveLength(2)
    expect(corrections[1]!.data).toMatchObject({
      reason: 'Tip was 15',
      before: { saleNumber: 2, tips: [{ amountAed: 10 }] },
      after: { saleNumber: 3, tips: [{ amountAed: 15 }] },
      sale: 3,
      closedDay: true,
    })
  })
  await desk.context().close()
})
