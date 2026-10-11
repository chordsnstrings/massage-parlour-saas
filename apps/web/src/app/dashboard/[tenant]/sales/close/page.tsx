import { addDays } from '@spa/core'
import { enumLabel, type Translator } from '@spa/core/i18n'
import { dayCloses, withTenant } from '@spa/db'
import { daySummary } from '@spa/services'
import { desc, eq } from 'drizzle-orm'
import { ArrowLeft, Lock, Store } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Grid, Hairline, Note, Pill, Stack } from '@/components/crm'
import { CloseForm } from '@/components/pos/close-form'
import { DayNav } from '@/components/pos/day-nav'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { closeDayAction } from '../actions'
import { DATE, dayDate, pickBranch } from '../data'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('sales.close.title') }
}

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
  const { t, fmt } = await getI18n()
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
        <ArrowLeft /> {t('sales.back')}
      </Link>
    </Button>
  )
  if (!data) {
    return (
      <>
        <PageHeader title={t('sales.close.title')} actions={back} />
        <Card>
          <EmptyState icon={<Store className="size-5" />} title={t('sales.close.noBranch')} />
        </Card>
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
  const method = (m: string) => enumLabel(t, 'paymentMethodKind', m)
  const aed = (v: number) => (v < 0 ? `−${fmt.aed(-v)}` : fmt.aed(v))
  const salesText = t('sales.close.salesCount', { count: s.salesCount })

  return (
    <>
      <PageHeader
        eyebrow={multi ? branch.name : t('sales.close.eyebrow')}
        title={t('sales.close.title')}
        description={t('sales.close.description')}
        actions={back}
      />
      <Stack>
        <div className="flex flex-wrap items-center gap-3">
          <DayNav
            label={date === today ? t('sales.today') : fmt.weekdayDate(dayDate(date))}
            prevHref={href(addDays(date, -1))}
            nextHref={date === today ? null : href(addDays(date, 1))}
            prevLabel={t('sales.prevDay')}
            nextLabel={t('sales.nextDay')}
          />
          <span className="crm-muted text-[length:var(--crm-fs-sub)]">
            {t('sales.businessDayEnds', {
              date: fmt.date(dayDate(date)),
              time: branch.businessDayCutoff.slice(0, 5),
            })}
          </span>
        </div>

        <Grid cols="col-2b">
          <Card
            className="h-fit"
            title={t('sales.close.takings')}
            sub={
              s.voidCount ? t('sales.close.salesVoided', { sales: salesText, count: s.voidCount }) : salesText
            }
          >
            <dl className="space-y-2.5 text-[length:var(--crm-fs-td)]">
              <Line label={t('sales.close.revenue')} value={aed(s.revenueAed)} strong />
              <Line label={t('sales.close.vatIncluded')} value={aed(s.vatAed)} muted />
              {s.discountAed > 0 && (
                <Line label={t('sales.close.discounts')} value={aed(s.discountAed)} muted />
              )}
              <Hairline />
              {methods.length === 0 && <p className="crm-muted">{t('sales.close.noPayments')}</p>}
              {methods.map((m) => (
                <Line key={m} label={method(m)} value={aed(s.paymentsByMethod[m] ?? 0)} />
              ))}
              {s.refundsAed > 0 && (
                <>
                  <Hairline />
                  {Object.entries(s.refundsByMethod).map(([m, v]) => (
                    <Line
                      key={m}
                      label={t('sales.close.refundsBy', { method: method(m) })}
                      value={aed(-v)}
                      danger
                    />
                  ))}
                </>
              )}
              <Hairline />
              <Line label={t('sales.close.tips')} value={aed(s.tipsAed)} />
              {s.tipsByStaff.map((tip) => (
                <Line key={tip.staffId} label={`· ${tip.name}`} value={aed(tip.amountAed)} muted />
              ))}
              <Hairline />
              <Line label={t('sales.close.cashIn')} value={aed(cashMovement)} strong />
            </dl>
          </Card>

          {s.close ? (
            <Card
              className="h-fit"
              title={t('sales.dayClosed')}
              sub={t('sales.close.closedAt', { time: fmt.dateTime(s.close.closedAt) })}
              actions={
                <Pill tone="acc">
                  <Lock className="size-3" aria-hidden /> {t('sales.close.locked')}
                </Pill>
              }
            >
              <dl className="space-y-2.5 text-[length:var(--crm-fs-td)]">
                <Line label={t('sales.close.openingFloat')} value={aed(Number(s.close.openingFloatAed))} />
                <Line label={t('sales.close.expectedCash')} value={aed(Number(s.close.expectedCashAed))} />
                <Line
                  label={t('sales.close.countedCash')}
                  value={aed(Number(s.close.countedCashAed))}
                  strong
                />
                <Hairline />
                <div className="flex justify-between gap-4">
                  <dt className="font-semibold">{t('sales.close.variance')}</dt>
                  <dd>
                    <VariancePill t={t} aed={fmt.aed} value={Number(s.close.varianceAed)} />
                  </dd>
                </div>
              </dl>
              {s.close.notes && <Note className="mt-3">{s.close.notes}</Note>}
            </Card>
          ) : (
            <Card className="h-fit" title={t('sales.close.countTitle')} sub={t('sales.close.countHint')}>
              <CloseForm
                action={closeDayAction.bind(null, slug, branch.id, date)}
                cashMovementAed={cashMovement}
                defaultFloat={prevFloat ? Number(prevFloat) : 0}
              />
            </Card>
          )}
        </Grid>

        <Card title={t('sales.close.past')} sub={multi ? branch.name : t('sales.close.recentFirst')}>
          {past.length === 0 ? (
            <EmptyState icon={<Lock className="size-5" />} title={t('sales.close.noneYet')} />
          ) : (
            <div className="crm-tbl-wrap">
              <table className="crm-tbl" data-stack="true">
                <thead>
                  <tr>
                    <th>{t('sales.close.businessDay')}</th>
                    <th className="crm-num-c">{t('sales.stat.revenue')}</th>
                    <th className="crm-num-c">{t('sales.close.expected')}</th>
                    <th className="crm-num-c">{t('sales.close.counted')}</th>
                    <th className="crm-num-c">{t('sales.close.variance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {past.map((r) => (
                    <tr key={r.id}>
                      <td data-label={t('sales.close.businessDay')}>
                        <Link
                          href={href(r.businessDate)}
                          className="font-semibold hover:text-[var(--crm-accent)]"
                        >
                          {fmt.weekdayDate(dayDate(r.businessDate))}
                        </Link>
                      </td>
                      <td data-label={t('sales.stat.revenue')} className="crm-num-c">
                        {fmt.aed(r.totals.revenue ?? 0)}
                      </td>
                      <td data-label={t('sales.close.expected')} className="crm-num-c crm-muted">
                        {fmt.aed(r.expectedCashAed)}
                      </td>
                      <td data-label={t('sales.close.counted')} className="crm-num-c">
                        {fmt.aed(r.countedCashAed)}
                      </td>
                      <td data-label={t('sales.close.variance')} className="crm-num-c">
                        <VariancePill t={t} aed={fmt.aed} value={Number(r.varianceAed)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Stack>
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
  value: string
  strong?: boolean
  muted?: boolean
  danger?: boolean
}) {
  return (
    <div className={cn('flex justify-between gap-4', muted && 'crm-muted', danger && 'text-danger')}>
      <dt className={cn('min-w-0', strong && 'font-semibold')}>{label}</dt>
      <dd className={cn('shrink-0 tabular-nums', strong && 'font-semibold')}>{value}</dd>
    </div>
  )
}

function VariancePill({ t, aed, value }: { t: Translator; aed: (v: number) => string; value: number }) {
  if (value === 0) return <Pill tone="ok">{t('sales.close.balanced')}</Pill>
  const text = `${value > 0 ? '+' : '−'}${aed(Math.abs(value))}`
  return <Pill tone={Math.abs(value) <= 10 ? 'warn' : 'bad'}>{text}</Pill>
}
