import { aiConfigured } from '@spa/ai'
import { enumLabel } from '@spa/core/i18n'
import { branches, products, purchaseLines, purchases, suppliers, withTenant } from '@spa/db'
import { and, asc, count, desc, eq, gte, lte } from 'drizzle-orm'
import { ShoppingBag } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Grid, Meter, Pill, Stack, Stat } from '@/components/crm'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { type Column, DataTable } from '@/components/ui/table'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { todayDubai } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { ReceiptThumb } from '../accounts/expenses/receipt-thumb'
import { MonthNav, monthLabel, monthRange } from '../accounts/month'
import { VoidButton } from '../accounts/void-button'
import { recordPurchaseAction, voidPurchaseAction } from './actions'
import { PurchaseSheet } from './purchase-sheet'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('purchases.title') }
}

export default async function PurchasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'inventory.purchase')) notFound()
  const { t, fmt } = await getI18n()
  const range = monthRange((await searchParams).month)
  const label = monthLabel(fmt, range.month)
  const slug = ctx.tenant.slug
  const data = await withTenant(ctx.tenant.id, async (tx) => ({
    rows: await tx
      .select({
        p: purchases,
        supplier: suppliers.name,
        branch: branches.name,
        items: count(purchaseLines.id),
      })
      .from(purchases)
      .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
      .leftJoin(branches, eq(branches.id, purchases.branchId))
      .leftJoin(purchaseLines, eq(purchaseLines.purchaseId, purchases.id))
      .where(and(gte(purchases.purchaseDate, range.from), lte(purchases.purchaseDate, range.to)))
      .groupBy(purchases.id, suppliers.name, branches.name)
      .orderBy(desc(purchases.purchaseDate), desc(purchases.createdAt)),
    suppliers: await tx
      .select({ name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.active, true))
      .orderBy(asc(suppliers.name)),
    products: await tx
      .select({ id: products.id, name: products.name, unit: products.unit, costAed: products.costAed })
      .from(products)
      .where(eq(products.active, true))
      .orderBy(asc(products.kind), asc(products.createdAt)),
    branches: await tx
      .select({ id: branches.id, name: branches.name, isDefault: branches.isDefault })
      .from(branches)
      .orderBy(desc(branches.isDefault), asc(branches.name)),
  }))
  type Row = (typeof data.rows)[number]
  const live = data.rows.filter((r) => r.p.status === 'recorded')
  const total = live.reduce((s, r) => s + Number(r.p.totalAed), 0)
  const vat = live.reduce((s, r) => s + Number(r.p.vatAed), 0)
  const byCategory = Object.entries(
    live.reduce<Record<string, number>>((acc, r) => {
      acc[r.p.category] = (acc[r.p.category] ?? 0) + Number(r.p.totalAed)
      return acc
    }, {}),
  ).sort((a, b) => b[1] - a[1])
  const day = (d: string) => fmt.date(`${d}T12:00:00Z`)
  const location = (r: Row) => r.branch ?? t('warehouse.location.warehouse')

  const columns: Column<Row>[] = [
    {
      key: 'what',
      header: t('purchases.col.purchase'),
      primary: true,
      cell: (r) => (
        <span className="flex items-center gap-3">
          {r.p.receiptUrl && <ReceiptThumb url={r.p.receiptUrl} label={t('purchases.viewReceipt')} />}
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">
              {r.supplier || enumLabel(t, 'purchaseCategory', r.p.category)}
            </span>
            <span className="crm-muted text-xs">
              {[
                enumLabel(t, 'purchaseCategory', r.p.category),
                t('purchases.items', { count: r.items }),
                r.p.reference,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        </span>
      ),
    },
    { key: 'date', header: t('purchases.col.date'), cell: (r) => day(r.p.purchaseDate) },
    { key: 'location', header: t('purchases.col.location'), hideOnMobile: true, cell: location },
    {
      key: 'paid',
      header: t('purchases.col.paid'),
      cell: (r) =>
        r.p.status === 'void' ? (
          <Pill tone="bad">{enumLabel(t, 'purchaseStatus', 'void')}</Pill>
        ) : (
          <Pill>{enumLabel(t, 'expensePaidVia', r.p.paidVia)}</Pill>
        ),
    },
    {
      key: 'vat',
      header: t('purchases.col.vat'),
      className: 'text-right tabular-nums',
      cell: (r) => (Number(r.p.vatAed) ? fmt.aed(r.p.vatAed) : '—'),
    },
    {
      key: 'total',
      header: t('purchases.col.total'),
      className: 'text-right tabular-nums font-medium',
      cell: (r) => (
        <span className={r.p.status === 'void' ? 'crm-muted line-through' : undefined}>
          {fmt.aed(r.p.totalAed)}
        </span>
      ),
    },
    {
      key: 'void',
      header: '',
      className: 'text-right',
      cell: (r) =>
        r.p.status === 'recorded' ? (
          <VoidButton action={voidPurchaseAction.bind(null, slug, r.p.id)} />
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader
        title={t('purchases.title')}
        description={t('purchases.description')}
        actions={
          <>
            <MonthNav base={appPath(`/${slug}/purchases`)} range={range} />
            <PurchaseSheet
              action={recordPurchaseAction.bind(null, slug)}
              scanUrl={appPath(`/${slug}/purchases/scan`)}
              today={todayDubai()}
              aiReady={aiConfigured()}
              products={data.products.map((p) => ({
                id: p.id,
                name: p.name.en,
                unit: p.unit,
                costAed: Number(p.costAed),
              }))}
              suppliers={data.suppliers.map((s) => s.name)}
              locations={[
                { value: 'warehouse', label: t('warehouse.location.warehouse') },
                ...data.branches.map((b) => ({ value: b.id, label: b.name })),
              ]}
              defaultLocation="warehouse"
            />
          </>
        }
      />
      <PageBody>
        <Stack>
          <Grid cols="g3">
            <Stat label={t('purchases.stat.spent', { month: label })} value={fmt.aed(Math.round(total))} />
            <Stat
              label={t('purchases.stat.vat')}
              value={fmt.aed(vat)}
              change={{ text: t('purchases.stat.vatSub'), dir: 'flat' }}
            />
            <Stat label={t('purchases.stat.count')} value={fmt.number(live.length)} />
          </Grid>
          <Grid cols="col-2">
            <Card flush>
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<ShoppingBag className="size-5" strokeWidth={1.5} />}
                  title={t('purchases.empty.title', { month: label })}
                  description={t('purchases.empty.body')}
                />
              ) : (
                <DataTable columns={columns} rows={data.rows} rowKey={(r) => r.p.id} />
              )}
            </Card>
            <Card title={t('purchases.byCategory')} sub={label}>
              {byCategory.length === 0 ? (
                <p className="crm-muted text-sm">{t('purchases.noneYet')}</p>
              ) : (
                <div className="space-y-3">
                  {byCategory.map(([cat, amount]) => (
                    <Meter
                      key={cat}
                      value={amount}
                      max={byCategory[0]?.[1] ?? 1}
                      label={enumLabel(t, 'purchaseCategory', cat)}
                      valueText={fmt.aed(amount)}
                      showLabel
                    />
                  ))}
                </div>
              )}
              <p className="crm-muted mt-4 border-t pt-3 text-[13px]">{t('purchases.ledgerNote')}</p>
            </Card>
          </Grid>
        </Stack>
      </PageBody>
    </>
  )
}
