import { addDays } from '@spa/core'
import { enumLabel } from '@spa/core/i18n'
import { clients, payments, saleLines, sales, withTenant } from '@spa/db'
import { daySummary } from '@spa/services'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { Banknote, Coins, Lock, Plus, Receipt, ReceiptText, Store, Wallet } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Grid, Hairline, Pill, Seg, Stack, Stat } from '@/components/crm'
import { DayNav } from '@/components/pos/day-nav'
import { SaleStatusPill } from '@/components/pos/status'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { DATE, dayDate, pickBranch } from './data'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('sales.title') }
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function SalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'pos.use')) notFound()
  const { t, fmt } = await getI18n()
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
      methods: [...new Set(payRows.filter((p) => p.saleId === r.id).map((p) => p.method))],
    }))
    return { ...picked, date, summary, list }
  })

  if (!data) {
    return (
      <>
        <PageHeader title={t('sales.title')} />
        <Card>
          <EmptyState
            icon={<Store className="size-5" />}
            title={t('sales.noBranch.title')}
            description={t('sales.noBranch.body')}
          />
        </Card>
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
  const method = (m: string) => enumLabel(t, 'paymentMethodKind', m)
  const newSale = (
    <Button asChild>
      <Link href={appPath(`/${slug}/sales/new${branchQ}`)}>
        <Plus /> {t('sales.newSale')}
      </Link>
    </Button>
  )

  return (
    <>
      <PageHeader
        title={t('sales.title')}
        eyebrow={data.branches.length > 1 ? branch.name : undefined}
        description={t('sales.description')}
        actions={
          <>
            {can(ctx, 'pos.close') && (
              <Button variant="secondary" asChild>
                <Link href={appPath(`/${slug}/sales/close${branchQ}`)}>
                  <Lock /> {t('sales.dailyClose')}
                </Link>
              </Button>
            )}
            {newSale}
          </>
        }
      />
      <Stack>
        <div className="flex flex-wrap items-center gap-3">
          <DayNav
            label={isToday ? t('sales.today') : fmt.weekdayDate(dayDate(date))}
            prevHref={q(addDays(date, -1))}
            nextHref={isToday ? null : q(addDays(date, 1))}
            prevLabel={t('sales.prevDay')}
            nextLabel={t('sales.nextDay')}
          />
          {summary.close ? (
            <Pill tone="acc">
              <Lock className="size-3" aria-hidden /> {t('sales.dayClosed')}
            </Pill>
          ) : (
            <span className="crm-muted text-[length:var(--crm-fs-sub)]">
              {t('sales.businessDay', { date: fmt.date(dayDate(date)) })}
            </span>
          )}
          {data.branches.length > 1 && (
            <Seg
              className="ms-auto"
              label={t('sales.branches')}
              value={branch.id}
              items={data.branches.map((b) => ({
                value: b.id,
                label: b.name,
                href: appPath(`/${slug}/sales?branch=${b.id}`),
              }))}
            />
          )}
        </div>

        <Grid cols="g4">
          <Stat
            icon={<Wallet />}
            label={t('sales.stat.revenue')}
            value={fmt.aed(summary.revenueAed)}
            change={{ text: t('sales.stat.vatIncluded') }}
          />
          <Stat
            icon={<ReceiptText />}
            label={t('sales.stat.sales')}
            value={fmt.number(summary.salesCount)}
            change={
              summary.voidCount
                ? { text: t('sales.stat.voided', { count: summary.voidCount }), dir: 'down' }
                : undefined
            }
          />
          <Stat
            icon={<Banknote />}
            label={t('sales.stat.averageTicket')}
            value={fmt.aed(summary.averageTicketAed)}
          />
          <Stat
            icon={<Coins />}
            label={t('sales.stat.tips')}
            value={fmt.aed(summary.tipsAed)}
            change={{ text: t('sales.stat.forTherapists') }}
          />
        </Grid>

        <Grid cols="col-2">
          <Card
            title={isToday ? t('sales.list.todayTitle') : t('sales.list.title')}
            sub={t('sales.list.recorded', { count: list.length })}
          >
            {list.length === 0 ? (
              <EmptyState
                icon={<Receipt className="size-5" />}
                title={t('sales.list.emptyTitle')}
                description={t('sales.list.emptyBody')}
                action={isToday ? newSale : undefined}
              />
            ) : (
              <div className="crm-tbl-wrap">
                <table className="crm-tbl" data-stack="true">
                  <thead>
                    <tr>
                      <th>{t('sales.list.sale')}</th>
                      <th>{t('sales.list.paidBy')}</th>
                      <th className="crm-num-c">{t('sales.list.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td data-label={t('sales.list.sale')}>
                          <Link
                            href={appPath(`/${slug}/sales/${r.id}`)}
                            className="group flex min-w-0 items-center gap-3"
                          >
                            <span className="crm-pill shrink-0 tabular-nums">#{r.number}</span>
                            <span className="min-w-0 max-w-64">
                              <b className="block truncate font-semibold group-hover:text-[var(--crm-accent)]">
                                {r.client ?? t('sales.walkIn')}
                              </b>
                              <span className="crm-muted block truncate text-[length:var(--crm-fs-sub)]">
                                <span className="tabular-nums">{fmt.time(r.createdAt)}</span> ·{' '}
                                {r.items.join(', ')}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td data-label={t('sales.list.paidBy')} className="crm-muted whitespace-nowrap">
                          {r.methods.map(method).join(' + ') || '—'}
                        </td>
                        <td data-label={t('sales.list.total')} className="crm-num-c whitespace-nowrap">
                          <span className="inline-flex items-center justify-end gap-2">
                            {r.status !== 'paid' && <SaleStatusPill t={t} status={r.status} />}
                            <span
                              className={r.status === 'void' ? 'crm-muted line-through' : 'font-semibold'}
                            >
                              {fmt.aed(r.total)}
                            </span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={t('sales.byMethod.title')} sub={t('sales.byMethod.sub')} className="h-fit">
            <dl className="space-y-2.5 text-[length:var(--crm-fs-td)]">
              {methodRows.length === 0 && <p className="crm-muted">{t('sales.byMethod.empty')}</p>}
              {methodRows.map(([m, v]) => (
                <div key={m} className="flex items-center justify-between gap-4">
                  <dt className="crm-muted">{method(m)}</dt>
                  <dd className="font-semibold tabular-nums">{fmt.aed(v)}</dd>
                </div>
              ))}
              {summary.refundsAed > 0 && (
                <div className="flex items-center justify-between gap-4 text-danger">
                  <dt>{t('sales.byMethod.refunds')}</dt>
                  <dd className="font-semibold tabular-nums">−{fmt.aed(summary.refundsAed)}</dd>
                </div>
              )}
              {summary.tipsByStaff.length > 0 && (
                <div className="space-y-2.5">
                  <Hairline />
                  <p className="crm-ey">{t('sales.byMethod.tips')}</p>
                  {summary.tipsByStaff.map((tip) => (
                    <div key={tip.staffId} className="flex items-center justify-between gap-4">
                      <dt className="crm-muted">{tip.name}</dt>
                      <dd className="tabular-nums">{fmt.aed(tip.amountAed)}</dd>
                    </div>
                  ))}
                </div>
              )}
            </dl>
          </Card>
        </Grid>
      </Stack>
    </>
  )
}
