// Excel (.xlsx) output and input for every spreadsheet export/import (owner request R10, PLAN §14.8).
// Server-only subpath (`@spa/services/xlsx`): exceljs never reaches a client bundle (the main entry is imported by
// client components). Layout: title row (report), subtitle row (spa · period), blank row, bold frozen header with
// autofilter, typed cells (AED money, numbers, dates, date-times), widths from content, one sheet per table.
import { PassThrough } from 'node:stream'
import ExcelJS from 'exceljs'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type CellKind = 'text' | 'integer' | 'number' | 'money' | 'percent' | 'date' | 'datetime' | 'boolean'

export type XlsxSheet = {
  /** Tab name (cleaned and cut to Excel's 31 characters, made unique). */
  name: string
  /** Bold first row; omitted → no title block (header on row 1). */
  title?: string
  /** Second row, e.g. "Be Relax Spa · 2026-10-01 to 2026-10-31". */
  subtitle?: string
  /** First row = column headers. */
  rows: unknown[][]
  /** Per-column kinds; inferred from the header and values where missing. */
  kinds?: (CellKind | undefined)[]
  /** Free-text sheet (README): one column, wide, no header styling. */
  notes?: boolean
}

export type XlsxBook = { sheets: XlsxSheet[]; creator?: string; title?: string }

/** Excel's hard cap on characters in one cell. */
export const MAX_CELL = 32_767
const LONG_SHEET = 'long_values'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const STAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/
/** Numeric-looking text that must stay text (leading zeros, codes, phone numbers). */
const TEXT_HEADER = /sku|ref|code|mobile|phone|account|\bid$|_id$|^id$|iban|postcode|e164/i
const MONEY_HEADER = /\bAED\b|_aed$/i
const PERCENT_HEADER = /%|_rate$|vat_rate/i

const FMT: Record<CellKind, string | undefined> = {
  text: '@',
  integer: '#,##0',
  number: 'General',
  money: '"AED" #,##0.00;[Red]-"AED" #,##0.00',
  percent: '0.00',
  date: 'yyyy-mm-dd',
  datetime: 'yyyy-mm-dd hh:mm',
  boolean: undefined,
}

/** Dubai has no DST: wall time = UTC + 4 h. Excel has no time zones, so instants are written as Dubai wall time. */
const DUBAI_MS = 4 * 3600_000

const isNumeric = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && PLAIN_NUMBER.test(v))

/** Column kind from its header and every non-empty value. */
export function inferKind(header: string, values: unknown[]): CellKind {
  const filled = values.filter((v) => v != null && v !== '')
  if (MONEY_HEADER.test(header) && filled.every(isNumeric)) return 'money'
  if (!filled.length) return 'text'
  if (PERCENT_HEADER.test(header) && filled.every(isNumeric)) return 'percent'
  if (filled.every((v) => typeof v === 'boolean')) return 'boolean'
  if (filled.every((v) => v instanceof Date)) return 'datetime'
  if (filled.every((v) => typeof v === 'string' && DATE.test(v))) return 'date'
  if (filled.every((v) => typeof v === 'string' && STAMP.test(v))) return 'datetime'
  if (TEXT_HEADER.test(header)) return 'text'
  if (filled.every((v) => typeof v === 'number' && Number.isInteger(v))) return 'integer'
  if (filled.every(isNumeric)) return 'number'
  return 'text'
}

const textOf = (v: unknown): string => {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return v.every((x) => typeof x !== 'object') ? v.join('; ') : JSON.stringify(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** One value → the typed cell value for its column kind (strings are never formulas in xlsx, so no escaping). */
function cellValue(v: unknown, kind: CellKind): ExcelJS.CellValue {
  if (v == null || v === '') return null
  switch (kind) {
    case 'money':
    case 'percent':
    case 'number':
    case 'integer':
      return isNumeric(v) ? Number(v) : textOf(v)
    case 'boolean':
      return typeof v === 'boolean' ? v : textOf(v)
    case 'date': {
      const s = String(v)
      return DATE.test(s) ? new Date(`${s}T00:00:00Z`) : s
    }
    case 'datetime': {
      if (v instanceof Date) return new Date(v.getTime() + DUBAI_MS)
      const m = STAMP.exec(String(v))
      return m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0))) : String(v)
    }
    default:
      return textOf(v)
  }
}

const SHOWN: Record<CellKind, (v: unknown) => number> = {
  text: (v) => textOf(v).length,
  integer: (v) => textOf(v).length + 2,
  number: (v) => textOf(v).length + 1,
  money: (v) => textOf(v).length + 7,
  percent: (v) => textOf(v).length,
  date: () => 10,
  datetime: () => 16,
  boolean: () => 5,
}

/** Tab name: no []:*?/\, ≤ 31 characters, unique (case-insensitive) within the book. */
export function sheetName(name: string, taken: Set<string>): string {
  const base =
    name
      .replace(/[[\]:*?/\\]/g, ' ')
      .trim()
      .slice(0, 31) || 'Sheet'
  let out = base
  for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${base.slice(0, 31 - String(i).length - 1)}~${i}`
  taken.add(out.toLowerCase())
  return out
}

const THIN = { style: 'thin' as const, color: { argb: 'FF9CA3AF' } }

/**
 * Builds the workbook with exceljs' streaming writer (rows are committed as they go, so a full export stays light
 * on memory). Text longer than Excel's cell limit is cut with a pointer to a `long_values` sheet that holds the
 * whole value in 32 000-character parts, so nothing is lost.
 */
export async function toXlsx(book: XlsxBook): Promise<Uint8Array> {
  const stream = new PassThrough()
  const chunks: Buffer[] = []
  stream.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((resolve, reject) => {
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false })
  wb.creator = book.creator ?? 'spamanagement.co'
  if (book.title) wb.title = book.title
  wb.created = new Date()
  const taken = new Set<string>([LONG_SHEET])
  const long: unknown[][] = []

  for (const sheet of book.sheets) {
    const [header = [], ...data] = sheet.rows
    const heads = header.map((h) => textOf(h))
    const width = Math.max(heads.length, ...data.map((r) => r.length), 1)
    const name = sheetName(sheet.name, taken)

    if (sheet.notes) {
      const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: 'FF6B7280' } } })
      ws.columns = [{ width: 110 }]
      if (sheet.title) {
        const r = ws.addRow([sheet.title])
        r.font = { bold: true, size: 14 }
        r.commit()
      }
      for (const row of sheet.rows) ws.addRow([textOf(row[0])]).commit()
      ws.commit()
      continue
    }

    const kinds = Array.from(
      { length: width },
      (_, i) =>
        sheet.kinds?.[i] ??
        inferKind(
          heads[i] ?? '',
          data.map((r) => r[i]),
        ),
    )
    const top = sheet.title ? (sheet.subtitle ? 3 : 2) : 0
    const headerRow = top + 1
    const ws = wb.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: headerRow, xSplit: 0, topLeftCell: `A${headerRow + 1}` }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    })
    ws.columns = kinds.map((kind, i) => {
      let w = (heads[i] ?? '').length + 2
      for (const r of data.slice(0, 2000)) w = Math.max(w, SHOWN[kind](r[i]) + 2)
      return { width: Math.min(Math.max(w, 8), 60), style: FMT[kind] ? { numFmt: FMT[kind] } : {} }
    })
    if (sheet.title) {
      const t = ws.addRow([sheet.title])
      t.getCell(1).style = { font: { bold: true, size: 14 } }
      t.height = 22
      t.commit()
      if (sheet.subtitle) {
        const s = ws.addRow([sheet.subtitle])
        s.getCell(1).style = { font: { size: 10, color: { argb: 'FF6B7280' } } }
        s.commit()
      }
      ws.addRow([]).commit()
    }
    const h = ws.addRow(Array.from({ length: width }, (_, i) => heads[i] ?? ''))
    h.eachCell({ includeEmpty: true }, (c) => {
      c.style = {
        font: { bold: true },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } },
        border: { bottom: THIN },
        alignment: { vertical: 'middle', wrapText: true },
      }
    })
    h.commit()
    data.forEach((r, ri) => {
      const values = kinds.map((kind, i) => {
        const v = cellValue(r[i], kind)
        if (typeof v !== 'string' || v.length <= MAX_CELL) return v
        long.push([name, headerRow + ri + 1, heads[i] ?? `Column ${i + 1}`, v.length, ...parts(v)])
        const note = ` … [full value: sheet ${LONG_SHEET}, row ${long.length + 1}]`
        return v.slice(0, MAX_CELL - note.length) + note
      })
      ws.addRow(values).commit()
    })
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: width } }
    ws.commit()
  }

  if (long.length) {
    const ws = wb.addWorksheet(LONG_SHEET)
    ws.columns = [{ width: 24 }, { width: 8 }, { width: 24 }, { width: 10 }]
    const h = ws.addRow(['Sheet', 'Row', 'Column', 'Length', 'Value (in parts)'])
    h.font = { bold: true }
    h.commit()
    for (const r of long) ws.addRow(r).commit()
    ws.commit()
  }
  await wb.commit()
  await done
  return new Uint8Array(Buffer.concat(chunks))
}

const parts = (s: string) =>
  Array.from({ length: Math.ceil(s.length / 32_000) }, (_, i) => s.slice(i * 32_000, (i + 1) * 32_000))

// ---------------------------------------------------------------------------
// Reading (data import)
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0')

/** A cell as the text the importer expects (dates → YYYY-MM-DD, numbers without float noise). */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return ''
  if (v instanceof Date) {
    const d = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
    return v.getUTCHours() || v.getUTCMinutes() ? `${d} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}` : d
  }
  if (typeof v === 'number') return String(Number(v.toPrecision(15)))
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((p) => p.text).join('')
    if ('formula' in v || 'sharedFormula' in v)
      return cellText((v as { result?: ExcelJS.CellValue }).result ?? null)
    if ('text' in v) return String(v.text)
    if ('error' in v) return ''
  }
  return String(v)
}

/** First worksheet of an .xlsx file as text rows (row i = spreadsheet row i + 1). Throws on unreadable files. */
export async function readXlsx(bytes: Uint8Array, maxRows = 100_000): Promise<string[][]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer)
  const ws = wb.worksheets.find((w) => w.state !== 'hidden' && w.actualRowCount > 0) ?? wb.worksheets[0]
  if (!ws) return []
  const rows: string[][] = []
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    if (n > maxRows) return
    const out: string[] = []
    row.eachCell({ includeEmpty: true }, (c, col) => {
      out[col - 1] = cellText(c.value)
    })
    rows[n - 1] = Array.from(out, (x) => x ?? '')
  })
  return Array.from(rows, (r) => r ?? [])
}
