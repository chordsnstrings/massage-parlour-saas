import { enumLabel } from '@spa/core/i18n'
import {
  plans,
  platformDb,
  platformInvoices,
  platformPayments,
  platformSettings,
  subscriptions,
  withTenant,
} from '@spa/db'
import {
  billingAlert,
  getCheckoutSession,
  StripeError,
  settleCheckoutSession,
  stripeConfig,
} from '@spa/services'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { Check, MessageCircle, ReceiptText } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Eyebrow, Grid, Hairline, ListRow, Note, Pill, Stack, statusTone } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { getI18n, getT } from '@/i18n/server'
import { todayDubai } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { PayByCardButton } from './pay-button'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('billing.title') }
}

const FEATURES = ['f1', 'f3', 'f4', 'f5'] as const

/** Card payments started on Stripe Checkout are confirmed by asking Stripe, never by trusting the return URL. */
async function settlePendingCardPayments(tenantId: string) {
  const cfg = stripeConfig()
  if (!cfg) return
  const db = platformDb()
  const pending = await db
    .select()
    .from(platformInvoices)
    .where(
      and(
        eq(platformInvoices.tenantId, tenantId),
        eq(platformInvoices.status, 'issued'),
        isNotNull(platformInvoices.stripeSessionId),
      ),
    )
  for (const inv of pending) {
    try {
      await settleCheckoutSession(db, inv, await getCheckoutSession(cfg, inv.stripeSessionId!))
    } catch (e) {
      if (!(e instanceof StripeError)) throw e
    }
  }
}

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ paid?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'billing.view')) notFound()
  const { t, fmt } = await getI18n()
  const justPaid = Boolean((await searchParams).paid)
  await settlePendingCardPayments(ctx.tenant.id)
  const cardsOn = stripeConfig() !== null
  const today = todayDubai()
  const { sub, invoices, payments, alert } = await withTenant(ctx.tenant.id, async (tx) => ({
    sub: (await tx.select().from(subscriptions).limit(1))[0],
    invoices: await tx.select().from(platformInvoices).orderBy(desc(platformInvoices.issueDate)),
    payments: await tx.select().from(platformPayments).orderBy(desc(platformPayments.receivedAt)),
    alert: await billingAlert(tx, ctx.tenant.id, today),
  }))
  const [plan, company] = await Promise.all([
    sub ? platformDb().query.plans.findFirst({ where: eq(plans.id, sub.planId) }) : undefined,
    platformDb().query.platformSettings.findFirst({ where: eq(platformSettings.id, 1) }),
  ])
  const day = (d: string | Date) => fmt.date(typeof d === 'string' && d.length === 10 ? `${d}T12:00:00Z` : d)
  const bank = [
    [t('billing.pay.bank'), company?.bankName],
    [t('billing.pay.accountName'), company?.bankAccountName],
    [t('billing.pay.iban'), company?.iban],
    [t('billing.pay.swift'), company?.swift],
  ].filter(([, v]) => v)
  // A partly paid invoice (e.g. a setup-fee deposit, PLAN §18.3) stays issued with a balance due; the card button
  // charges a whole invoice, so it is only offered while nothing has been paid on it yet.
  const paidOn = new Map<string, number>()
  for (const p of payments)
    if (p.invoiceId) paidOn.set(p.invoiceId, (paidOn.get(p.invoiceId) ?? 0) + Number(p.amountAed))
  const partly = (i: { id: string; status: string }) => i.status === 'issued' && (paidOn.get(i.id) ?? 0) > 0
  const open = invoices.find((i) => i.status === 'issued' && !partly(i))
  // R11: the current period's plan invoices (12 monthly or one-time) + the setup fee; status is set by the super-admin.
  const schedule = [
    ...invoices
      .filter((i) => i.kind === 'plan' && i.status !== 'void' && i.periodStart === sub?.currentPeriodStart)
      .sort((a, b) => (a.installment ?? 0) - (b.installment ?? 0)),
    ...invoices.filter((i) => i.kind === 'setup' && i.status !== 'void'),
  ]
  const monthly = sub?.billingInterval === 'month'
  const installment = sub ? fmt.aed((Math.round(Number(sub.priceAed) * 100) / 1200).toFixed(2)) : ''

  return (
    <>
      <PageHeader
        title={t('billing.title')}
        description={cardsOn ? t('billing.descriptionCards') : t('billing.description')}
      />
      <PageBody>
        <Stack>
          {justPaid && (
            <Note tone="acc">
              <span role="status">
                {invoices.some((i) => i.status === 'issued' && i.stripeSessionId)
                  ? t('billing.paid.processing')
                  : t('billing.paid.received')}
              </span>
            </Note>
          )}
          <Grid cols="col-2b">
            <Card arch>
              <div className="flex items-start justify-between gap-3">
                <Eyebrow>{t('billing.plan.eyebrow')}</Eyebrow>
                {sub && (
                  <Pill tone={statusTone(sub.status)}>{enumLabel(t, 'subscriptionStatus', sub.status)}</Pill>
                )}
              </div>
              <h2 className="mt-2 text-[26px] leading-tight">{plan?.name ?? t('billing.plan.fallback')}</h2>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="crm-num text-[34px] font-semibold">{sub ? fmt.aed(sub.priceAed) : '—'}</span>
                <span className="crm-muted">/ {t('billing.plan.per.year')}</span>
              </div>
              {sub && (
                <p className="mt-1 text-[13px] font-medium">
                  {t('billing.schedule.planLabel')}:{' '}
                  {monthly
                    ? t('billing.schedule.plan.month', { amount: installment })
                    : t('billing.schedule.plan.year')}
                  {Number(sub.setupFeeAed) > 0 && (
                    <span className="crm-muted font-normal">
                      {' '}
                      · {t('billing.schedule.setupFee')} {fmt.aed(sub.setupFeeAed)}
                    </span>
                  )}
                </p>
              )}
              {sub && (
                <p className="crm-muted mt-1 text-[13px]">
                  {company?.pricesIncludeVat ? t('billing.plan.inclVat') : t('billing.plan.exclVat')} ·{' '}
                  {sub.status === 'trialing'
                    ? t('billing.plan.trialEnds', { date: day(sub.currentPeriodEnd) })
                    : t('billing.plan.renews', { date: day(sub.currentPeriodEnd) })}
                </p>
              )}
              {sub && (
                <p className="crm-muted text-[12.5px]">
                  {t('billing.plan.period', {
                    from: day(sub.currentPeriodStart),
                    to: day(sub.currentPeriodEnd),
                  })}
                </p>
              )}
              <Hairline />
              <ul className="flex flex-col gap-2 text-[13px]">
                {FEATURES.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="size-4 shrink-0 text-[var(--crm-accent)]" aria-hidden />
                    {t(`billing.plan.${f}`)}
                  </li>
                ))}
              </ul>
              {cardsOn && open && (
                <div className="mt-4 flex flex-col items-stretch gap-2">
                  <PayByCardButton
                    slug={ctx.tenant.slug}
                    invoiceId={open.id}
                    label={t('billing.pay.invoiceByCard')}
                    wide
                  />
                  <p className="crm-muted text-center text-[11.5px]">{t('billing.plan.payHint')}</p>
                </div>
              )}
            </Card>

            <Stack>
              <Card title={t('billing.invoices.title')} flush>
                <DataTable
                  rows={invoices}
                  rowKey={(r) => r.id}
                  empty={
                    <EmptyState
                      icon={<ReceiptText className="size-5" />}
                      title={t('billing.invoices.empty')}
                    />
                  }
                  columns={[
                    {
                      key: 'number',
                      header: t('billing.invoices.number'),
                      primary: true,
                      cell: (r) => <span className="font-medium">{r.number}</span>,
                    },
                    {
                      key: 'desc',
                      header: t('billing.invoices.description'),
                      cell: (r) => r.description,
                      hideOnMobile: true,
                    },
                    { key: 'issued', header: t('billing.invoices.issued'), cell: (r) => day(r.issueDate) },
                    { key: 'due', header: t('billing.invoices.due'), cell: (r) => day(r.dueDate) },
                    {
                      key: 'total',
                      header: t('billing.invoices.total'),
                      className: 'text-end',
                      cell: (r) => <span className="crm-num">{fmt.aed(r.totalAed)}</span>,
                    },
                    {
                      key: 'status',
                      header: t('billing.invoices.status'),
                      className: 'text-end',
                      cell: (r) =>
                        partly(r) ? (
                          <Pill tone="warn">{t('billing.schedule.partlyPaid')}</Pill>
                        ) : cardsOn && r.status === 'issued' ? (
                          <span className="inline-flex items-center gap-2">
                            <Pill tone={statusTone(r.status)}>{enumLabel(t, 'invoiceStatus', r.status)}</Pill>
                            <PayByCardButton
                              slug={ctx.tenant.slug}
                              invoiceId={r.id}
                              label={t('billing.pay.byCard')}
                            />
                          </span>
                        ) : (
                          <Pill tone={statusTone(r.status)}>{enumLabel(t, 'invoiceStatus', r.status)}</Pill>
                        ),
                    },
                  ]}
                />
              </Card>
              <Card title={t('billing.pay.title')} sub={t('billing.pay.sub')}>
                {bank.length > 0 ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    {bank.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="crm-muted">{k}</dt>
                        <dd className="break-all font-medium">{v}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="crm-muted text-sm">{t('billing.pay.soon')}</p>
                )}
                {company?.whatsapp && (
                  <Button variant="secondary" size="sm" className="mt-4" asChild>
                    <a
                      href={`https://wa.me/${company.whatsapp.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MessageCircle /> {t('billing.pay.whatsapp')}
                    </a>
                  </Button>
                )}
              </Card>
            </Stack>
          </Grid>

          {alert.reminder && (
            <Note tone="warn">
              <span role="status">
                {t('billing.schedule.reminder', {
                  date: day(alert.reminder.createdAt),
                  amount: fmt.aed(alert.reminder.amountAed),
                })}
              </span>
            </Note>
          )}

          <Card title={t('billing.schedule.title')} sub={t('billing.schedule.sub')}>
            {schedule.length === 0 ? (
              <p className="crm-muted text-sm">{t('billing.schedule.empty')}</p>
            ) : (
              <div>
                {schedule.map((i) => {
                  const paid = i.status === 'paid'
                  const late = !paid && i.dueDate < today
                  return (
                    <ListRow
                      key={i.id}
                      title={
                        i.kind === 'setup'
                          ? t('billing.schedule.setupFee')
                          : i.installments === 1
                            ? t('billing.schedule.annual')
                            : t('billing.schedule.month', {
                                n: i.installment ?? 0,
                                total: i.installments ?? 0,
                              })
                      }
                      body={`${t('billing.schedule.due', { date: day(i.dueDate) })} · ${i.number}${
                        partly(i)
                          ? ` · ${t('billing.schedule.balance', {
                              paid: fmt.aed(paidOn.get(i.id) ?? 0),
                              balance: fmt.aed(Math.max(0, Number(i.totalAed) - (paidOn.get(i.id) ?? 0))),
                            })}`
                          : ''
                      }${late ? ` · ${t('billing.schedule.overdue')}` : ''}`}
                      time={<span className="crm-num">{fmt.aed(i.totalAed)}</span>}
                      end={
                        <Pill tone={paid ? 'ok' : partly(i) ? 'warn' : 'bad'} dot>
                          {paid
                            ? t('billing.schedule.paid')
                            : partly(i)
                              ? t('billing.schedule.partlyPaid')
                              : t('billing.schedule.mustPay')}
                        </Pill>
                      }
                    />
                  )
                })}
              </div>
            )}
          </Card>

          {payments.length > 0 && (
            <Card title={t('billing.payments.title')} flush>
              <DataTable
                rows={payments}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: 'date',
                    header: t('billing.payments.date'),
                    primary: true,
                    cell: (r) => day(r.receivedAt),
                  },
                  {
                    key: 'method',
                    header: t('billing.payments.method'),
                    cell: (r) => enumLabel(t, 'paymentMethod', r.method),
                  },
                  { key: 'ref', header: t('billing.payments.reference'), cell: (r) => r.reference ?? '—' },
                  {
                    key: 'amount',
                    header: t('billing.payments.amount'),
                    className: 'text-end',
                    cell: (r) => <span className="crm-num">{fmt.aed(r.amountAed)}</span>,
                  },
                ]}
              />
            </Card>
          )}
        </Stack>
      </PageBody>
    </>
  )
}
