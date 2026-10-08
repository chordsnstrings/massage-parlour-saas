import type { Format, Translator } from '@spa/core/i18n'
import { periodLocks, withTenant } from '@spa/db'
import { accountTotals, profitAndLoss, vatSummary } from '@spa/services'
import { Banknote, Download, Lock } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BarChart, Card, type Dir, Grid, Meter, Note, Pill, Stack, Stat } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { cn, todayDubai } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { lockPeriodAction } from './actions'
import { journal } from './journal-data'
import { accountName, sourceLabel } from './labels'
import { MonthNav, monthLabel, monthRange, quarterLabel } from './month'
import { AccountsTabs } from './tabs'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('accounts.title') }
}

// Cash-type accounts: a journal entry touching them is money in or out (method = which one).
const MONEY = { '1000': 'cash', '1010': 'card', '1020': 'bank' } as const

function Line({
  label,
  value,
  fmt,
  strong,
  muted,
}: {
  label: string
  value: number
  fmt: Format
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div
      className={cn('flex items-baseline justify-between gap-4 py-1.5 text-sm', strong && 'font-semibold')}
    >
      <span className={cn(muted && 'crm-muted')}>{label}</span>
      <span className="crm-num">{fmt.aed(value)}</span>
    </div>
  )
}

/** "▲ 12% vs last month"; `goodWhenUp` false for costs (a rise is shown as bad). */
function change(t: Translator, fmt: Format, now: number, before: number, goodWhenUp = true) {
  if (!before) return undefined
  const ratio = (now - before) / Math.abs(before)
  const arrow = ratio > 0 ? '▲' : ratio < 0 ? '▼' : ''
  const dir: Dir = ratio === 0 ? 'flat' : ratio > 0 === goodWhenUp ? 'up' : 'down'
  return { text: `${arrow} ${t('accounts.stat.vsLast', { pct: fmt.percent(Math.abs(ratio)) })}`, dir }
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
  const { t, fmt } = await getI18n()
  const range = monthRange((await searchParams).month)
  const trendMonths = [3, 2, 1].map((n) => monthRange(range.shift(-n)))
  const tid = ctx.tenant.id
  const { pl, trend, vat, balances, lock, entries } = await withTenant(tid, async (tx) => ({
    pl: await profitAndLoss(tx, tid, range.from, range.to),
    trend: [
      await profitAndLoss(tx, tid, trendMonths[0]!.from, trendMonths[0]!.to),
      await profitAndLoss(tx, tid, trendMonths[1]!.from, trendMonths[1]!.to),
      await profitAndLoss(tx, tid, trendMonths[2]!.from, trendMonths[2]!.to),
    ],
    vat: await vatSummary(tx, tid, range.quarter.from, range.quarter.to),
    balances: await accountTotals(tx, tid, null, range.to),
    lock: (await tx.select().from(periodLocks).limit(1))[0] ?? null,
    entries: await journal(tx, range.from, range.to, 40),
  }))
  const prev = trend[2]!
  const bal = (code: string) => balances.find((b) => b.code === code)?.balance ?? 0
  const base = appPath(`/${ctx.tenant.slug}/accounts`)
  const manage = can(ctx, 'accounting.manage')
  const label = monthLabel(fmt, range.month)
  const quarter = quarterLabel(t, range)
  // FTA returns are due on the 28th day after the end of the tax period.
  const vatDue = new Date(`${range.quarter.to}T12:00:00Z`)
  vatDue.setUTCDate(vatDue.getUTCDate() + 28)

  const recent = entries
    .map((e) => {
      const money = e.lines.filter((l) => l.code in MONEY)
      if (money.length === 0) return null
      const amount = money.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)
      const main = money.reduce((a, b) =>
        Math.abs(Number(b.debit) - Number(b.credit)) > Math.abs(Number(a.debit) - Number(a.credit)) ? b : a,
      )
      return { e, amount, method: MONEY[main.code as keyof typeof MONEY] }
    })
    .filter((r) => r !== null && r.amount !== 0)
    .slice(0, 6) as { e: (typeof entries)[number]; amount: number; method: 'cash' | 'card' | 'bank' }[]

  const bars = [...trendMonths, range].map((m, i) => ({
    label: fmt.monthYear(`${m.month}-01T12:00:00Z`).split(' ')[0]!,
    value: Math.max(0, (i < 3 ? trend[i]! : pl).totalRevenue),
    hi: i === 3,
    title: `${monthLabel(fmt, m.month)} · ${fmt.aed((i < 3 ? trend[i]! : pl).totalRevenue)}`,
  }))
  const topExpense = Math.max(0, ...pl.expenses.map((a) => a.balance))
  const margin = pl.totalRevenue > 0 ? pl.profit / pl.totalRevenue : null

  return (
    <>
      <PageHeader
        title={t('accounts.title')}
        description={t('accounts.description')}
        actions={<MonthNav base={base} range={range} />}
      />
      <AccountsTabs base={base} month={range.month} active="overview" />
      <PageBody>
        <Stack>
          <Grid cols="g4">
            <Stat
              label={`${t('accounts.stat.revenue')} · ${label}`}
              value={fmt.aed(pl.totalRevenue)}
              change={
                change(t, fmt, pl.totalRevenue, prev.totalRevenue) ?? { text: t('accounts.stat.exclVat') }
              }
            />
            <Stat
              label={t('accounts.stat.expenses')}
              value={fmt.aed(pl.totalExpenses)}
              change={
                change(t, fmt, pl.totalExpenses, prev.totalExpenses, false) ?? {
                  text: t('accounts.stat.exclVat'),
                }
              }
            />
            <Stat
              label={t('accounts.stat.profit')}
              value={fmt.aed(pl.profit)}
              change={
                margin === null
                  ? undefined
                  : {
                      text: t('accounts.stat.margin', { pct: fmt.percent(margin) }),
                      dir: margin >= 0 ? 'up' : 'down',
                    }
              }
            />
            <Stat
              label={t('accounts.stat.vatDue')}
              value={fmt.aed(vat.netVatDueAed)}
              change={{ text: quarter }}
            />
          </Grid>

          <Grid cols="col-2">
            <Card
              title={t('accounts.pl.title')}
              sub={label}
              actions={
                <Button variant="ghost" size="sm" asChild>
                  <a href={`${base}/export?month=${range.month}`} download>
                    <Download /> {t('accounts.pl.csv')}
                  </a>
                </Button>
              }
            >
              <div className="divide-y">
                <div className="pb-2">
                  <p className="crm-ey pb-1">{t('accounts.pl.revenue')}</p>
                  {pl.revenue.length === 0 && (
                    <p className="crm-muted py-1.5 text-sm">{t('accounts.pl.noRevenue')}</p>
                  )}
                  {pl.revenue.map((a) => (
                    <Line key={a.code} label={accountName(t, a.code, a.name)} value={a.balance} fmt={fmt} />
                  ))}
                  <Line label={t('accounts.pl.totalRevenue')} value={pl.totalRevenue} fmt={fmt} strong />
                </div>
                <div className="py-2">
                  <p className="crm-ey pt-2 pb-1">{t('accounts.pl.expenses')}</p>
                  {pl.expenses.length === 0 && (
                    <p className="crm-muted py-1.5 text-sm">{t('accounts.pl.noExpenses')}</p>
                  )}
                  {pl.expenses.map((a) => (
                    <Line key={a.code} label={accountName(t, a.code, a.name)} value={a.balance} fmt={fmt} />
                  ))}
                  <Line label={t('accounts.pl.totalExpenses')} value={pl.totalExpenses} fmt={fmt} strong />
                </div>
                <div className="flex items-baseline justify-between pt-3">
                  <span className="font-semibold">{t('accounts.pl.net')}</span>
                  <span
                    className={cn(
                      'crm-num text-lg font-semibold',
                      pl.profit < 0 ? 'text-danger' : 'text-success',
                    )}
                  >
                    {fmt.aed(pl.profit)}
                  </span>
                </div>
              </div>
            </Card>

            <Stack>
              <Card title={t('accounts.trend.title')} sub={t('accounts.trend.sub')}>
                <BarChart data={bars} label={t('accounts.trend.chart')} height={150} />
              </Card>
              <Card title={t('accounts.mix.title')} sub={t('accounts.mix.sub')}>
                {pl.expenses.length === 0 ? (
                  <p className="crm-muted text-sm">{t('accounts.mix.empty')}</p>
                ) : (
                  <div className="space-y-3">
                    {pl.expenses
                      .filter((a) => a.balance > 0)
                      .sort((a, b) => b.balance - a.balance)
                      .slice(0, 6)
                      .map((a) => (
                        <Meter
                          key={a.code}
                          value={a.balance}
                          max={topExpense}
                          label={accountName(t, a.code, a.name)}
                          valueText={fmt.aed(a.balance)}
                          showLabel
                        />
                      ))}
                  </div>
                )}
              </Card>
            </Stack>
          </Grid>

          <Grid cols="col-2">
            <Card title={t('accounts.recent.title')} sub={t('accounts.recent.sub')}>
              {recent.length === 0 ? (
                <p className="crm-muted text-sm">{t('accounts.recent.empty')}</p>
              ) : (
                <div className="crm-tbl-wrap">
                  <table className="crm-tbl" data-stack="true">
                    <thead>
                      <tr>
                        <th>{t('accounts.recent.date')}</th>
                        <th>{t('accounts.recent.description')}</th>
                        <th>{t('accounts.recent.method')}</th>
                        <th className="crm-num-c">{t('accounts.recent.amount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map(({ e, amount, method }) => (
                        <tr key={e.id}>
                          <td data-label={t('accounts.recent.date')} className="crm-muted crm-num-c">
                            {fmt.dateShort(`${e.entryDate}T12:00:00Z`)}
                          </td>
                          <td data-label={t('accounts.recent.description')}>
                            <span className="block font-medium">{sourceLabel(t, e.sourceType)}</span>
                            {e.memo && <span className="crm-muted block text-xs">{e.memo}</span>}
                          </td>
                          <td data-label={t('accounts.recent.method')}>
                            <Pill>{t(`accounts.recent.${method}`)}</Pill>
                          </td>
                          <td
                            data-label={t('accounts.recent.amount')}
                            className={cn('crm-num-c font-semibold', amount < 0 && 'text-danger')}
                          >
                            {amount < 0 ? '−' : ''}
                            {fmt.aed(Math.abs(amount))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Note tone="acc" icon={<Banknote aria-hidden strokeWidth={1.8} />} className="mt-3">
                {t('accounts.recent.note')}
              </Note>
            </Card>

            <Stack>
              <Card
                title={t('accounts.vat.title', { quarter })}
                sub={t('accounts.vat.sub')}
                actions={<Pill tone="warn">{t('accounts.vat.due', { date: fmt.date(vatDue) })}</Pill>}
              >
                <Line label={t('accounts.vat.taxable')} value={vat.taxableSalesAed} fmt={fmt} />
                <Line label={t('accounts.vat.output')} value={vat.outputVatAed} fmt={fmt} />
                <Line label={t('accounts.vat.input')} value={vat.inputVatAed} fmt={fmt} />
                <div className="mt-1 border-t pt-1">
                  <Line label={t('accounts.vat.net')} value={vat.netVatDueAed} fmt={fmt} strong />
                </div>
                <Note className="mt-3">{t('accounts.vat.note')}</Note>
              </Card>
              <Card
                title={t('accounts.money.title')}
                sub={t('accounts.money.sub', { date: fmt.date(`${range.to}T12:00:00Z`) })}
              >
                <Line label={t('accounts.money.cash')} value={bal('1000')} fmt={fmt} />
                <Line label={t('accounts.money.card')} value={bal('1010')} fmt={fmt} />
                <Line label={t('accounts.money.bank')} value={bal('1020')} fmt={fmt} />
                <div className="mt-1 border-t pt-1">
                  <Line label={t('accounts.money.gift')} value={bal('2100')} fmt={fmt} muted />
                  <Line label={t('accounts.money.packages')} value={bal('2110')} fmt={fmt} muted />
                  <Line label={t('accounts.money.tips')} value={bal('2200')} fmt={fmt} muted />
                  <Line label={t('accounts.money.commissions')} value={bal('2300')} fmt={fmt} muted />
                </div>
              </Card>
            </Stack>
          </Grid>

          <Card title={t('accounts.close.title')} sub={t('accounts.close.sub')}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <p className="flex items-center gap-2 text-sm">
                <Lock className="crm-muted size-4" strokeWidth={1.5} />
                {lock ? (
                  <span>
                    {t('accounts.close.closedThrough', {
                      date: fmt.date(`${lock.lockedThrough}T12:00:00Z`),
                    })}
                  </span>
                ) : (
                  <span className="crm-muted">{t('accounts.close.none')}</span>
                )}
              </p>
              {manage && (
                <ActionForm
                  action={lockPeriodAction.bind(null, ctx.tenant.slug)}
                  className="flex items-end gap-3"
                >
                  <Field label={t('accounts.close.through')} name="through">
                    <Input
                      id="through"
                      name="through"
                      type="date"
                      defaultValue={range.to < todayDubai() ? range.to : ''}
                    />
                  </Field>
                  <SubmitButton variant="secondary">{t('accounts.close.submit')}</SubmitButton>
                </ActionForm>
              )}
            </div>
          </Card>
        </Stack>
      </PageBody>
    </>
  )
}
