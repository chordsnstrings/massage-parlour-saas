import { createTranslator, en } from '@spa/core/i18n'
import { withTenant } from '@spa/db'
import { notFound } from 'next/navigation'
import { xlsxDownload } from '@/components/data/server'
import { can, requireMember } from '@/server/access'
import { journal } from '../journal-data'
import { sourceLabel } from '../labels'
import { monthRange } from '../month'

// The audit file keeps fixed English headers and labels whatever the viewer's language.
const english = createTranslator('en', en)
/** Journal lines for a month as .xlsx (for the accountant / FTA audit file; English whatever the viewer's language). */
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
        sourceLabel(english, e.sourceType),
        e.memo ?? '',
        l.code,
        l.name,
        l.debit,
        l.credit,
      ])
  return xlsxDownload(`journal-${ctx.tenant.slug}-${range.month}.xlsx`, {
    title: `${ctx.tenant.name} — Journal ${range.month}`,
    sheets: [
      {
        name: `Journal ${range.month}`,
        title: `${ctx.tenant.name} — General journal`,
        subtitle: `${range.from} to ${range.to} · ${rows.length - 1} lines · amounts in AED`,
        rows,
        kinds: ['date', undefined, 'text', 'text', 'text', 'text', 'money', 'money'],
      },
    ],
  })
}
