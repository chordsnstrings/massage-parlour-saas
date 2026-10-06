// Server-only helpers for the import/export routes (CSV parsing with papaparse, downloads).
import { decodeCsvBytes, detectDelimiter, SEP_LINE } from '@spa/services'
import Papa from 'papaparse'

export type ParsedCsv = { headers: string[]; rows: string[][]; delimiter: string }

/** Uploaded file → header row + data rows (BOM, encoding, delimiter and Excel's sep= line handled). */
export async function parseCsvFile(file: Blob): Promise<ParsedCsv> {
  let text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))
  const delimiter = detectDelimiter(text)
  const firstBreak = text.search(/\r\n|\n|\r/)
  if (SEP_LINE.test(firstBreak < 0 ? text : text.slice(0, firstBreak)))
    text = firstBreak < 0 ? '' : text.slice(firstBreak).replace(/^(\r\n|\n|\r)/, '')
  const { data } = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: 'greedy' })
  const [head = [], ...rows] = data
  const width = Math.max(head.length, ...rows.slice(0, 200).map((r) => r.length))
  const headers = Array.from({ length: width }, (_, i) => head[i]?.trim() || `Column ${i + 1}`)
  return { headers, rows, delimiter }
}

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

/** Uploads must come from our own pages (cookies are SameSite=Lax, this is belt and braces). */
export const crossSite = (req: Request) => req.headers.get('sec-fetch-site') === 'cross-site'
