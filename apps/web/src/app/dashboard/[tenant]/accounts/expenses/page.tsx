import { aiConfigured } from '@spa/ai'
import { enumLabel } from '@spa/core/i18n'
import { expenses, withTenant } from '@spa/db'
import { EXPENSE_CODES } from '@spa/services'
import { and, desc, gte, lte } from 'drizzle-orm'
import { ReceiptText } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Grid, Meter, Pill } from '@/components/crm'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { type Column, DataTable } from '@/components/ui/table'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { todayDubai } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { addExpenseAction, voidExpenseAction } from '../actions'
import { accountName } from '../labels'
import { MonthNav, monthLabel, monthRange } from '../month'
import { AccountsTabs } from '../tabs'
import { VoidButton } from '../void-button'
import { ExpenseSheet } from './expense-sheet'
import { ReceiptThumb } from './receipt-thumb'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('accounts.expenses.title') }
}

const CATEGORY = Object.fromEntries(EXPENSE_CODES.map((a) => [a.code, a.name]))
type Row = typeof expenses.$inferSelect

export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'accounting.view')) notFound()
  const { t, fmt } = await getI18n()
  const range = monthRange((await searchParams).month)
  const label = monthLabel(fmt, range.month)
  const category = (code: string) => (CATEGORY[code] ? accountName(t, code, CATEGORY[code]) : code)
  const day = (d: string) => fmt.date(`${d}T12:00:00Z`)
  const slug = ctx.tenant.slug
  const manage = can(ctx, 'accounting.manage')
  const rows = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select()
      .from(expenses)
      .where(and(gte(expenses.expenseDate, range.from), lte(expenses.expenseDate, range.to)))
      .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt)),
  )
  const total = rows.reduce((s, r) => s + Number(r.amountAed), 0)
  const vat = rows.reduce((s, r) => s + Number(r.vatAed), 0)
  const byCategory = Object.entries(
    rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.accountCode] = (acc[r.accountCode] ?? 0) + Number(r.amountAed)
      return acc
    }, {}),
  ).sort((a, b) => b[1] - a[1])

  const columns: Column<Row>[] = [
    {
      key: 'what',
      header: t('accounts.expenses.expense'),
      primary: true,
      cell: (r) => (
        <span className="flex items-center gap-3">
          {r.receiptUrl && <ReceiptThumb url={r.receiptUrl} label={t('accounts.expenses.viewReceipt')} />}
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">{r.vendor || category(r.accountCode)}</span>
            <span className="crm-muted text-xs">{r.description || category(r.accountCode)}</span>
          </span>
        </span>
      ),
    },
    { key: 'date', header: t('accounts.expenses.date'), cell: (r) => day(r.expenseDate) },
    {
      key: 'category',
      header: t('accounts.expenses.category'),
      hideOnMobile: true,
      cell: (r) => category(r.accountCode),
    },
    {
      key: 'paid',
      header: t('accounts.expenses.paid'),
      cell: (r) => <Pill>{enumLabel(t, 'expensePaidVia', r.paidVia)}</Pill>,
    },
    {
      key: 'vat',
      header: t('accounts.expenses.vat'),
      className: 'text-right tabular-nums',
      cell: (r) => (Number(r.vatAed) ? fmt.aed(r.vatAed) : '—'),
    },
    {
      key: 'amount',
      header: t('accounts.expenses.amount'),
      className: 'text-right tabular-nums font-medium',
      cell: (r) => fmt.aed(r.amountAed),
    },
    ...(manage
      ? [
          {
            key: 'void',
            header: '',
            className: 'text-right',
            cell: (r: Row) => <VoidButton action={voidExpenseAction.bind(null, slug, r.id)} />,
          },
        ]
      : []),
  ]

  return (
    <>
      <PageHeader
        title={t('accounts.expenses.title')}
        description={t('accounts.expenses.description')}
        actions={
          <>
            <MonthNav base={appPath(`/${slug}/accounts/expenses`)} range={range} />
            {manage && (
              <ExpenseSheet
                action={addExpenseAction.bind(null, slug)}
                scanUrl={appPath(`/${slug}/accounts/expenses/scan`)}
                categories={EXPENSE_CODES.map((a) => ({
                  code: a.code,
                  name: accountName(t, a.code, a.name),
                }))}
                today={todayDubai()}
                aiReady={aiConfigured()}
              />
            )}
          </>
        }
      />
      <AccountsTabs base={appPath(`/${slug}/accounts`)} month={range.month} active="expenses" />
      <PageBody>
        <Grid cols="col-2">
          <Card flush>
            {rows.length === 0 ? (
              <EmptyState
                icon={<ReceiptText className="size-5" strokeWidth={1.5} />}
                title={t('accounts.expenses.emptyTitle', { month: label })}
                description={t('accounts.expenses.emptyBody')}
              />
            ) : (
              <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
            )}
          </Card>
          <Card title={label} sub={t('accounts.expenses.count', { count: rows.length })}>
            <div className="space-y-3">
              {byCategory.map(([code, amount]) => (
                <Meter
                  key={code}
                  value={amount}
                  max={byCategory[0]?.[1] ?? 1}
                  label={category(code)}
                  valueText={fmt.aed(amount)}
                  showLabel
                />
              ))}
            </div>
            <div className="mt-4 flex justify-between border-t pt-3 text-sm font-semibold">
              <span>{t('accounts.expenses.total')}</span>
              <span className="crm-num">{fmt.aed(total)}</span>
            </div>
            <div className="crm-muted flex justify-between text-[13px]">
              <span>{t('accounts.expenses.recoverable')}</span>
              <span className="crm-num">{fmt.aed(vat)}</span>
            </div>
          </Card>
        </Grid>
      </PageBody>
    </>
  )
}
