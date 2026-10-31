import { auditLog, withTenant } from '@spa/db'
import { type ImportError, isImportKind } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { IMPORT_PERMISSION } from '@/components/data/kinds'
import { xlsxDownload } from '@/components/data/server'
import { getT } from '@/i18n/server'
import { can, requireMember } from '@/server/access'

/** Row errors of a past import (from its audit-log summary) as .xlsx in the viewer's language. */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  const id = Number(new URL(req.url).searchParams.get('id'))
  if (!Number.isSafeInteger(id) || id <= 0) notFound()
  const [entry] = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.id, id), eq(auditLog.action, 'data.import'))),
  )
  const kind = entry?.entity ?? ''
  if (!entry || !isImportKind(kind) || !can(ctx, IMPORT_PERMISSION[kind])) notFound()
  const errors = ((entry.data as { errors?: ImportError[] } | null)?.errors ?? []).filter(
    (e) => typeof e?.row === 'number',
  )
  const t = await getT()
  const file = String((entry.data as { file?: string } | null)?.file ?? '')
  return xlsxDownload(`${kind}-import-errors-${id}.xlsx`, {
    sheets: [
      {
        name: t('sheets.importErrors'),
        title: `${ctx.tenant.name} — ${t('sheets.importErrors')}`,
        subtitle: t('sheets.importErrorsSub', { file, count: errors.length }),
        rows: [
          [t('sheets.columns.row'), t('sheets.columns.error')],
          ...errors.map((e) => [e.row, String(e.message ?? '')]),
        ],
      },
    ],
  })
}
