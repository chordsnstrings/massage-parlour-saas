import { auditLog, withTenant } from '@spa/db'
import { EXPORT_DATASETS, type ExportDataset, IMPORT_KINDS, type ImportKind } from '@spa/services'
import { desc, eq } from 'drizzle-orm'
import { ArrowLeft, ArrowRight, Download, FileArchive, Package, Sparkles, Upload, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { IMPORT_LABEL, IMPORT_PERMISSION } from '@/components/data/kinds'
import { canExportAll } from '@/components/data/server'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { type Column, DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { formatDateTime, todayDubai } from '@/lib/utils'
import { can, requireMember } from '@/server/access'

export const metadata: Metadata = { title: 'Import & export' }

const IMPORT_CARDS: Record<ImportKind, { icon: typeof Users; text: string }> = {
  clients: {
    icon: Users,
    text: 'Name, mobile, gender, birthday, tags, notes and language. Existing clients are matched by mobile number.',
  },
  menu: {
    icon: Sparkles,
    text: 'Category, service name in English and Arabic, duration and price. Each duration becomes a bookable option.',
  },
  products: {
    icon: Package,
    text: 'Name, SKU, unit, cost, price and stock on hand. Opening stock is valued at cost in your accounts.',
  },
}

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
  const importable = IMPORT_KINDS.filter((k) => can(ctx, IMPORT_PERMISSION[k]))
  const exportable = (Object.keys(EXPORT_DATASETS) as ExportDataset[]).filter((d) =>
    can(ctx, EXPORT_DATASETS[d].permission),
  )
  const full = canExportAll(ctx)
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
      header: 'File',
      primary: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{r.data.file ?? 'import.csv'}</span>
          <span className="text-[13px] text-muted md:hidden">{formatDateTime(r.at)}</span>
        </span>
      ),
    },
    { key: 'kind', header: 'Type', cell: (r) => <Badge>{IMPORT_LABEL[r.kind]}</Badge> },
    {
      key: 'when',
      header: 'When',
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-muted">{formatDateTime(r.at)}</span>,
    },
    {
      key: 'result',
      header: 'Result',
      cell: (r) => (
        <span className="tabular-nums">
          {r.data.created ?? 0} new · {r.data.updated ?? 0} updated · {r.data.skipped ?? 0} skipped
        </span>
      ),
    },
    {
      key: 'errors',
      header: 'Errors',
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
      header: 'By',
      hideOnMobile: true,
      cell: (r) => <span className="text-muted">{r.data.by ?? '—'}</span>,
    },
  ]

  return (
    <>
      <Link
        href={appPath(`/${slug}/settings`)}
        className="mb-6 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} /> Settings
      </Link>
      <PageHeader
        title="Import & export"
        description="Bring clients, your menu and products in from a spreadsheet — and take your data with you whenever you like."
      />
      <PageBody>
        {importable.length > 0 && (
          <section aria-labelledby="import-heading" className="space-y-4">
            <div className="space-y-1">
              <h2 id="import-heading" className="text-[15px] font-semibold tracking-tight">
                Import from CSV
              </h2>
              <p className="text-sm text-muted">
                Excel, Google Sheets, Fresha and most booking systems export CSV. You check every column
                before anything is saved.
              </p>
            </div>
            <Stagger className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
              {importable.map((kind) => {
                const card = IMPORT_CARDS[kind]
                return (
                  <StaggerItem key={kind} className="h-full">
                    <Card className="flex h-full flex-col transition-[border-color,box-shadow] duration-200 hover:border-fg/15 hover:shadow-soft">
                      <CardBody className="flex-1 space-y-3">
                        <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent">
                          <card.icon className="size-4" strokeWidth={1.5} />
                        </span>
                        <h3 className="text-[15px] font-semibold tracking-tight">{IMPORT_LABEL[kind]}</h3>
                        <p className="text-sm text-muted">{card.text}</p>
                      </CardBody>
                      <CardFooter className="justify-between">
                        <Button asChild variant="ghost" size="sm" className="h-11 md:h-9">
                          <a
                            href={appPath(`${base}/template?kind=${kind}`)}
                            aria-label={`Download ${IMPORT_LABEL[kind].toLowerCase()} template`}
                          >
                            <Download strokeWidth={1.5} /> Template
                          </a>
                        </Button>
                        <Button asChild size="sm" className="h-11 md:h-9">
                          <Link href={appPath(`${base}/import/${kind}`)}>
                            Import {IMPORT_LABEL[kind].toLowerCase()} <ArrowRight strokeWidth={1.5} />
                          </Link>
                        </Button>
                      </CardFooter>
                    </Card>
                  </StaggerItem>
                )
              })}
            </Stagger>
          </section>
        )}

        {(exportable.length > 0 || full) && (
          <div className="grid gap-6 lg:grid-cols-12">
            {exportable.length > 0 && (
              <Card className={full ? 'lg:col-span-7' : 'lg:col-span-12'}>
                <CardHeader
                  title="Export a CSV"
                  description="Opens in Excel or Google Sheets. Leave the dates empty for everything."
                />
                <form method="get" action={appPath(`${base}/export`)}>
                  <CardBody className="grid gap-5 sm:grid-cols-6">
                    <div className="space-y-1.5 sm:col-span-6">
                      <Label htmlFor="export-type">What to export</Label>
                      <Select id="export-type" name="type" defaultValue={exportable[0]}>
                        {exportable.map((d) => (
                          <option key={d} value={d}>
                            {EXPORT_DATASETS[d].label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-3">
                      <Label htmlFor="export-from">From</Label>
                      <Input id="export-from" name="from" type="date" max={todayDubai()} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-3">
                      <Label htmlFor="export-to">To</Label>
                      <Input id="export-to" name="to" type="date" />
                    </div>
                    <p className="text-[13px] text-muted sm:col-span-6">
                      Dates filter clients by when they were added, bookings, sales and payments by business
                      day and expenses by expense date. Products export today’s stock.
                      {!can(ctx, 'clients.phone') && ' Phone numbers are left out for your role.'}
                    </p>
                  </CardBody>
                  <CardFooter>
                    <Button type="submit" className="h-11 w-full sm:w-auto md:h-10">
                      <Download strokeWidth={1.5} /> Download CSV
                    </Button>
                  </CardFooter>
                </form>
              </Card>
            )}
            {full && (
              <Card
                className={exportable.length ? 'flex flex-col lg:col-span-5' : 'flex flex-col lg:col-span-12'}
              >
                <CardHeader
                  title="Full export"
                  description="Everything in your account as CSV files in one zip, with a README explaining each file."
                />
                <CardBody className="flex-1 space-y-3 text-sm text-muted">
                  <p>
                    Clients, bookings, sales, payments, packages, gift cards, the ledger, payroll, stock,
                    website pages and settings. Passwords, access tokens and uploaded files are never
                    included.
                  </p>
                  <p>Each download is recorded in the activity log.</p>
                </CardBody>
                <CardFooter>
                  <Button asChild variant="secondary" className="h-11 w-full sm:w-auto md:h-10">
                    <a href={appPath(`${base}/export?type=full`)}>
                      <FileArchive strokeWidth={1.5} /> Download .zip
                    </a>
                  </Button>
                </CardFooter>
              </Card>
            )}
          </div>
        )}

        {importable.length > 0 && (
          <Card>
            <CardHeader
              title="Recent imports"
              description="The last ten imports and what happened to each row."
            />
            <div className="mt-4 border-t">
              <DataTable
                columns={columns}
                rows={history}
                rowKey={(r) => String(r.id)}
                empty={
                  <EmptyState
                    icon={<Upload className="size-4" strokeWidth={1.5} />}
                    title="No imports yet"
                    description="Your imports will be listed here with a downloadable list of any rows that needed fixing."
                  />
                }
              />
            </div>
          </Card>
        )}
      </PageBody>
    </>
  )
}
