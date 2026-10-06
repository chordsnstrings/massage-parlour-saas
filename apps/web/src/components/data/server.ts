// Server-only helpers for the import/export routes (CSV parsing with papaparse, downloads).
import { ALL_PERMISSIONS } from '@spa/core'
import { decodeCsvBytes, detectDelimiter, isBlankRow, SEP_LINE } from '@spa/services'
import Papa from 'papaparse'
import { can, type MemberContext } from '@/server/access'

export type ParsedCsv = {
  headers: string[]
  /** Data rows, blank ones included so positions stay spreadsheet rows. */
  rows: string[][]
  /** Spreadsheet row number of rows[0]. */
  firstRow: number
  /** Non-blank data rows. */
  count: number
  delimiter: string
}

/** File bytes → header row + data rows (BOM, encoding, delimiter and Excel's sep= line handled). */
export function parseCsvFile(bytes: Uint8Array): ParsedCsv {
  let text = decodeCsvBytes(bytes)
  const delimiter = detectDelimiter(text)
  const firstBreak = text.search(/\r\n|\n|\r/)
  if (SEP_LINE.test(firstBreak < 0 ? text : text.slice(0, firstBreak)))
    text = firstBreak < 0 ? '' : text.slice(firstBreak).replace(/^(\r\n|\n|\r)/, '')
  const { data } = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false })
  const headAt = Math.max(
    0,
    data.findIndex((r) => !isBlankRow(r)),
  )
  const head = data[headAt] ?? []
  const rows = data.slice(headAt + 1)
  const width = Math.max(head.length, ...rows.slice(0, 200).map((r) => r.length))
  const headers = Array.from({ length: width }, (_, i) => head[i]?.trim() || `Column ${i + 1}`)
  const count = rows.reduce((n, r) => (isBlankRow(r) ? n : n + 1), 0)
  return { headers, rows, firstRow: headAt + 2, count, delimiter }
}

/** The full zip holds every table (ledger, payroll, subscription, clients), so it needs every permission. */
export const canExportAll = (ctx: MemberContext) => ALL_PERMISSIONS.every((p) => can(ctx, p))

export const csvDownload = (filename: string, body: BodyInit, type = 'text/csv; charset=utf-8') =>
  new Response(body, {
    headers: {
      'content-type': type,
      'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]+/g, '-')}"`,
      'cache-control': 'private, no-store',
    },
  })

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } })

/**
 * Uploads must come from our own pages: other tenant subdomains are same-site (SameSite=Lax cookies go
 * along), so only same-origin passes; browsers without Sec-Fetch-Site fall back to Origin == Host.
 */
export function crossSite(req: Request) {
  const site = req.headers.get('sec-fetch-site')
  if (site) return site !== 'same-origin'
  const origin = req.headers.get('origin')
  if (!origin) return false
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host'))?.split(',')[0]?.trim()
  try {
    return new URL(origin).host !== host
  } catch {
    return true
  }
}
