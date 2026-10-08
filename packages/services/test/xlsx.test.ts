import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { headerRowIndex } from '../src'
import { inferKind, MAX_CELL, readXlsx, sheetName, toXlsx } from '../src/xlsx'

const open = async (bytes: Uint8Array) => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer)
  return wb
}

describe('xlsx output', () => {
  it('writes a title block, bold frozen header with filter, typed cells and widths', async () => {
    const bytes = await toXlsx({
      sheets: [
        {
          name: 'Sales',
          title: 'Be Relax — Sales',
          subtitle: '2026-10-01 to 2026-10-31',
          rows: [
            ['Sale #', 'Business date', 'Client', 'Total AED', 'VAT rate %', 'Created', 'SKU', 'Tags'],
            [1, '2026-10-02', '=HYPERLINK("x")', '105.00', '5.00', '2026-10-02 14:05', '007', ['vip', 'new']],
            [2, '2026-10-03', 'سارة', '-20.50', '5.00', '2026-10-03 09:00', '', null],
          ],
        },
        { name: 'Sales', rows: [['Name'], ['second sheet, same name']] },
      ],
    })
    expect(Buffer.from(bytes.subarray(0, 2)).toString()).toBe('PK')
    const wb = await open(bytes)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Sales', 'Sales~2'])
    const ws = wb.worksheets[0]!
    expect(ws.getCell('A1').value).toBe('Be Relax — Sales')
    expect(ws.getCell('A1').font?.bold).toBe(true)
    expect(ws.getCell('A2').value).toBe('2026-10-01 to 2026-10-31')
    expect(ws.getRow(4).values).toEqual([
      undefined,
      'Sale #',
      'Business date',
      'Client',
      'Total AED',
      'VAT rate %',
      'Created',
      'SKU',
      'Tags',
    ])
    expect(ws.getCell('D4').font?.bold).toBe(true)
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 })
    expect(ws.autoFilter).toBeTruthy()

    expect(ws.getCell('A5').value).toBe(1)
    expect(ws.getCell('B5').value).toEqual(new Date('2026-10-02T00:00:00Z'))
    expect(ws.getCell('B5').numFmt).toBe('yyyy-mm-dd')
    // Text is never a formula in xlsx: kept verbatim, no apostrophe.
    expect(ws.getCell('C5').value).toBe('=HYPERLINK("x")')
    expect(ws.getCell('C6').value).toBe('سارة')
    expect(ws.getCell('D5').value).toBe(105)
    expect(ws.getCell('D6').value).toBe(-20.5)
    expect(ws.getCell('D5').numFmt).toContain('"AED"')
    expect(ws.getCell('E5').value).toBe(5)
    expect(ws.getCell('F5').value).toEqual(new Date('2026-10-02T14:05:00Z'))
    expect(ws.getCell('F5').numFmt).toBe('yyyy-mm-dd hh:mm')
    expect(ws.getCell('G5').value).toBe('007')
    expect(ws.getCell('H5').value).toBe('vip; new')
    expect(ws.getColumn(3).width).toBeGreaterThanOrEqual(15)
    expect(ws.getColumn(3).width).toBeLessThanOrEqual(60)
    expect(wb.worksheets[1]!.getCell('A1').value).toBe('Name')
  })

  it('keeps over-long text in full on a long_values sheet and writes instants as Dubai time', async () => {
    const long = 'x'.repeat(MAX_CELL + 5000)
    const wb = await open(
      await toXlsx({
        sheets: [
          {
            name: 'site_pages',
            rows: [
              ['id', 'document', 'created_at', 'active'],
              ['p1', long, new Date('2026-10-02T20:30:00Z'), true],
            ],
          },
        ],
      }),
    )
    const ws = wb.getWorksheet('site_pages')!
    expect(String(ws.getCell('B2').value).length).toBeLessThanOrEqual(MAX_CELL)
    expect(String(ws.getCell('B2').value)).toContain('long_values')
    expect(ws.getCell('C2').value).toEqual(new Date('2026-10-03T00:30:00Z'))
    expect(ws.getCell('D2').value).toBe(true)
    const lv = wb.getWorksheet('long_values')!
    const row = lv.getRow(2).values as unknown[]
    expect(row.slice(1, 5)).toEqual(['site_pages', 2, 'document', long.length])
    expect(row.slice(5).join('')).toBe(long)
  })

  it('infers kinds from header and values', () => {
    expect(inferKind('Price AED', ['1.00', '', null])).toBe('money')
    expect(inferKind('Mobile', ['0501234567'])).toBe('text')
    expect(inferKind('Account', ['6100'])).toBe('text')
    expect(inferKind('Qty', ['2.000'])).toBe('number')
    expect(inferKind('No-shows', [0, 3])).toBe('integer')
    expect(inferKind('Birthday', ['1990-01-02', ''])).toBe('date')
    expect(inferKind('Birthday', ['14/03/1990'])).toBe('text')
    expect(inferKind('Added', ['2026-10-02 14:05'])).toBe('datetime')
    expect(inferKind('Notes', [])).toBe('text')
  })

  it('cleans and dedupes sheet names', () => {
    const taken = new Set<string>()
    expect(sheetName('a/b:c', taken)).toBe('a b c')
    expect(sheetName('x'.repeat(40), taken)).toHaveLength(31)
    expect(sheetName('X'.repeat(40), taken)).toBe(`${'X'.repeat(29)}~2`)
  })
})

describe('xlsx input', () => {
  it('reads our own export back: title rows skipped by headerRowIndex, cells as importer text', async () => {
    const rows = await readXlsx(
      await toXlsx({
        sheets: [
          {
            name: 'clients',
            title: 'Spa — Clients',
            subtitle: 'All dates',
            rows: [
              ['Name', 'Mobile', 'Birthday', 'No-shows', 'Price AED'],
              ['Mariam', '050 765 4321', '1991-03-05', 2, '12.50'],
              ['', '', '', '', ''],
              ['Hessa', '0551112222', '', 0, '0.10'],
            ],
          },
        ],
      }),
    )
    const head = headerRowIndex(rows)
    expect(rows[head]).toEqual(['Name', 'Mobile', 'Birthday', 'No-shows', 'Price AED'])
    expect(head).toBe(3)
    expect(rows[head + 1]).toEqual(['Mariam', '050 765 4321', '1991-03-05', '2', '12.5'])
    expect(rows[head + 2]?.every((c) => c === '')).toBe(true)
    expect(rows[head + 3]).toEqual(['Hessa', '0551112222', '', '0', '0.1'])
  })

  it('reads rich text, formulas (their result) and Excel-native numbers and dates', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    ws.addRow(['Name', 'Mobile', 'Birthday', 'Total'])
    ws.addRow([
      { richText: [{ text: 'Fat' }, { text: 'ima' }] },
      971501234567,
      new Date(Date.UTC(1990, 2, 14)),
      { formula: 'B1*2', result: 0.30000000000000004 },
    ])
    const rows = await readXlsx(new Uint8Array(await wb.xlsx.writeBuffer()))
    expect(rows[1]).toEqual(['Fatima', '971501234567', '1990-03-14', '0.3'])
  })

  it('rejects files that are not workbooks', async () => {
    await expect(readXlsx(new TextEncoder().encode('Name,Mobile\r\n'))).rejects.toThrow()
  })
})
