import { daySheetColumns } from '@spa/core'
import { withTenant } from '@spa/db'
import { daySheet, daySheetFilename } from '@spa/services'
import { logoForPdf, renderDaySheetPdf } from '@spa/services/day-sheet-pdf'
import { notFound } from 'next/navigation'
import { can, requireMember } from '@/server/access'
import { closerName, pdfLang } from '@/server/day-sheet'
import { DATE, pickBranch } from '../../data'

/**
 * R32: the daily sales sheet of any business day up to today as a PDF, rendered live in the viewer's language
 * (Daily close → Download). `?date=YYYY-MM-DD&branch=…&tips=on|off&commission=on|off` (columns default to Settings).
 */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'pos.close')) notFound()
  const sp = new URL(req.url).searchParams
  const date = sp.get('date') ?? ''
  const branchId = sp.get('branch') || undefined
  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const picked = await pickBranch(tx, ctx, branchId)
    if (!picked || (branchId && picked.branch.id !== branchId)) return null
    if (!DATE.test(date) || date > picked.today) return null
    const sheet = await daySheet(tx, picked.branch.id, date)
    return { sheet, logo: await logoForPdf(tx, sheet.logoFileId) }
  })
  if (!data) notFound()
  const { sheet, logo } = data
  if (sheet.close) sheet.close.closedByName = await closerName(sheet.close.closedBy)
  const defaults = daySheetColumns(ctx.tenant.settings)
  const flag = (key: string, fallback: boolean) => {
    // The Daily close form's switches submit on/off; links may use 1/0.
    const v = sp.get(key)
    return v === '1' || v === 'on' ? true : v === '0' || v === 'off' ? false : fallback
  }
  const pdf = await renderDaySheetPdf({
    ...sheet,
    lang: await pdfLang(),
    columns: { tips: flag('tips', defaults.tips), commission: flag('commission', defaults.commission) },
    logo,
    generatedAt: new Date(),
  })
  const filename = daySheetFilename(sheet.date, sheet.branch.name, sheet.multiBranch)
  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename}"`,
      'content-length': String(pdf.length),
      'cache-control': 'no-store',
    },
  })
}
