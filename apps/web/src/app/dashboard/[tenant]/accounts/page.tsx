import { periodLocks, withTenant } from '@spa/db'
import { accountTotals, profitAndLoss, vatSummary } from '@spa/services'
import { Download, Lock } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { appPath } from '@/lib/paths'
import { cn, formatAed, formatDate, todayDubai } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { lockPeriodAction } from './actions'
import { MonthNav, monthRange } from './month'
import { AccountsTabs } from './tabs'

export const metadata: Metadata = { title: 'Accounts' }

function Line({
  label,
  value,
  strong,
  muted,
}: {
  label: string
  value: number
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-2 text-sm', strong && 'font-semibold')}>
      <span className={cn(muted && 'text-muted')}>{label}</span>
      <span className="tabular-nums">{formatAed(value)}</span>
    </div>
  )
}

export default async function AccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'accounting.view')) notFound()
  const range = monthRange((await searchParams).month)
  const t = ctx.tenant.id
  const { pl, vat, balances, lock } = await withTenant(t, async (tx) => ({
    pl: await profitAndLoss(tx, t, range.from, range.to),
    vat: await vatSummary(tx, t, range.quarter.from, range.quarter.to),
    balances: await accountTotals(tx, t, null, range.to),
    lock: (await tx.select().from(periodLocks).limit(1))[0] ?? null,
  }))
  const bal = (code: string) => balances.find((b) => b.code === code)?.balance ?? 0
  const base = appPath(`/${ctx.tenant.slug}/accounts`)
  const manage = can(ctx, 'accounting.manage')

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Profit and loss, VAT and balances — built automatically from sales, refunds and expenses."
        actions={<MonthNav base={base} range={range} />}
      />
      <AccountsTabs base={base} month={range.month} active="overview" />
      <PageBody>
        <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          <StatCard label="Revenue" value={pl.totalRevenue} format="aed" hint="excl. VAT" />
          <StatCard label="Expenses" value={pl.totalExpenses} format="aed" hint="excl. VAT" />
          <StatCard label="Profit" value={pl.profit} format="aed" hint={range.label} />
          <StatCard label="VAT due" value={vat.netVatDueAed} format="aed" hint={range.quarter.label} />
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-7">
            <CardHeader
              title="Profit & loss"
              description={range.label}
              action={
                <Button variant="ghost" size="sm" asChild>
                  <a href={`${base}/export?month=${range.month}`} download>
                    <Download /> CSV
                  </a>
                </Button>
              }
            />
            <CardBody className="divide-y pt-3">
              <div className="pb-2">
                <p className="pb-1 text-xs font-medium uppercase tracking-[0.06em] text-muted">Revenue</p>
                {pl.revenue.length === 0 && (
                  <p className="py-2 text-sm text-muted">No revenue this month yet.</p>
                )}
                {pl.revenue.map((a) => (
                  <Line key={a.code} label={a.name} value={a.balance} />
                ))}
                <Line label="Total revenue" value={pl.totalRevenue} strong />
              </div>
              <div className="py-2">
                <p className="pt-2 pb-1 text-xs font-medium uppercase tracking-[0.06em] text-muted">
                  Expenses
                </p>
                {pl.expenses.length === 0 && (
                  <p className="py-2 text-sm text-muted">No expenses this month yet.</p>
                )}
                {pl.expenses.map((a) => (
                  <Line key={a.code} label={a.name} value={a.balance} />
                ))}
                <Line label="Total expenses" value={pl.totalExpenses} strong />
              </div>
              <div className="pt-2">
                <div className="flex items-baseline justify-between py-2">
                  <span className="text-[15px] font-semibold">Net profit</span>
                  <span
                    className={cn(
                      'text-lg font-semibold tabular-nums',
                      pl.profit < 0 ? 'text-danger' : 'text-success',
                    )}
                  >
                    {formatAed(pl.profit)}
                  </span>
                </div>
              </div>
            </CardBody>
          </Card>

          <div className="space-y-6 lg:col-span-5">
            <Card>
              <CardHeader title="Money" description={`Balances at ${formatDate(range.to)}`} />
              <CardBody className="pt-3">
                <Line label="Cash on hand" value={bal('1000')} />
                <Line label="Card terminal (not yet settled)" value={bal('1010')} />
                <Line label="Bank" value={bal('1020')} />
                <div className="mt-2 border-t pt-2">
                  <Line label="Gift cards outstanding" value={bal('2100')} muted />
                  <Line label="Prepaid packages & memberships" value={bal('2110')} muted />
                  <Line label="Tips owed to staff" value={bal('2200')} muted />
                  <Line label="Commissions owed" value={bal('2300')} muted />
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title={`VAT · ${range.quarter.label}`}
                description="Figures for your FTA VAT return (Form 201)."
              />
              <CardBody className="pt-3">
                <Line label="Taxable sales (box 1)" value={vat.taxableSalesAed} />
                <Line label="Output VAT" value={vat.outputVatAed} />
                <Line label="Recoverable input VAT" value={vat.inputVatAed} />
                <div className="mt-2 border-t pt-1">
                  <Line label="Net VAT due" value={vat.netVatDueAed} strong />
                </div>
              </CardBody>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader
            title="Close the books"
            description="Closing a period stops anyone from adding or changing entries on or before that date. Corrections are then posted in the open period."
          />
          <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <p className="flex items-center gap-2 text-sm">
              <Lock className="size-4 text-muted" strokeWidth={1.5} />
              {lock ? (
                <span>
                  Closed through <span className="font-medium">{formatDate(lock.lockedThrough)}</span>
                </span>
              ) : (
                <span className="text-muted">No period closed yet.</span>
              )}
            </p>
            {manage && (
              <ActionForm
                action={lockPeriodAction.bind(null, ctx.tenant.slug)}
                className="flex items-end gap-3"
              >
                <Field label="Close through" name="through">
                  <Input
                    id="through"
                    name="through"
                    type="date"
                    defaultValue={range.to < todayDubai() ? range.to : ''}
                  />
                </Field>
                <SubmitButton variant="secondary">Close period</SubmitButton>
              </ActionForm>
            )}
          </CardBody>
        </Card>
      </PageBody>
    </>
  )
}
