import { auditLog, withTenant } from '@spa/db'
import { EXPORT_DATASETS, type ExportDataset, IMPORT_KINDS, type ImportKind } from '@spa/services'
import { desc, eq } from 'drizzle-orm'
import { ArrowRight, Download, FileArchive, Package, Sparkles, Upload, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Grid, Pill, Stack } from '@/components/crm'
import { IMPORT_PERMISSION } from '@/components/data/kinds'
import { canExportAll } from '@/components/data/server'
import { Button } from '@/components/ui/button'
import { Input, Label, Select } from '@/components/ui/input'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { type Column, DataTable } from '@/components/ui/table'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { todayDubai } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { SettingsTabs } from '../settings-tabs'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('settings.data.title') }
}

const IMPORT_ICON: Record<ImportKind, typeof Users> = { clients: Users, menu: Sparkles, products: Package }

type ImportSummaryData = {
  file?: string
  by?: string
  created?: number
  updated?: number
  skipped?: number
  errorCount?: number
}
type HistoryRow = { id: number; kind: ImportKind; at: Date; data: ImportSummaryData }

export default async function DataPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  const slug = ctx.tenant.slug
  const { t, fmt } = await getI18n()
  const importable = IMPORT_KINDS.filter((k) => can(ctx, IMPORT_PERMISSION[k]))
  const exportable = (Object.keys(EXPORT_DATASETS) as ExportDataset[]).filter((d) =>
    can(ctx, EXPORT_DATASETS[d].permission),
  )
  const full = canExportAll(ctx)
  // F27: signed intake PDFs (.zip) for anyone who may export clients and read their forms.
  const intakePdfs = can(ctx, 'clients.export') && can(ctx, 'clients.view')
  if (!importable.length && !exportable.length && !full) notFound()

  const history: HistoryRow[] = importable.length
    ? (
        await withTenant(ctx.tenant.id, (tx) =>
          tx
            .select({ id: auditLog.id, kind: auditLog.entity, at: auditLog.createdAt, data: auditLog.data })
            .from(auditLog)
            .where(eq(auditLog.action, 'data.import'))
            .orderBy(desc(auditLog.createdAt))
            .limit(30),
        )
      )
        .filter((r): r is typeof r & { kind: ImportKind } => importable.includes(r.kind as ImportKind))
        .slice(0, 10)
        .map((r) => ({ ...r, data: (r.data ?? {}) as ImportSummaryData }))
    : []

  const base = `/${slug}/settings/data`
  const columns: Column<HistoryRow>[] = [
    {
      key: 'file',
      header: t('settings.data.history.file'),
      primary: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{r.data.file ?? 'import.csv'}</span>
          <span className="text-[13px] text-muted md:hidden">{fmt.dateTime(r.at)}</span>
        </span>
      ),
    },
    {
      key: 'kind',
      header: t('settings.data.history.type'),
      cell: (r) => <Pill>{t(`settings.data.kinds.${r.kind}`)}</Pill>,
    },
    {
      key: 'when',
      header: t('settings.data.history.when'),
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-muted">{fmt.dateTime(r.at)}</span>,
    },
    {
      key: 'result',
      header: t('settings.data.history.result'),
      cell: (r) => (
        <span className="tabular-nums">
          {t('settings.data.history.resultText', {
            created: fmt.number(r.data.created ?? 0),
            updated: fmt.number(r.data.updated ?? 0),
            skipped: fmt.number(r.data.skipped ?? 0),
          })}
        </span>
      ),
    },
    {
      key: 'errors',
      header: t('settings.data.history.errors'),
      className: 'text-end',
      cell: (r) =>
        r.data.errorCount ? (
          <a
            href={appPath(`${base}/errors?id=${r.id}`)}
            className="inline-flex min-h-11 items-center gap-1.5 text-danger underline-offset-4 hover:underline md:min-h-0"
          >
            <Download className="size-3.5" strokeWidth={1.5} />
            {r.data.errorCount}
          </a>
        ) : (
          <span className="text-muted">0</span>
        ),
    },
    {
      key: 'by',
      header: t('settings.data.history.by'),
      hideOnMobile: true,
      cell: (r) => <span className="text-muted">{r.data.by ?? '—'}</span>,
    },
  ]

  return (
    <>
      <PageHeader title={t('settings.data.title')} description={t('settings.data.description')} />
      <SettingsTabs ctx={ctx} value="data" />
      <Stack>
        {importable.length > 0 && (
          <section aria-labelledby="import-heading" className="crm-stack">
            <div className="space-y-1">
              <h2 id="import-heading" className="text-[15px] font-semibold tracking-tight">
                {t('settings.data.importTitle')}
              </h2>
              <p className="crm-muted text-sm">{t('settings.data.importSub')}</p>
            </div>
            <Grid cols="g3">
              {importable.map((kind) => {
                const Icon = IMPORT_ICON[kind]
                return (
                  <Card key={kind} className="flex h-full flex-col">
                    <div className="flex-1 space-y-3">
                      <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent">
                        <Icon className="size-4" strokeWidth={1.5} />
                      </span>
                      <h3 className="text-[15px] font-semibold tracking-tight">
                        {t(`settings.data.kinds.${kind}`)}
                      </h3>
                      <p className="crm-muted text-sm">{t(`settings.data.cards.${kind}`)}</p>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <Button asChild variant="ghost" size="sm" className="h-11 md:h-9">
                        <a
                          href={appPath(`${base}/template?kind=${kind}`)}
                          aria-label={t(`settings.data.downloadTemplate.${kind}`)}
                        >
                          <Download strokeWidth={1.5} /> {t('settings.data.template')}
                        </a>
                      </Button>
                      <Button asChild size="sm" className="h-11 md:h-9">
                        <Link href={appPath(`${base}/import/${kind}`)}>
                          {t(`settings.data.importKind.${kind}`)} <ArrowRight strokeWidth={1.5} />
                        </Link>
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </Grid>
          </section>
        )}

        {(exportable.length > 0 || full) && (
          <Grid cols={exportable.length > 0 && full ? 'col-2' : undefined}>
            {exportable.length > 0 && (
              <Card title={t('settings.data.export.title')} sub={t('settings.data.export.sub')}>
                <form method="get" action={appPath(`${base}/export`)} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="export-type">{t('settings.data.export.what')}</Label>
                      <Select id="export-type" name="type" defaultValue={exportable[0]}>
                        {exportable.map((d) => (
                          <option key={d} value={d}>
                            {t(`settings.data.export.datasets.${d}`)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="export-from">{t('settings.data.export.from')}</Label>
                      <Input id="export-from" name="from" type="date" max={todayDubai()} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="export-to">{t('settings.data.export.to')}</Label>
                      <Input id="export-to" name="to" type="date" />
                    </div>
                  </div>
                  <p className="crm-muted text-[13px]">
                    {t('settings.data.export.note')}
                    {!can(ctx, 'clients.phone') && ` ${t('settings.data.export.noPhones')}`}
                  </p>
                  <Button type="submit" className="h-11 w-full sm:w-auto md:h-10">
                    <Download strokeWidth={1.5} /> {t('settings.data.export.download')}
                  </Button>
                </form>
                {intakePdfs && (
                  <div className="mt-5 space-y-2 border-t border-[var(--crm-line)] pt-4">
                    <p className="text-sm font-semibold">{t('settings.data.intakePdfs.title')}</p>
                    <p className="crm-muted text-[13px]">{t('settings.data.intakePdfs.body')}</p>
                    <Button asChild variant="secondary" className="h-11 w-full sm:w-auto md:h-10">
                      <a href={appPath(`${base}/export?type=intake_pdfs`)} data-testid="intake-pdfs-export">
                        <FileArchive strokeWidth={1.5} /> {t('settings.data.intakePdfs.download')}
                      </a>
                    </Button>
                  </div>
                )}
              </Card>
            )}
            {full && (
              <Card
                className="flex flex-col"
                title={t('settings.data.full.title')}
                sub={t('settings.data.full.sub')}
              >
                <div className="crm-muted flex-1 space-y-3 text-sm">
                  <p>{t('settings.data.full.body')}</p>
                  <p>{t('settings.data.full.logged')}</p>
                </div>
                <div className="mt-4">
                  <Button asChild variant="secondary" className="h-11 w-full sm:w-auto md:h-10">
                    <a href={appPath(`${base}/export?type=full`)}>
                      <FileArchive strokeWidth={1.5} /> {t('settings.data.full.download')}
                    </a>
                  </Button>
                </div>
              </Card>
            )}
          </Grid>
        )}

        {importable.length > 0 && (
          <Card title={t('settings.data.history.title')} sub={t('settings.data.history.sub')} flush>
            <DataTable
              columns={columns}
              rows={history}
              rowKey={(r) => String(r.id)}
              empty={
                <EmptyState
                  icon={<Upload className="size-4" strokeWidth={1.5} />}
                  title={t('settings.data.history.empty')}
                  description={t('settings.data.history.emptySub')}
                />
              }
            />
          </Card>
        )}
      </Stack>
    </>
  )
}
