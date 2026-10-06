import { addDays } from '@spa/core'
import { dayCloses, withTenant } from '@spa/db'
import { daySummary, METHOD_LABEL } from '@spa/services'
import { desc, eq } from 'drizzle-orm'
import { ArrowLeft, ChevronLeft, ChevronRight, Lock, Store } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CloseForm } from '@/components/pos/close-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { cn, formatAed, formatDateTime } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { closeDayAction } from '../actions'
import { DATE, dateLabel, pickBranch } from '../data'

export const metadata: Metadata = { title: 'Daily close' }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function ClosePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'pos.close')) notFound()
  const slug = ctx.tenant.slug
  const sp = await searchParams
  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const picked = await pickBranch(tx, ctx, one(sp.branch))
    if (!picked) return null
    const wanted = one(sp.date)
    const date = wanted && DATE.test(wanted) && wanted <= picked.today ? wanted : picked.today
    const summary = await daySummary(tx, picked.branch.id, date)
    const past = await tx
      .select()
      .from(dayCloses)
      .where(eq(dayCloses.branchId, picked.branch.id))
      .orderBy(desc(dayCloses.businessDate))
      .limit(30)
    return { ...picked, date, summary, past }
  })

  const back = (
    <Button variant="ghost" asChild>
      <Link href={appPath(`/${slug}/sales`)}>
        <ArrowLeft /> Sales
      </Link>
    </Button>
  )
  if (!data) {
    return (
      <>
        <PageHeader title="Daily close" actions={back} />
        <PageBody>
          <Card>
            <EmptyState icon={<Store className="size-5" />} title="No branch to close" />
          </Card>
        </PageBody>
      </>
    )
  }
  const { branch, date, today, summary: s, past } = data
  const multi = data.branches.length > 1
  const href = (d: string) => {
    const p = new URLSearchParams()
    if (multi) p.set('branch', branch.id)
    if (d !== today) p.set('date', d)
    const q = p.toString()
    return appPath(`/${slug}/sales/close${q ? `?${q}` : ''}`)
  }
  const cash = (o: Record<string, number>) => o.cash ?? 0
  const cashMovement = cash(s.paymentsByMethod) + cash(s.tipsByMethod) - cash(s.refundsByMethod)
  const methods = Object.keys({ ...s.paymentsByMethod, ...s.refundsByMethod })
  const prevFloat = past.find((p) => p.businessDate < date)?.openingFloatAed

  return (
    <>
      <PageHeader
        eyebrow={multi ? branch.name : 'Z-report'}
        title="Daily close"
        description="Count the drawer, compare it with what the till expects, and lock in the day."
        actions={back}
      />
      <PageBody>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-xl border bg-surface p-1">
            <Link
              href={href(addDays(date, -1))}
              aria-label="Previous day"
              className="grid size-10 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg"
            >
              <ChevronLeft className="size-4" />
            </Link>
            <span className="min-w-40 px-2 text-center text-sm font-medium tabular">
              {date === today ? 'Today' : dateLabel(date)}
            </span>
            {date === today ? (
              <span className="size-10" />
            ) : (
              <Link
                href={href(addDays(date, 1))}
                aria-label="Next day"
                className="grid size-10 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg"
              >
                <ChevronRight className="size-4" />
              </Link>
            )}
          </div>
          <span className="text-[13px] text-muted">
            Business day {dateLabel(date)} · ends {branch.businessDayCutoff.slice(0, 5)}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
          <Card className="h-fit lg:col-span-5">
            <CardHeader
              title="Takings"
              description={`${s.salesCount} ${s.salesCount === 1 ? 'sale' : 'sales'}${s.voidCount ? ` · ${s.voidCount} voided` : ''}`}
            />
            <dl className="mt-5 space-y-2.5 px-5 pb-5 text-sm sm:px-6 sm:pb-6">
              <Line label="Revenue (VAT incl.)" value={s.revenueAed} strong />
              <Line label="VAT included" value={s.vatAed} muted />
              {s.discountAed > 0 && <Line label="Discounts given" value={s.discountAed} muted />}
              <div className="space-y-2.5 border-t pt-3">
                {methods.length === 0 && <p className="text-muted">No payments recorded.</p>}
                {methods.map((m) => (
                  <Line key={m} label={METHOD_LABEL[m] ?? m} value={s.paymentsByMethod[m] ?? 0} />
                ))}
              </div>
              {s.refundsAed > 0 && (
                <div className="space-y-2.5 border-t pt-3">
                  {Object.entries(s.refundsByMethod).map(([m, v]) => (
                    <Line key={m} label={`Refunds · ${METHOD_LABEL[m] ?? m}`} value={-v} danger />
                  ))}
                </div>
              )}
              <div className="space-y-2.5 border-t pt-3">
                <Line label="Tips" value={s.tipsAed} />
                {s.tipsByStaff.map((t) => (
                  <Line key={t.staffId} label={`· ${t.name}`} value={t.amountAed} muted />
                ))}
              </div>
              <div className="border-t pt-3">
                <Line label="Cash in (sales + tips − refunds)" value={cashMovement} strong />
              </div>
            </dl>
          </Card>

          <Card className="h-fit lg:col-span-7">
            {s.close ? (
              <>
                <CardHeader
                  title="Day closed"
                  description={`Closed ${formatDateTime(s.close.closedAt)}`}
                  action={
                    <Badge tone="accent">
                      <Lock className="size-3" /> Locked
                    </Badge>
                  }
                />
                <dl className="mt-5 space-y-2.5 px-5 pb-5 text-sm sm:px-6 sm:pb-6">
                  <Line label="Opening float" value={Number(s.close.openingFloatAed)} />
                  <Line label="Expected cash" value={Number(s.close.expectedCashAed)} />
                  <Line label="Counted cash" value={Number(s.close.countedCashAed)} strong />
                  <div className="flex justify-between gap-4 border-t pt-3">
                    <dt className="font-medium">Variance</dt>
                    <dd>
                      <VarianceBadge value={Number(s.close.varianceAed)} />
                    </dd>
                  </div>
                  {s.close.notes && (
                    <p className="rounded-lg bg-subtle px-3 py-2.5 text-muted">{s.close.notes}</p>
                  )}
                </dl>
              </>
            ) : (
              <>
                <CardHeader
                  title="Count the drawer"
                  description="Enter the float you started with and the cash you count now."
                />
                <div className="px-5 pt-5 pb-5 sm:px-6 sm:pb-6">
                  <CloseForm
                    action={closeDayAction.bind(null, slug, branch.id, date)}
                    cashMovementAed={cashMovement}
                    defaultFloat={prevFloat ? Number(prevFloat) : 0}
                  />
                </div>
              </>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader title="Past closes" description={multi ? branch.name : 'Most recent first'} />
          <div className="mt-4 border-t">
            <DataTable
              rows={past}
              rowKey={(r) => r.id}
              empty={<EmptyState icon={<Lock className="size-5" />} title="No days closed yet" />}
              columns={[
                {
                  key: 'date',
                  header: 'Business day',
                  primary: true,
                  cell: (r) => (
                    <Link href={href(r.businessDate)} className="font-medium hover:text-accent">
                      {dateLabel(r.businessDate)}
                    </Link>
                  ),
                },
                {
                  key: 'revenue',
                  header: 'Revenue',
                  cell: (r) => <span className="tabular">{formatAed(r.totals.revenue ?? 0)}</span>,
                  hideOnMobile: true,
                },
                {
                  key: 'expected',
                  header: 'Expected',
                  cell: (r) => <span className="tabular text-muted">{formatAed(r.expectedCashAed)}</span>,
                },
                {
                  key: 'counted',
                  header: 'Counted',
                  cell: (r) => <span className="tabular">{formatAed(r.countedCashAed)}</span>,
                },
                {
                  key: 'variance',
                  header: 'Variance',
                  className: 'text-end',
                  cell: (r) => <VarianceBadge value={Number(r.varianceAed)} />,
                },
              ]}
            />
          </div>
        </Card>
      </PageBody>
    </>
  )
}

function Line({
  label,
  value,
  strong,
  muted,
  danger,
}: {
  label: string
  value: number
  strong?: boolean
  muted?: boolean
  danger?: boolean
}) {
  return (
    <div className={cn('flex justify-between gap-4', muted && 'text-muted', danger && 'text-danger')}>
      <dt className={cn('min-w-0', strong && 'font-medium')}>{label}</dt>
      <dd className={cn('shrink-0 tabular', strong && 'font-semibold')}>
        {value < 0 ? `−${formatAed(-value)}` : formatAed(value)}
      </dd>
    </div>
  )
}

function VarianceBadge({ value }: { value: number }) {
  if (value === 0) return <Badge tone="success">Balanced</Badge>
  const text = `${value > 0 ? '+' : '−'}${formatAed(Math.abs(value))}`
  return <Badge tone={Math.abs(value) <= 10 ? 'warning' : 'danger'}>{text}</Badge>
}
