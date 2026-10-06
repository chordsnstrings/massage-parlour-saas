import { withTenant } from '@spa/db'
import {
  EXPORT_DATASETS,
  exportRows,
  fullExportReadme,
  fullExportTables,
  isExportDataset,
  toCsv,
} from '@spa/services'
import { strToU8, zipSync } from 'fflate'
import { notFound } from 'next/navigation'
import { csvDownload } from '@/components/data/server'
import { todayDubai } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { audit } from '@/server/audit'

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * `?type=<dataset>&from=YYYY-MM-DD&to=YYYY-MM-DD` → one CSV; `?type=full` → zip of every tenant table + README
 * (owner-level settings.manage). Phone numbers only for roles with clients.phone.
 */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  const sp = new URL(req.url).searchParams
  const type = sp.get('type') ?? ''
  const phones = can(ctx, 'clients.phone')
  const stamp = todayDubai()
  const base = {
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
  }

  if (type === 'full') {
    if (!can(ctx, 'settings.manage')) notFound()
    const generatedAt = new Date()
    const tables = await withTenant(ctx.tenant.id, (tx) => fullExportTables(tx, { phones }))
    const counts = tables.map((t) => ({ file: t.file, count: t.rows.length - 1 }))
    const files: Record<string, Uint8Array> = {
      'README.txt': strToU8(
        fullExportReadme({
          spa: ctx.tenant.name,
          slug: ctx.tenant.slug,
          generatedAt,
          tables: counts,
          phones,
        }),
      ),
    }
    for (const t of tables) files[t.file] = strToU8(toCsv(t.rows))
    const zip = zipSync(files, { level: 6 })
    await audit({
      ...base,
      action: 'data.export_full',
      data: { tables: counts.length, rows: counts.reduce((s, c) => s + c.count, 0), phones },
    })
    return csvDownload(
      `${ctx.tenant.slug}-export-${stamp}.zip`,
      new Blob([zip as BlobPart]),
      'application/zip',
    )
  }

  if (!isExportDataset(type)) notFound()
  const meta = EXPORT_DATASETS[type]
  if (!can(ctx, meta.permission)) notFound()
  const from = DATE.test(sp.get('from') ?? '') ? sp.get('from') : null
  const to = DATE.test(sp.get('to') ?? '') ? sp.get('to') : null
  const range = meta.dated ? { from, to } : {}
  const rows = await withTenant(ctx.tenant.id, (tx) => exportRows(tx, type, range, { phones }))
  await audit({
    ...base,
    action: 'data.export',
    entity: type,
    data: { ...range, rows: rows.length - 1, phones },
  })
  const span = meta.dated && (from || to) ? `-${from ?? 'start'}-to-${to ?? stamp}` : `-${stamp}`
  return csvDownload(`${type.replace('_', '-')}-${ctx.tenant.slug}${span}.csv`, toCsv(rows))
}
