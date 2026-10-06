import {
  branches,
  clients,
  closeAllDbs,
  journalLines,
  products,
  stockLevels,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  autoMap,
  csvCell,
  decodeCsvBytes,
  detectDateOrder,
  detectDelimiter,
  existingRows,
  exportRows,
  fullExportReadme,
  fullExportTables,
  isBinaryFile,
  missingRequired,
  normalisePhone,
  parseAmount,
  parseDate,
  parseDuration,
  runImport,
  toCsv,
  validateRows,
  withoutValues,
} from '../src'

describe('decoding and delimiters', () => {
  it('strips a UTF-8 BOM and keeps Arabic text', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Name,الاسم\n')])
    expect(decodeCsvBytes(bytes)).toBe('Name,الاسم\n')
  })
  it('decodes UTF-16LE (Excel "Unicode text") and falls back to Windows-1252', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...Buffer.from('a\tb', 'utf16le')])
    expect(decodeCsvBytes(utf16)).toBe('a\tb')
    expect(decodeCsvBytes(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe('Café')
  })
  it('decodes Arabic Windows-1256 and spots workbooks that are not CSV', () => {
    const arabic = new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x2c, 0xc7, 0xe1, 0xc7, 0xd3, 0xe3])
    expect(decodeCsvBytes(arabic)).toBe('Name,الاسم')
    expect(isBinaryFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe(true)
    expect(isBinaryFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe(true)
    expect(isBinaryFile(new TextEncoder().encode('Name,Phone\nSara,050'))).toBe(false)
    expect(isBinaryFile(new Uint8Array([0xff, 0xfe, ...Buffer.from('a,b', 'utf16le')]))).toBe(false)
  })
  it('detects comma, semicolon (Excel EU), tab and the sep= hint', () => {
    expect(detectDelimiter('Name,Phone\nA,050\nB,055')).toBe(',')
    expect(detectDelimiter('Name;Price\nOil;12,50\nLotion;8,00')).toBe(';')
    expect(detectDelimiter('Name\tPhone\nA\t050')).toBe('\t')
    expect(detectDelimiter('sep=;\nName;Phone\nA;050')).toBe(';')
    expect(detectDelimiter('﻿Name,Notes\n"Sara","likes; firm pressure, hot stones"')).toBe(',')
    expect(detectDelimiter('Name\nSara')).toBe(',')
  })
})

describe('value parsing', () => {
  it('parses DD/MM/YYYY, YYYY-MM-DD and D-Mon-YYYY', () => {
    expect(parseDate('14/03/1990')).toBe('1990-03-14')
    expect(parseDate('4/3/1990')).toBe('1990-03-04')
    expect(parseDate('04.03.1990')).toBe('1990-03-04')
    expect(parseDate('1990-03-14')).toBe('1990-03-14')
    expect(parseDate('1990-03-14T00:00:00Z')).toBe('1990-03-14')
    expect(parseDate('5-Mar-1990')).toBe('1990-03-05')
    expect(parseDate('5 March 1990')).toBe('1990-03-05')
    expect(parseDate('Mar 5, 1990')).toBe('1990-03-05')
    expect(parseDate('14/03/90')).toBe('1990-03-14')
    expect(parseDate('٠٥/٠٣/١٩٩٠')).toBe('1990-03-05')
    expect(parseDate('32874')).toBe('1990-01-01')
  })
  it('rejects impossible dates', () => {
    expect(parseDate('31/02/1990')).toBeNull()
    expect(parseDate('1990')).toBeNull()
    expect(parseDate('5-Foo-1990')).toBeNull()
    expect(parseDate('yesterday')).toBeNull()
  })
  it('switches to month-first only when the column proves it', () => {
    expect(detectDateOrder(['03/14/1990', '04/02/1985'])).toBe('mdy')
    expect(detectDateOrder(['14/03/1990', '04/02/1985'])).toBe('dmy')
    expect(detectDateOrder(['04/02/1985'])).toBe('dmy')
    expect(parseDate('03/14/1990', 'mdy')).toBe('1990-03-14')
  })
  it('parses amounts and durations', () => {
    expect(parseAmount('AED 1,200.50')).toBe(1200.5)
    expect(parseAmount('1.200,50')).toBe(1200.5)
    expect(parseAmount('12,50')).toBe(12.5)
    expect(parseAmount('٣٥٠')).toBe(350)
    expect(parseAmount('free')).toBeNull()
    expect(parseDuration('60')).toBe(60)
    expect(parseDuration('90 min')).toBe(90)
    expect(parseDuration('1h 30min')).toBe(90)
    expect(parseDuration('1.5 hours')).toBe(90)
    expect(parseDuration('1:30')).toBe(90)
    expect(parseDuration('01:30:00')).toBe(90)
    expect(parseDuration('long')).toBeNull()
  })
  it('normalises UAE mobiles in every common shape', () => {
    for (const v of ['050 123 4567', '+971 50 123 4567', '00971501234567', '501234567', '٠٥٠١٢٣٤٥٦٧'])
      expect(normalisePhone(v)).toBe('971501234567')
    expect(normalisePhone('+44 7700 900123')).toBeNull()
    expect(normalisePhone('9.71501E+11')).toBeNull()
  })
})

describe('mapping and validation', () => {
  it('auto-maps Fresha-style and template headers', () => {
    expect(
      autoMap('clients', [
        'First Name',
        'Last Name',
        'Mobile Number',
        'Email',
        'Date of Birth',
        'Client Notes',
      ]),
    ).toEqual(['firstName', 'lastName', 'phone', 'email', 'birthday', 'notes'])
    expect(
      autoMap('menu', [
        'Category',
        'Service name (English)',
        'Service name (Arabic)',
        'Duration (min)',
        'Price (AED)',
      ]),
    ).toEqual(['category', 'nameEn', 'nameAr', 'duration', 'price'])
    expect(autoMap('products', ['Product Name', 'SKU', 'Supply Price', 'Retail Price', 'Stock Qty'])).toEqual(
      ['name', 'sku', 'cost', 'price', 'stock'],
    )
    expect(missingRequired('clients', ['firstName', 'phone'])).toEqual([])
    expect(missingRequired('menu', ['nameEn', 'price'])).toEqual(['Duration (min)'])
  })
  it('validates rows, reports errors with row numbers and flags in-file duplicates', () => {
    const mapping = ['name', 'phone', 'gender', 'birthday', 'tags', 'email']
    const rows = validateRows(
      'clients',
      [
        ['Fatima', '050 123 4567', 'F', '14/03/1990', 'vip; Regular, vip', 'f@x.ae'],
        ['', '0559876543', '', '', '', ''],
        ['Sara', '+44 7700 900123', 'robot', '31/02/1990', '', ''],
        ['Fatima A.', '+971501234567', '', '', '', ''],
        ['No Phone', '', '', '', '', ''],
      ],
      mapping,
    )
    expect(rows[0]).toMatchObject({
      row: 2,
      errors: [],
      key: '971501234567',
      record: { name: 'Fatima', gender: 'female', birthday: '1990-03-14', tags: ['vip', 'Regular'] },
    })
    expect(rows[0]!.record).not.toHaveProperty('email')
    expect(rows[1]!.errors).toEqual(['Name is missing'])
    expect(rows[2]!.errors).toHaveLength(3)
    expect(rows[3]).toMatchObject({ row: 5, dupOfRow: 2 })
    expect(rows[4]).toMatchObject({ key: 'name:no phone', errors: [] })
  })
  it('drops blank rows but keeps spreadsheet row numbers, and strips values from messages', () => {
    const rows = validateRows(
      'products',
      [
        ['Oil', 'x'],
        ['', ' '],
        ['Lotion', ''],
      ],
      ['name', 'cost'],
      3,
    )
    expect(rows.map((r) => r.row)).toEqual([3, 5])
    expect(rows[0]!.errors).toEqual(['Cost “x” should be a number of 0 or more'])
    expect(withoutValues(rows[0]!.errors[0]!)).toBe('Cost “…” should be a number of 0 or more')
  })
})

describe('CSV output', () => {
  it('quotes everything and neutralises formulas but keeps negative numbers', () => {
    expect(csvCell('Sara "the boss"')).toBe('"Sara ""the boss"""')
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"')
    expect(csvCell('+971501234567')).toBe('"\'+971501234567"')
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"')
    expect(csvCell('-12.50')).toBe('"-12.50"')
    expect(csvCell('-cmd')).toBe('"\'-cmd"')
    expect(csvCell(null)).toBe('""')
    expect(csvCell(['vip', 'regular'])).toBe('"vip; regular"')
    expect(csvCell({ en: 'Oil' })).toBe('"{""en"":""Oil""}"')
    expect(toCsv([['a', 1]])).toBe('﻿"a","1"\r\n')
  })
})

const { platform, app } = testDbs()
const ids = {} as Record<string, string>

describe('database import and export', () => {
  beforeAll(async () => {
    await resetTestDatabase()
    const [t] = await platform.insert(tenants).values({ slug: 'dataio', name: 'Data Spa' }).returning()
    ids.tenant = t!.id
    const [b] = await platform
      .insert(branches)
      .values({ tenantId: t!.id, name: 'Main', isDefault: true })
      .returning()
    ids.branch = b!.id
    await platform
      .insert(clients)
      .values({ tenantId: t!.id, name: 'Existing', phoneE164: '971501234567', tags: ['vip'] })
  })
  afterAll(closeAllDbs)

  const clientRows = (mapping: string[], data: string[][]) => validateRows('clients', data, mapping)
  const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)

  it('skips or updates duplicates by normalised phone, in chunks', async () => {
    const mapping = ['name', 'phone', 'tags']
    const data = [
      ['Fatima', '0501234567', 'regular'],
      ['Noura', '055 111 2222', ''],
      ['Bad', '123', ''],
      ['Noura again', '+971551112222', ''],
      ['Walk-in Guest', '', ''],
    ]
    const rows = clientRows(mapping, data)
    expect(await tx((t) => existingRows(t, 'clients', rows))).toEqual(new Set([2]))

    const skip = await runImport({
      tenantId: ids.tenant!,
      kind: 'clients',
      rows,
      onDuplicate: 'skip',
      chunkSize: 2,
      db: app,
    })
    expect(skip).toMatchObject({ total: 5, created: 2, updated: 0, skipped: 2 })
    expect(skip.errors).toEqual([{ row: 4, message: expect.stringContaining('not a UAE mobile') }])
    const [kept] = await platform.select().from(clients).where(eq(clients.phoneE164, '971501234567'))
    expect(kept).toMatchObject({ name: 'Existing', tags: ['vip'] })

    const update = await runImport({
      tenantId: ids.tenant!,
      kind: 'clients',
      rows: clientRows(mapping, data),
      onDuplicate: 'update',
      db: app,
    })
    expect(update).toMatchObject({ created: 0, updated: 3, skipped: 1 })
    const [merged] = await platform.select().from(clients).where(eq(clients.phoneE164, '971501234567'))
    expect(merged).toMatchObject({ name: 'Existing', tags: ['vip', 'regular'] })
    const all = await platform.select().from(clients).where(eq(clients.tenantId, ids.tenant!))
    expect(all).toHaveLength(3)
  })

  it('update mode keeps the name and existing notes, appending new notes once', async () => {
    await platform
      .update(clients)
      .set({ notes: 'Allergic to nuts' })
      .where(eq(clients.phoneE164, '971501234567'))
    const rows = clientRows(['name', 'phone', 'notes'], [['Renamed', '0501234567', 'Firm pressure']])
    for (const _ of [1, 2])
      await runImport({ tenantId: ids.tenant!, kind: 'clients', rows, onDuplicate: 'update', db: app })
    const [c] = await platform.select().from(clients).where(eq(clients.phoneE164, '971501234567'))
    expect(c).toMatchObject({ name: 'Existing', notes: 'Allergic to nuts\nFirm pressure' })
  })

  it('imports a menu as services with duration variants and categories', async () => {
    const mapping = autoMap('menu', ['Category', 'Service', 'Name (AR)', 'Duration', 'Price'])
    const rows = validateRows(
      'menu',
      [
        ['Massage', 'Swedish massage', 'مساج سويدي', '60', '350'],
        ['Massage', 'Swedish massage', '', '1h 30min', 'AED 480'],
        ['Feet', 'Reflexology', '', '45 min', '220'],
      ],
      mapping,
    )
    const first = await runImport({ tenantId: ids.tenant!, kind: 'menu', rows, onDuplicate: 'skip', db: app })
    expect(first).toMatchObject({ created: 3, errors: [] })
    const again = await runImport({
      tenantId: ids.tenant!,
      kind: 'menu',
      rows,
      onDuplicate: 'update',
      db: app,
    })
    expect(again).toMatchObject({ created: 0, updated: 3 })
  })

  it('imports products with opening stock posted at cost against equity', async () => {
    const mapping = ['name', 'sku', 'cost', 'price', 'stock']
    const rows = validateRows(
      'products',
      [
        ['Lavender oil', 'OIL-1', '40', '', '10'],
        ['Lotion', '', '20', '95', ''],
      ],
      mapping,
    )
    const res = await runImport({
      tenantId: ids.tenant!,
      kind: 'products',
      rows,
      onDuplicate: 'update',
      db: app,
    })
    expect(res).toMatchObject({ created: 2, errors: [] })
    const [oil] = await platform.select().from(products).where(eq(products.sku, 'OIL-1'))
    const [level] = await platform.select().from(stockLevels).where(eq(stockLevels.productId, oil!.id))
    expect(Number(level!.qty)).toBe(10)
    const lines = await platform.select().from(journalLines).where(eq(journalLines.tenantId, ids.tenant!))
    expect(lines.reduce((s, l) => s + Number(l.debitAed), 0)).toBe(400)

    // A recount through the same file (by SKU) adjusts the level instead of creating a product.
    const recount = validateRows('products', [['Lavender oil', 'oil-1', '40', '', '7']], mapping)
    const r2 = await runImport({
      tenantId: ids.tenant!,
      kind: 'products',
      rows: recount,
      onDuplicate: 'update',
      db: app,
    })
    expect(r2).toMatchObject({ created: 0, updated: 1 })
    const [after] = await platform.select().from(stockLevels).where(eq(stockLevels.productId, oil!.id))
    expect(Number(after!.qty)).toBe(7)
  })

  it('keeps same-named products with different SKUs apart, in the preview and the import', async () => {
    const rows = validateRows(
      'products',
      [
        ['Massage oil', 'MO-1', '10'],
        ['Massage oil', 'MO-2', '12'],
        ['Lavender oil', 'OIL-9', '5'],
        ['Lotion', 'LOT-1', '20'],
        ['Lotion', 'LOT-1', '20'],
      ],
      ['name', 'sku', 'cost'],
    )
    // Lavender oil already has SKU oil-1 (a second product); Lotion had no SKU, so row 5 takes it over.
    expect(await tx((t) => existingRows(t, 'products', rows))).toEqual(new Set([5]))
    const res = await runImport({
      tenantId: ids.tenant!,
      kind: 'products',
      rows,
      onDuplicate: 'update',
      db: app,
    })
    expect(res).toMatchObject({ created: 3, updated: 1, skipped: 1, errors: [] })
    const all = await platform.select().from(products).where(eq(products.tenantId, ids.tenant!))
    expect(all.map((p) => p.sku).sort()).toEqual(['LOT-1', 'MO-1', 'MO-2', 'OIL-9', 'oil-1'])
  })

  it('exports clients with phones only when allowed, and a full dump without secrets', async () => {
    const withPhones = await tx((t) => exportRows(t, 'clients', {}, { phones: true }))
    expect(withPhones[0]).toContain('Mobile')
    expect(withPhones.flat()).toContain('050 123 4567')
    const noPhones = await tx((t) => exportRows(t, 'clients', {}, { phones: false }))
    expect(noPhones[0]).not.toContain('Mobile')
    expect(noPhones.flat()).not.toContain('050 123 4567')
    const future = await tx((t) => exportRows(t, 'clients', { from: '2099-01-01' }, { phones: true }))
    expect(future).toHaveLength(1)

    const tables = await tx((t) => fullExportTables(t, { phones: false }))
    const names = tables.map((t) => t.table)
    expect(names).toEqual(expect.arrayContaining(['clients', 'services', 'products', 'sales', 'audit_log']))
    expect(names).not.toContain('user')
    expect(names).not.toContain('tenants')
    const header = tables.flatMap((t) => t.rows[0] as string[])
    expect(header).not.toContain('token_enc')
    expect(header).not.toContain('tenant_id')
    expect(header).not.toContain('bytes')
    const clientTable = tables.find((t) => t.table === 'clients')!
    expect(clientTable.rows).toHaveLength(4)
    expect(clientTable.rows.flat()).not.toContain('971501234567')
    expect(
      fullExportReadme({
        spa: 'Data Spa',
        slug: 'dataio',
        generatedAt: new Date(),
        tables: [{ file: 'clients.csv', count: 3 }],
        phones: false,
      }),
    ).toContain('clients.csv')
  })
})
