import { withTenant } from '@spa/db'
import {
  dubaiStamp,
  EXPORT_DATASETS,
  exportRows,
  fullExportReadme,
  fullExportTables,
  isExportDataset,
  parseDate,
} from '@spa/services'
import { notFound } from 'next/navigation'
import { canExportAll, localHeader, xlsxDownload } from '@/components/data/server'
import { getLocale, getT } from '@/i18n/server'
import { todayDubai } from '@/lib/utils'
import { can, type MemberContext, requireMember } from '@/server/access'
import { audit } from '@/server/audit'

const DATE = /^\d{4}-\d{2}-\d{2}$/
/** YYYY-MM-DD that exists on the calendar (2026-02-31 is ignored rather than reaching Postgres). */
const isoDate = (s: string | null) => (s && DATE.test(s) && parseDate(s) === s ? s : null)

/** Tenants with a full export in progress: one zip at a time per spa keeps the shared droplet's memory safe. */
const fullRunning = new Set<string>()

/**
 * `?type=<dataset>&from=YYYY-MM-DD&to=YYYY-MM-DD` → one .xlsx (headers in the viewer's language); `?type=full` →
 * one .xlsx with a README sheet + a sheet per tenant table (owner level: every permission; English column names).
 * Phone numbers only for roles with clients.phone.
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
    if (!canExportAll(ctx)) notFound()
    if (fullRunning.has(ctx.tenant.id))
      return new Response('A full export is already being prepared. Try again in a minute.', {
        status: 429,
        headers: { 'retry-after': '60', 'cache-control': 'private, no-store' },
      })
    fullRunning.add(ctx.tenant.id)
    try {
      return await fullExport(ctx, phones, stamp, base)
    } finally {
      fullRunning.delete(ctx.tenant.id)
    }
  }

  if (!isExportDataset(type)) notFound()
  const meta = EXPORT_DATASETS[type]
  if (!can(ctx, meta.permission)) notFound()
  const from = isoDate(sp.get('from'))
  const to = isoDate(sp.get('to'))
  const range = meta.dated ? { from, to } : {}
  const rows = await withTenant(ctx.tenant.id, (tx) => exportRows(tx, type, range, { phones }))
  await audit({
    ...base,
    action: 'data.export',
    entity: type,
    data: { ...range, rows: rows.length - 1, phones },
  })
  const span = meta.dated && (from || to) ? `-${from ?? 'start'}-to-${to ?? stamp}` : `-${stamp}`
  const [t, locale] = await Promise.all([getT(), getLocale()])
  const label = t(`settings.data.export.datasets.${type}`)
  const period = !meta.dated
    ? t('sheets.asOf', { date: stamp })
    : from || to
      ? t('sheets.period', { from: from ?? '…', to: to ?? stamp })
      : t('sheets.allDates')
  const header = localHeader(locale)
  return xlsxDownload(`${type.replace('_', '-')}-${ctx.tenant.slug}${span}.xlsx`, {
    title: `${ctx.tenant.name} — ${label}`,
    sheets: [
      {
        name: label,
        title: `${ctx.tenant.name} — ${label}`,
        subtitle: `${period} · ${t('sheets.generated', { date: dubaiStamp(new Date()) })}`,
        rows: [(rows[0] ?? []).map((h) => header(String(h))), ...rows.slice(1)],
      },
    ],
  })
}

async function fullExport(
  ctx: MemberContext,
  phones: boolean,
  stamp: string,
  base: { tenantId: string; actorUserId: string; impersonatorUserId?: string },
) {
  const generatedAt = new Date()
  const tables = await withTenant(ctx.tenant.id, (tx) => fullExportTables(tx, { phones }))
  const counts = tables.map((t) => ({ table: t.table, count: t.rows.length - 1 }))
  const readme = fullExportReadme({
    spa: ctx.tenant.name,
    slug: ctx.tenant.slug,
    generatedAt,
    tables: counts,
    phones,
  })
  const subtitle = `${ctx.tenant.name} · ${dubaiStamp(generatedAt)} Asia/Dubai`
  const res = await xlsxDownload(`${ctx.tenant.slug}-export-${stamp}.xlsx`, {
    title: `${ctx.tenant.name} — full export`,
    sheets: [
      { name: 'README', notes: true, rows: readme.split('\r\n').map((line) => [line]) },
      ...tables.map((t) => ({ name: t.table, title: t.table, subtitle, rows: t.rows })),
    ],
  })
  await audit({
    ...base,
    action: 'data.export_full',
    data: { tables: counts.length, rows: counts.reduce((s, c) => s + c.count, 0), phones },
  })
  return res
}
