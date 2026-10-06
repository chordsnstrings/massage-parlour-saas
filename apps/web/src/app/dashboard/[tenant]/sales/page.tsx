import { addDays } from '@spa/core'
import { clients, payments, saleLines, sales, withTenant } from '@spa/db'
import { daySummary, METHOD_LABEL } from '@spa/services'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { ChevronLeft, ChevronRight, Lock, Plus, Receipt, Store } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SaleStatusBadge } from '@/components/pos/status'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { formatAed } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { DATE, dateLabel, pickBranch } from './data'

export const metadata: Metadata = { title: 'Sales' }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Dubai',
})

export default async function SalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'pos.use')) notFound()
  const slug = ctx.tenant.slug
  const sp = await searchParams
  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const picked = await pickBranch(tx, ctx, one(sp.branch))
    if (!picked) return null
    const wanted = one(sp.date)
    const date = wanted && DATE.test(wanted) && wanted <= picked.today ? wanted : picked.today
    const summary = await daySummary(tx, picked.branch.id, date)
    const rows = await tx
      .select({
        id: sales.id,
        number: sales.number,
        createdAt: sales.createdAt,
        total: sales.totalAed,
        tips: sales.tipsAed,
        status: sales.status,
        client: clients.name,
      })
      .from(sales)
      .leftJoin(clients, eq(clients.id, sales.clientId))
      .where(and(eq(sales.branchId, picked.branch.id), eq(sales.businessDate, date)))
      .orderBy(desc(sales.number))
    const saleIds = rows.map((r) => r.id)
    const [lineRows, payRows] = saleIds.length
      ? await Promise.all([
          tx
            .select({ saleId: saleLines.saleId, description: saleLines.description })
            .from(saleLines)
            .where(inArray(saleLines.saleId, saleIds)),
          tx
            .select({ saleId: payments.saleId, method: payments.method })
            .from(payments)
            .where(inArray(payments.saleId, saleIds)),
        ])
      : [[], []]
    const list = rows.map((r) => ({
      ...r,
      items: lineRows.filter((l) => l.saleId === r.id).map((l) => l.description),
      methods: [...new Set(payRows.filter((p) => p.saleId === r.id).map((p) => METHOD_LABEL[p.method]))],
    }))
    return { ...picked, date, summary, list }
  })

  if (!data) {
    return (
      <>
        <PageHeader title="Sales" />
        <PageBody>
          <Card>
            <EmptyState
              icon={<Store className="size-5" />}
              title="No branch to show"
              description="You haven’t been given access to a branch yet. Ask the owner to add you to one."
            />
          </Card>
        </PageBody>
      </>
    )
  }

  const { branch, date, today, summary, list } = data
  const q = (d: string) => {
    const p = new URLSearchParams()
    if (data.branches.length > 1) p.set('branch', branch.id)
    if (d !== today) p.set('date', d)
    const s = p.toString()
    return appPath(`/${slug}/sales${s ? `?${s}` : ''}`)
  }
  const isToday = date === today
  const branchQ = data.branches.length > 1 ? `?branch=${branch.id}` : ''
  const methodRows = Object.entries(summary.paymentsByMethod).sort((a, b) => b[1] - a[1])

  return (
    <>
      <PageHeader
        title="Sales"
        eyebrow={data.branches.length > 1 ? branch.name : undefined}
        description="Record payments taken at the till — cash, your own card terminal or bank transfer."
        actions={
          <>
            {can(ctx, 'pos.close') && (
              <Button variant="secondary" size="lg" asChild>
                <Link href={appPath(`/${slug}/sales/close${branchQ}`)}>
                  <Lock /> Daily close
                </Link>
              </Button>
            )}
            <Button size="lg" asChild>
              <Link href={appPath(`/${slug}/sales/new${branchQ}`)}>
                <Plus /> New sale
              </Link>
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-xl border bg-surface p-1">
            <Link
              href={q(addDays(date, -1))}
              aria-label="Previous day"
              className="grid size-10 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg"
            >
              <ChevronLeft className="size-4" />
            </Link>
            <span className="min-w-40 px-2 text-center text-sm font-medium tabular">
              {isToday ? 'Today' : dateLabel(date)}
            </span>
            {isToday ? (
              <span className="size-10" />
            ) : (
              <Link
                href={q(addDays(date, 1))}
                aria-label="Next day"
                className="grid size-10 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg"
              >
                <ChevronRight className="size-4" />
              </Link>
            )}
          </div>
          {summary.close ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-medium text-accent">
              <Lock className="size-3.5" /> Day closed
            </span>
          ) : (
            <span className="text-[13px] text-muted">Business day {dateLabel(date)}</span>
          )}
          {data.branches.length > 1 && (
            <div className="ms-auto flex flex-wrap gap-1.5">
              {data.branches.map((b) => (
                <Link
                  key={b.id}
                  href={appPath(`/${slug}/sales?branch=${b.id}`)}
                  className={
                    b.id === branch.id
                      ? 'rounded-full bg-fg px-3 py-1.5 text-[13px] font-medium text-bg'
                      : 'rounded-full border px-3 py-1.5 text-[13px] text-muted hover:text-fg'
                  }
                >
                  {b.name}
                </Link>
              ))}
            </div>
          )}
        </div>

        <Stagger className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StaggerItem>
            <StatCard label="Revenue" value={summary.revenueAed} format="aed" hint="VAT included" />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Sales"
              value={summary.salesCount}
              format="int"
              hint={summary.voidCount ? `${summary.voidCount} voided` : undefined}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Average ticket" value={summary.averageTicketAed} format="aed" />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Tips" value={summary.tipsAed} format="aed" hint="For therapists" />
          </StaggerItem>
        </Stagger>

        <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
          <Card className="min-w-0 lg:col-span-8">
            <CardHeader title={isToday ? 'Today’s sales' : 'Sales'} description={`${list.length} recorded`} />
            <div className="mt-4 border-t">
              <DataTable
                rows={list}
                rowKey={(r) => r.id}
                empty={
                  <EmptyState
                    icon={<Receipt className="size-5" />}
                    title="No sales yet"
                    description="Check out a booking from the calendar, or start a new sale for a walk-in."
                    action={
                      isToday ? (
                        <Button asChild variant="secondary">
                          <Link href={appPath(`/${slug}/sales/new${branchQ}`)}>
                            <Plus /> New sale
                          </Link>
                        </Button>
                      ) : undefined
                    }
                  />
                }
                columns={[
                  {
                    key: 'sale',
                    header: 'Sale',
                    primary: true,
                    cell: (r) => (
                      <Link
                        href={appPath(`/${slug}/sales/${r.id}`)}
                        className="group flex min-w-0 items-center gap-3"
                      >
                        <span className="grid h-9 min-w-12 shrink-0 place-items-center rounded-lg bg-subtle px-2 text-xs font-semibold tabular text-muted transition-colors group-hover:bg-accent-soft group-hover:text-accent">
                          #{r.number}
                        </span>
                        <span className="min-w-0 max-w-56">
                          <span className="block truncate font-medium group-hover:text-accent">
                            {r.client ?? 'Walk-in'}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            <span className="tabular">{timeFmt.format(r.createdAt)}</span> ·{' '}
                            {r.items.join(', ')}
                          </span>
                        </span>
                      </Link>
                    ),
                  },
                  {
                    key: 'paid',
                    header: 'Paid by',
                    cell: (r) => (
                      <span className="whitespace-nowrap text-muted">{r.methods.join(' + ') || '—'}</span>
                    ),
                    hideOnMobile: true,
                  },
                  {
                    key: 'total',
                    header: 'Total',
                    className: 'text-end whitespace-nowrap',
                    cell: (r) => (
                      <span className="inline-flex items-center justify-end gap-2">
                        {r.status !== 'paid' && <SaleStatusBadge status={r.status} />}
                        <span
                          className={
                            r.status === 'void' ? 'text-muted line-through tabular' : 'font-medium tabular'
                          }
                        >
                          {formatAed(r.total)}
                        </span>
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </Card>

          <Card className="h-fit lg:col-span-4">
            <CardHeader title="By payment method" description="Recorded at the till" />
            <dl className="mt-5 space-y-3 px-5 pb-5 text-sm sm:px-6 sm:pb-6">
              {methodRows.length === 0 && <p className="text-muted">Nothing recorded yet.</p>}
              {methodRows.map(([m, v]) => (
                <div key={m} className="flex items-center justify-between gap-4">
                  <dt className="text-muted">{METHOD_LABEL[m] ?? m}</dt>
                  <dd className="font-medium tabular">{formatAed(v)}</dd>
                </div>
              ))}
              {summary.refundsAed > 0 && (
                <div className="flex items-center justify-between gap-4 text-danger">
                  <dt>Refunds</dt>
                  <dd className="font-medium tabular">−{formatAed(summary.refundsAed)}</dd>
                </div>
              )}
              {summary.tipsByStaff.length > 0 && (
                <div className="space-y-2 border-t pt-4">
                  <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">Tips</p>
                  {summary.tipsByStaff.map((t) => (
                    <div key={t.staffId} className="flex items-center justify-between gap-4">
                      <dt className="text-muted">{t.name}</dt>
                      <dd className="tabular">{formatAed(t.amountAed)}</dd>
                    </div>
                  ))}
                </div>
              )}
            </dl>
          </Card>
        </div>
      </PageBody>
    </>
  )
}
