// R32 daily sales sheet PDF: the owner's paper sheet BE RELAX 13-10-26 seeded on yesterday through the real booking
// flow, the drawer expense added on Daily close, the sheet downloaded (any day), then the copy saved when the day is
// closed. Only pos.close may read either (a therapist gets 404).
import { readFile } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import { addDays } from '@spa/core'
import { branches, dayCloses, expenses, storedFiles, tenants } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { extractText, getDocumentProxy } from 'unpdf'
import { SHEET_TOTALS, seedDaySheetDay } from '../../../packages/services/test/fixtures/day-sheet-13-10-26'
import {
  addMember,
  app,
  createLogin,
  OWNER_PASSWORD,
  screenshotAt,
  signUpOwner,
  testDb,
  today,
} from './helpers'

const pdfText = async (bytes: Uint8Array) => {
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true })
  return (text as string).replace(/\s+/g, ' ')
}
const fmt = (v: number) => new Intl.NumberFormat('en-US').format(v)

/** Same-origin GET from the page (it carries the app session cookie): status, type and body. */
const fetchFrom = (p: Page, url: string) =>
  p.evaluate(async (u) => {
    const r = await fetch(u)
    return {
      status: r.status,
      type: r.headers.get('content-type'),
      bytes: [...new Uint8Array(await r.arrayBuffer())],
    }
  }, url)

test('daily sales sheet: download any day, auto copy at close, reception totals as on paper', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000)
  const { slug } = await signUpOwner(page, { spa: 'BE RELAX Spa' })
  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const [branch] = await db.select().from(branches).where(eq(branches.tenantId, tenant!.id))
  const day = addDays(today(), -1)
  await seedDaySheetDay((fn) => db.transaction(fn), { tenantId: tenant!.id, branchId: branch!.id, date: day })
  const closePage = `${app}/${slug}/sales/close?date=${day}`

  const assertSheet = (text: string) => {
    // 13 numbered rows: row 13 is Luna's 21:40 session, and there is no 14th.
    expect(text).toContain('13 Luna 3 21:40–22:40 10 P3/R 150')
    expect(text).not.toMatch(/\b14 \p{L}+ \d+ \d{2}:\d{2}–/u)
    for (const s of ['P4/R', 'OFF', 'Laundry', `${fmt(SHEET_TOTALS.cash)} ${fmt(SHEET_TOTALS.card)}`])
      expect(text, s).toContain(s)
    expect(text).toContain(
      `${fmt(SHEET_TOTALS.cash)} + ${fmt(SHEET_TOTALS.card)} - ${SHEET_TOTALS.expenses} = ${fmt(SHEET_TOTALS.totalSale)}`,
    )
    expect(text).toContain(`Total sale ${fmt(SHEET_TOTALS.totalSale)}`)
    expect(text).toContain(`Total card ${fmt(SHEET_TOTALS.card)}`)
    expect(text).toContain(`Total cash ${fmt(SHEET_TOTALS.totalCash)}`)
  }

  await test.step('Daily close of yesterday: Laundry 58 from the drawer, then Download day sheet (PDF)', async () => {
    await page.goto(closePage)
    await expect(page.getByRole('heading', { name: 'Daily sales sheet' })).toBeVisible()
    await page.getByLabel('What for').fill('Laundry')
    await page.getByLabel('Category').selectOption({ label: 'Laundry' })
    await page.getByLabel('Amount (AED)').fill('58')
    await page.getByRole('button', { name: 'Add expense' }).click()
    await expect(page.getByText('Expense added')).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Laundry' }).first()).toBeVisible()
    // Tips on (default), commission switched on for this download.
    await page.getByRole('switch', { name: 'Commission per therapist' }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('day-sheet-download').click(),
    ])
    expect(download.suggestedFilename()).toBe(`day-sheet-${day}.pdf`)
    const text = await pdfText(new Uint8Array(await readFile((await download.path())!)))
    assertSheet(text)
    expect(text).toContain('Comm.')
    expect(text).toContain('Not closed yet')
  })

  let fileId = ''
  await test.step('Close the day → the PDF is saved with the close and opens from "PDF saved at close"', async () => {
    await page.goto(closePage)
    await page.getByLabel('Opening float (AED)').fill('0')
    await expect(page.getByTestId('expected-cash')).toHaveText(/1,402/)
    await page.getByLabel('Counted cash (AED)').fill('1402')
    await page.getByRole('button', { name: 'Close the day' }).click()
    await expect(page.getByRole('heading', { name: 'Day closed' })).toBeVisible()
    const link = page.getByTestId('day-sheet-saved')
    await expect(link).toBeVisible()
    await screenshotAt(page, 'day-sheet-close')
    const [close] = await db
      .select()
      .from(dayCloses)
      .where(and(eq(dayCloses.branchId, branch!.id), eq(dayCloses.businessDate, day)))
    expect(close!.pdfFileId).toBeTruthy()
    expect(close!.pdfSha256).toMatch(/^[0-9a-f]{64}$/)
    fileId = close!.pdfFileId!
    const [file] = await db.select().from(storedFiles).where(eq(storedFiles.id, fileId))
    expect(file).toMatchObject({ purpose: 'day_sheet_pdf', isPublic: false })
    expect(await link.getAttribute('href')).toBe(`/files/${fileId}`)
    const got = await fetchFrom(page, `/files/${fileId}`)
    expect(got.status).toBe(200)
    expect(got.type).toBe('application/pdf')
    const text = await pdfText(new Uint8Array(got.bytes))
    assertSheet(text)
    expect(text).toMatch(/Closed \d{1,2} [A-Z][a-z]{2} \d{2}:\d{2} by .+ · counted 1,402 · variance 0/)
  })

  await test.step('a therapist gets 404 on the download and on the saved file', async () => {
    const p = await (await browser.newContext()).newPage()
    const email = `therapist-${slug.slice(-8)}@e2e.test`
    await createLogin(p, { name: 'Sheet Therapist', email, password: OWNER_PASSWORD })
    await addMember(slug, email, 'therapist')
    await p.goto(`${app}/${slug}`)
    const route = await fetchFrom(p, `${app}/${slug}/sales/close/sheet?date=${day}&branch=${branch!.id}`)
    expect(route.status).toBe(404)
    expect((await fetchFrom(p, `/files/${fileId}`)).status).toBe(404)
    // The owner may: same route, 200 PDF.
    const own = await fetchFrom(page, `${app}/${slug}/sales/close/sheet?date=${day}`)
    expect(own).toMatchObject({ status: 200, type: 'application/pdf' })
    // A day that has not started is not served.
    expect(
      (await fetchFrom(page, `${app}/${slug}/sales/close/sheet?date=${addDays(today(), 1)}`)).status,
    ).toBe(404)
    await p.context().close()
  })

  await test.step('PDF missing after close (render failed): "Create PDF" stores it again', async () => {
    await db
      .update(dayCloses)
      .set({ pdfFileId: null, pdfSha256: null, pdfGeneratedAt: null })
      .where(and(eq(dayCloses.branchId, branch!.id), eq(dayCloses.businessDate, day)))
    await page.goto(closePage)
    await expect(page.getByTestId('day-sheet-saved')).toHaveCount(0)
    await page.getByRole('button', { name: 'Create PDF' }).click()
    await expect(page.getByText('Day sheet PDF created')).toBeVisible()
    await expect(page.getByTestId('day-sheet-saved')).toBeVisible()
    const [close] = await db
      .select()
      .from(dayCloses)
      .where(and(eq(dayCloses.branchId, branch!.id), eq(dayCloses.businessDate, day)))
    expect(close!.pdfFileId).toBeTruthy()
    expect(close!.pdfFileId).not.toBe(fileId)
    const [file] = await db.select().from(storedFiles).where(eq(storedFiles.id, close!.pdfFileId!))
    expect(file).toMatchObject({ purpose: 'day_sheet_pdf', isPublic: false })
    assertSheet(await pdfText(new Uint8Array((await fetchFrom(page, `/files/${file!.id}`)).bytes)))
  })

  await test.step('an accountant (no pos.correct) cannot void the closed day’s drawer expense from Accounts', async () => {
    const p = await (await browser.newContext()).newPage()
    const email = `accountant-${slug.slice(-8)}@e2e.test`
    await createLogin(p, { name: 'Sheet Accountant', email, password: OWNER_PASSWORD })
    await addMember(slug, email, 'accountant')
    await p.goto(`${app}/${slug}/accounts/expenses?month=${day.slice(0, 7)}`)
    await expect(p.getByText('Laundry').first()).toBeVisible()
    await p.getByRole('button', { name: 'Void' }).first().click()
    await p.getByRole('button', { name: 'Confirm void' }).first().click()
    await expect(p.getByText('That day is closed — ask a manager to change it')).toBeVisible()
    const left = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.branchId, branch!.id), eq(expenses.expenseDate, day)))
    expect(left.map((e) => [e.description, e.amountAed, e.fromDrawer])).toEqual([['Laundry', '58.00', true]])
    await p.context().close()
  })
})
