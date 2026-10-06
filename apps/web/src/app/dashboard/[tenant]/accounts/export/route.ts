import { withTenant } from '@spa/db'
import { notFound } from 'next/navigation'
import { can, requireMember } from '@/server/access'
import { journal, SOURCE_LABELS } from '../journal-data'
import { monthRange } from '../month'

const csv = (v: unknown) => {
  const s = v == null ? '' : String(v)
  // Quote everything and neutralise spreadsheet formulas.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replaceAll('"', '""')}"`
}

/** Journal lines for a month as CSV (for the accountant / FTA audit file). */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'accounting.view')) notFound()
  const range = monthRange(new URL(req.url).searchParams.get('month') ?? undefined)
  const entries = await withTenant(ctx.tenant.id, (tx) => journal(tx, range.from, range.to, 100_000))
  const rows = [['Date', 'Entry', 'Type', 'Memo', 'Account', 'Account name', 'Debit AED', 'Credit AED']]
  for (const e of [...entries].reverse())
    for (const l of e.lines)
      rows.push([
        e.entryDate,
        e.id,
        SOURCE_LABELS[e.sourceType] ?? e.sourceType,
        e.memo ?? '',
        l.code,
        l.name,
        l.debit,
        l.credit,
      ])
  const body = `﻿${rows.map((r) => r.map(csv).join(',')).join('\r\n')}\r\n`
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="journal-${ctx.tenant.slug}-${range.month}.csv"`,
      'cache-control': 'private, no-store',
    },
  })
}
