import { aiConfigured } from '@spa/ai'
import { expenses, withTenant } from '@spa/db'
import { EXPENSE_CODES } from '@spa/services'
import { and, desc, gte, lte } from 'drizzle-orm'
import { ReceiptText } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { type Column, DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { formatAed, formatDate, todayDubai } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { addExpenseAction, voidExpenseAction } from '../actions'
import { MonthNav, monthRange } from '../month'
import { AccountsTabs } from '../tabs'
import { VoidButton } from '../void-button'
import { ExpenseSheet } from './expense-sheet'
import { ReceiptThumb } from './receipt-thumb'

export const metadata: Metadata = { title: 'Expenses' }

const CATEGORY = Object.fromEntries(EXPENSE_CODES.map((a) => [a.code, a.name]))
const PAID_VIA = { cash: 'Cash', bank: 'Bank transfer', card: 'Card', owner: 'Paid by owner' } as const
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
  const range = monthRange((await searchParams).month)
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
      header: 'Expense',
      primary: true,
      cell: (r) => (
        <span className="flex items-center gap-3">
          {r.receiptUrl && <ReceiptThumb url={r.receiptUrl} />}
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">{r.vendor || CATEGORY[r.accountCode] || r.accountCode}</span>
            <span className="text-xs text-muted">{r.description || CATEGORY[r.accountCode]}</span>
          </span>
        </span>
      ),
    },
    { key: 'date', header: 'Date', cell: (r) => formatDate(r.expenseDate) },
    {
      key: 'category',
      header: 'Category',
      hideOnMobile: true,
      cell: (r) => CATEGORY[r.accountCode] ?? r.accountCode,
    },
    { key: 'paid', header: 'Paid', cell: (r) => <Badge>{PAID_VIA[r.paidVia]}</Badge> },
    {
      key: 'vat',
      header: 'VAT',
      className: 'text-right tabular-nums',
      cell: (r) => (Number(r.vatAed) ? formatAed(r.vatAed) : '—'),
    },
    {
      key: 'amount',
      header: 'Amount',
      className: 'text-right tabular-nums font-medium',
      cell: (r) => formatAed(r.amountAed),
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
        title="Expenses"
        description="Rent, DEWA, visas, supplies — every expense lands in your P&L and VAT return automatically."
        actions={
          <>
            <MonthNav base={appPath(`/${slug}/accounts/expenses`)} range={range} />
            {manage && (
              <ExpenseSheet
                action={addExpenseAction.bind(null, slug)}
                scanUrl={appPath(`/${slug}/accounts/expenses/scan`)}
                categories={EXPENSE_CODES.map((a) => ({ code: a.code, name: a.name }))}
                today={todayDubai()}
                aiReady={aiConfigured()}
              />
            )}
          </>
        }
      />
      <AccountsTabs base={appPath(`/${slug}/accounts`)} month={range.month} active="expenses" />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-8">
            {rows.length === 0 ? (
              <EmptyState
                icon={<ReceiptText className="size-5" strokeWidth={1.5} />}
                title={`No expenses in ${range.label}`}
                description="Record rent, utilities, supplies and visa costs to see your real profit."
              />
            ) : (
              <div className="py-2">
                <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
              </div>
            )}
          </Card>
          <Card className="lg:col-span-4">
            <CardHeader title={range.label} description={`${rows.length} expenses`} />
            <CardBody className="space-y-2 pt-3">
              {byCategory.map(([code, amount]) => (
                <div key={code} className="flex justify-between gap-3 text-sm">
                  <span className="truncate text-muted">{CATEGORY[code] ?? code}</span>
                  <span className="tabular-nums">{formatAed(amount)}</span>
                </div>
              ))}
              <div className="mt-3 flex justify-between border-t pt-3 text-sm font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatAed(total)}</span>
              </div>
              <div className="flex justify-between text-[13px] text-muted">
                <span>of which recoverable VAT</span>
                <span className="tabular-nums">{formatAed(vat)}</span>
              </div>
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </>
  )
}
