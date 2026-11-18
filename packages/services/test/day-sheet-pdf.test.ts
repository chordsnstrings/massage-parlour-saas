// R32 day-sheet PDF: the 13-10-26 paper sheet rendered (EN + TH), optional columns, pagination, stored file at close.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { dubaiInstant } from '@spa/core'
import { branches, closeAllDbs, dayCloses, storedFiles, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { extractText, getDocumentProxy } from 'unpdf'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDay, DAY_SHEET_PDF_PURPOSE, type DaySheet, daySheet, getFile } from '../src'
import { generateDaySheetPdf, renderDaySheetPdf, sheetAmount } from '../src/pdf/day-sheet-pdf'
import { seedDaySheetDay } from './fixtures/day-sheet-13-10-26'

const { platform, app } = testDbs()
const D = '2026-10-13'
const NOW = dubaiInstant(D, 23 * 60 + 30)
const ids = {} as Record<string, string>
const run = <T>(fn: (tx: Parameters<Parameters<typeof withTenant<T>>[1]>[0]) => Promise<T>) =>
  withTenant(ids.tenant!, fn, app)
/** Where the rendered sheet is written for a visual check (DAY_SHEET_PDF_OUT, e.g. the R32 scratchpad). */
const OUT = process.env.DAY_SHEET_PDF_OUT

async function pdfText(bytes: Buffer) {
  const doc = await getDocumentProxy(new Uint8Array(bytes))
  const { text, totalPages } = await extractText(doc, { mergePages: true })
  // As in intake-pdf.test: decomposed glyphs read back as U+034F, pdf.js guesses spaces between some Thai marks, and
  // SARA AM (drawn as NIKHAHIT + SARA AA) copies as "ำา".
  const clean = (text as string)
    .replaceAll('͏', '')
    .replace(/(?<=[฀-๿]) (?=[฀-๿])/g, '')
    .replaceAll('ำา', 'ำ')
    .replace(/\s+/g, ' ')
  return { text: clean, pages: totalPages }
}

let sheet: DaySheet
const render = (o: Partial<Parameters<typeof renderDaySheetPdf>[0]> = {}) =>
  renderDaySheetPdf({
    ...sheet,
    lang: 'en',
    columns: { tips: true, commission: false },
    generatedAt: NOW,
    ...o,
  })

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'berelax-pdf', name: 'BE RELAX Spa' }).returning()
  ids.tenant = t!.id
  await run(async (tx) => {
    const [b] = await tx
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Main', isDefault: true })
      .returning()
    ids.branch = b!.id
  })
  await seedDaySheetDay(run, {
    tenantId: ids.tenant!,
    branchId: ids.branch!,
    date: D,
    now: NOW,
    expense: true,
    tips: true,
  })
  sheet = await run((tx) => daySheet(tx, ids.branch!, D))
})
afterAll(closeAllDbs)

describe('R32 day-sheet PDF', () => {
  it('formats amounts like the paper (no AED, grouping, fils only when there are any)', () => {
    expect([
      sheetAmount(1460),
      sheetAmount(2482),
      sheetAmount(58.5),
      sheetAmount(-58),
      sheetAmount(0),
    ]).toEqual(['1,460', '2,482', '58.50', '-58', '0'])
  })

  it('renders the 13-10-26 sheet in English with the paper totals', async () => {
    const pdf = await render()
    if (OUT) {
      await mkdir(OUT, { recursive: true })
      await writeFile(path.join(OUT, 'day-sheet-13-10-26-en.pdf'), pdf)
    }
    const { text, pages } = await pdfText(pdf)
    expect(pages).toBe(1)
    for (const s of [
      'Daily sales sheet',
      'BE RELAX Spa',
      'Tue 13 Oct 2026',
      'Business day ends 05:00',
      'Luna',
      'P2/R',
      'W/N',
      'P4/R',
      'OFF',
      'Laundry',
      '1,460',
      '1,080',
      '1,460 + 1,080 - 58 = 2,482',
      'Total sale',
      '2,482',
      '1,402',
      '12:35–13:35',
      'Tips (not in sales)',
      'Not closed yet',
      'Page 1 of 1',
    ])
      expect(text, s).toContain(s)
    expect(text).not.toContain('Comm.')
  })

  it('renders Thai labels; tips and commission columns only when switched on', async () => {
    const thPdf = await render({ lang: 'th', columns: { tips: false, commission: true } })
    if (OUT) await writeFile(path.join(OUT, 'day-sheet-13-10-26-th.pdf'), thPdf)
    const th = await pdfText(thPdf)
    for (const s of ['ใบสรุปยอดขายประจำวัน', 'หยุด', 'ยอดเงินสดรวม', 'คอม.', 'Luna', '2,482'])
      expect(th.text, s).toContain(s)
    expect(th.text).not.toContain('ทิป')
    const none = await pdfText(await render({ columns: { tips: false, commission: false } }))
    expect(none.text).not.toContain('Tips')
    expect(none.text).not.toContain('Comm.')
    const both = await render({ columns: { tips: true, commission: true } })
    if (OUT) await writeFile(path.join(OUT, 'day-sheet-13-10-26-columns.pdf'), both)
    expect((await pdfText(both)).text).toContain('Comm.')
  })

  it('continues long days on the next page (header repeated, Page 2 of 2)', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...sheet.rows[i % 13]!, no: i + 1, key: `k${i}` }))
    const long = await render({ rows: many })
    if (OUT) await writeFile(path.join(OUT, 'day-sheet-long.pdf'), long)
    const { text, pages } = await pdfText(long)
    expect(pages).toBe(2)
    expect(text).toContain('Page 2 of 2')
    expect(text.match(/Daily sales sheet/g)?.length).toBeGreaterThanOrEqual(2)
    expect(text).toContain('60')
  })

  it('stores a private day_sheet_pdf file with the close; regenerating replaces it and prints "Amended"', async () => {
    const close = await run((tx) =>
      closeDay(tx, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        date: D,
        openingFloatAed: 0,
        countedCashAed: 1422,
      }),
    )
    const first = await run((tx) =>
      generateDaySheetPdf(tx, close.id, { lang: 'en', closedByName: 'Reception' }),
    )
    const [row] = await run((tx) => tx.select().from(dayCloses).where(eq(dayCloses.id, close.id)))
    expect(row).toMatchObject({ pdfFileId: first.fileId, pdfSha256: first.sha256 })
    expect(row!.pdfGeneratedAt).toBeInstanceOf(Date)
    const [file] = await run((tx) => tx.select().from(storedFiles).where(eq(storedFiles.id, first.fileId)))
    expect(file).toMatchObject({
      purpose: DAY_SHEET_PDF_PURPOSE,
      isPublic: false,
      contentType: 'application/pdf',
      filename: 'day-sheet-2026-10-13.pdf',
    })
    const stored = await run((tx) => getFile(tx, first.fileId))
    const closed = await pdfText(stored!.bytes)
    // Expected cash = 1460 + 20 cash tip - 58 = 1422 (the drawer still holds the tips); the sheet total stays 1402.
    expect(closed.text).toMatch(/Closed \d{1,2} [A-Z][a-z]{2} \d{2}:\d{2} by Reception/)
    expect(closed.text).toContain('by Reception · counted 1,422 · variance 0')
    expect(closed.text).toContain('1,402')
    // A correction by a manager marks the close amended; the new file replaces the old one.
    await run((tx) =>
      tx
        .update(dayCloses)
        .set({ amendedAt: dubaiInstant('2026-10-14', 10 * 60) })
        .where(eq(dayCloses.id, close.id)),
    )
    const second = await run((tx) =>
      generateDaySheetPdf(tx, close.id, { lang: 'en', closedByName: 'Reception' }),
    )
    expect(second.fileId).not.toBe(first.fileId)
    const gone = await run((tx) => tx.select().from(storedFiles).where(eq(storedFiles.id, first.fileId)))
    expect(gone).toHaveLength(0)
    const amended = await pdfText((await run((tx) => getFile(tx, second.fileId)))!.bytes)
    expect(amended.text).toContain('Amended after close 14 Oct 10:00')
    if (OUT)
      await writeFile(
        path.join(OUT, 'day-sheet-13-10-26-closed.pdf'),
        (await run((tx) => getFile(tx, second.fileId)))!.bytes,
      )
  })
})
