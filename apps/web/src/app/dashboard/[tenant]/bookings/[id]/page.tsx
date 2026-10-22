import { phoneLineOptions, sheetCode } from '@spa/core'
import { bookingSourceLabel, enumLabel } from '@spa/core/i18n'
import { withTenant } from '@spa/db'
import { bookingDetail, isDayClosed, lastBookingTerms, orderSale } from '@spa/services'
import { ArrowLeft, Receipt } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { allowedBranches, ownStaffId } from '@/app/dashboard/[tenant]/calendar/data'
import { CorrectOrderForm } from '@/components/bookings/correct-order'
import { DetailsForm, TermsForm } from '@/components/bookings/order-forms'
import { formatPhone } from '@/components/calendar/time'
import { maskClientPhone } from '@/components/clients/shared'
import { Card, Grid, Note, Pill, Stack, TName } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { BookingMarks, CommissionForm } from '../booking-client'
import { MarkPill } from '../mark-pill'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('bookings.title') }
}

export default async function BookingPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const ctx = await requireMember(tenant)
  if (!can(ctx, 'calendar.view') || !/^[0-9a-f-]{36}$/.test(id)) notFound()
  const { t, fmt } = await getI18n()
  const slug = ctx.tenant.slug
  const canManage = can(ctx, 'calendar.manage')
  const canCommission = canManage && can(ctx, 'calendar.commission')
  const canCheckout = can(ctx, 'pos.use')
  const loaded = await withTenant(ctx.tenant.id, async (tx) => {
    const b = await bookingDetail(tx, id)
    if (!b || !(await allowedBranches(tx, ctx)).some((br) => br.id === b.branchId)) return null
    // Therapists see only bookings they work on.
    if (!canManage) {
      const mine = await ownStaffId(tx, ctx)
      if (!mine || !b.items.some((i) => i.therapists.some((x) => x.staffId === mine))) return null
    }
    // R32: the linked order (sale), the last amounts typed per treatment, and the day locks: the booking's day for
    // fee / commission / details / Finish (its sheet row and commission rows), the sale's day for the payment.
    const order = await orderSale(tx, b.id)
    const last = await lastBookingTerms(
      tx,
      b.items.flatMap((i) => (i.serviceVariantId ? [i.serviceVariantId] : [])),
    )
    const bookingClosed = await isDayClosed(tx, b.branchId, b.businessDate)
    const saleClosed = order
      ? order.sale.businessDate === b.businessDate
        ? bookingClosed
        : await isDayClosed(tx, b.branchId, order.sale.businessDate)
      : false
    return { b, order, last, bookingClosed, saleClosed }
  })
  if (!loaded) notFound()
  const { b: data, order, last } = loaded

  const completed = data.status === 'completed'
  const open = !completed && data.status !== 'cancelled' && data.status !== 'no_show'
  // R32 (D6): a closed day changes only with pos.correct (owners/managers) — the same days the actions lock.
  const mayCorrect = can(ctx, 'pos.correct')
  const locked = loaded.bookingClosed && !mayCorrect
  const paymentLocked = loaded.saleClosed && !mayCorrect
  const finished = order !== null
  const lineOf = (n: number | null) =>
    n == null
      ? '—'
      : [`P${n}`, phoneLineOptions(ctx.tenant.settings).find((o) => o.line === n)?.number]
          .filter(Boolean)
          .join(' · ')
  const rows = data.items.flatMap((i) =>
    i.therapists.map((x) => ({
      itemId: i.id,
      staffId: x.staffId,
      name: x.name ?? '—',
      service: i.serviceName,
      amountAed: x.commissionAed,
    })),
  )
  const total = data.items.reduce((s, i) => s + Number(i.priceAed), 0)
  const phone = data.clientPhone
    ? can(ctx, 'clients.phone')
      ? formatPhone(data.clientPhone)
      : maskClientPhone(data.clientPhone)
    : null
  const facts: [string, React.ReactNode][] = [
    [
      t('bookings.detail.client'),
      data.clientName ? <TName key="client" name={data.clientName} sub={phone} /> : t('bookings.walkIn'),
    ],
    [t('bookings.detail.branch'), data.branchName],
    [t('bookings.detail.date'), fmt.weekdayDate(data.startsAt)],
    [t('bookings.detail.time'), `${fmt.time(data.startsAt)}–${fmt.time(data.endsAt)}`],
    [
      t('bookings.detail.source'),
      // F16: partner names are typed (never translated).
      [bookingSourceLabel(t, data.source, data.attribution), data.partnerName].filter(Boolean).join(' · '),
    ],
    [t('bookings.detail.total'), fmt.aed(total)],
    [t('bookings.order.code'), sheetCode(data)],
    ...(data.source === 'phone'
      ? [[t('calendar.fields.phoneLine'), lineOf(data.phoneLine)] as [string, string]]
      : []),
    [
      t('calendar.fields.clientType'),
      data.clientType
        ? enumLabel(t, 'bookingClientType', data.clientType)
        : t('calendar.fields.clientTypeNone'),
    ],
    ...(data.ownLead
      ? [
          [
            t('calendar.fields.ownLead'),
            <Pill key="own" tone="own">
              {t('calendar.sheet.ownClient')}
            </Pill>,
          ] as [string, React.ReactNode],
        ]
      : []),
    ...(data.notes ? [[t('bookings.detail.notes'), data.notes] as [string, string]] : []),
    ...(data.cancelReason && data.status === 'cancelled'
      ? [[t('bookings.detail.cancelReason'), data.cancelReason] as [string, string]]
      : []),
  ]

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={appPath(`/${slug}/bookings`)}
            className="inline-flex items-center gap-1 hover:underline"
          >
            <ArrowLeft className="size-3 rtl:rotate-180" aria-hidden /> {t('bookings.back')}
          </Link>
        }
        title={t('bookings.detail.title', { ref: data.refCode })}
        actions={<MarkPill status={data.status} t={t} />}
      />
      <Stack>
        <Grid cols="col-2">
          <Card title={t('bookings.detail.details')}>
            <Stack>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-[length:var(--crm-fs-body)]">
                {facts.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="crm-muted">{k}</dt>
                    <dd className="min-w-0">{v}</dd>
                  </div>
                ))}
              </dl>
              {canManage && !locked && (open || completed) && (
                <details className="group">
                  <summary className="cursor-pointer text-[length:var(--crm-fs-sub)] font-medium text-[var(--crm-accent)]">
                    {t('calendar.sheet.details')}
                  </summary>
                  <div className="pt-3">
                    <DetailsForm
                      slug={slug}
                      bookingId={data.id}
                      source={data.source}
                      phoneLines={phoneLineOptions(ctx.tenant.settings)}
                      phoneLine={data.phoneLine}
                      clientType={data.clientType}
                      ownLead={data.ownLead}
                    />
                  </div>
                </details>
              )}
            </Stack>
          </Card>
          <Card title={t('bookings.detail.treatments')}>
            <ul className="space-y-2">
              {data.items.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{i.serviceName}</p>
                    <p className="crm-muted text-[length:var(--crm-fs-sub)]">
                      {fmt.time(i.startsAt)} · {t('bookings.detail.minutes', { count: i.durationMin })} ·{' '}
                      {i.therapists.length
                        ? i.therapists.map((x) => x.name ?? '—').join(', ')
                        : t('bookings.noTherapist')}
                    </p>
                  </div>
                  <span className="crm-num shrink-0">
                    {i.priceAed == null ? t('common.priceOnRequest') : fmt.aed(i.priceAed)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </Grid>

        {(open || completed) && (
          <Card
            title={t('bookings.order.title')}
            sub={finished ? t('bookings.commission.subDone') : t('bookings.commission.sub')}
          >
            <Stack>
              {(locked || (finished && paymentLocked)) && <Note>{t('bookings.order.closedNote')}</Note>}
              {completed && !finished && <Note tone="warn">{t('bookings.order.notPaid')}</Note>}
              {finished && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link
                    href={appPath(`/${slug}/sales/${order.sale.id}`)}
                    className="inline-flex items-center gap-2 font-medium text-[var(--crm-accent)] hover:underline"
                  >
                    <Receipt className="size-4" aria-hidden />{' '}
                    {t('calendar.sheet.sale', { number: order.sale.number })}
                  </Link>
                  <span className="crm-muted crm-num text-[length:var(--crm-fs-sub)]">
                    {t('bookings.order.summary', {
                      cash: fmt.aed(order.cashAed),
                      card: fmt.aed(order.cardAed),
                      other: fmt.aed(order.otherAed),
                      tips: fmt.aed(order.tipsAed),
                    })}
                  </span>
                </div>
              )}
              {finished && rows.length > 0 && !data.commissionEntered && (
                <Note tone="warn">{t('bookings.commission.missingNote')}</Note>
              )}
              {!finished && open && canManage && !locked && (
                <TermsForm
                  slug={slug}
                  bookingId={data.id}
                  canCommission={canCommission}
                  items={data.items.map((i) => {
                    const prev = i.serviceVariantId ? last.get(i.serviceVariantId) : undefined
                    return {
                      id: i.id,
                      serviceName: i.serviceName,
                      feeAed: i.termsSet ? i.priceAed : (prev?.feeAed ?? i.priceAed),
                      commissionAed: i.plannedCommissionAed ?? prev?.commissionAed ?? null,
                    }
                  })}
                />
              )}
              {finished && canCommission && !locked && rows.length > 0 ? (
                <CommissionForm
                  slug={slug}
                  bookingId={data.id}
                  // Nothing recorded yet (finished by someone without commission rights): the planned amount.
                  rows={rows.map((r) => {
                    const planned = data.items.find((i) => i.id === r.itemId)?.plannedCommissionAed
                    return { ...r, amountAed: r.amountAed ?? (planned == null ? null : Number(planned)) }
                  })}
                  completed
                />
              ) : (
                rows.map((r) => {
                  const planned = data.items.find((i) => i.id === r.itemId)?.plannedCommissionAed
                  const amount = r.amountAed ?? (planned == null ? null : Number(planned))
                  return (
                    <p key={`${r.itemId}:${r.staffId}`} className="flex justify-between gap-3">
                      <span>
                        {r.name} · {r.service}
                      </span>
                      <span className="crm-num">
                        {amount === null ? t('bookings.missing') : fmt.aed(amount)}
                      </span>
                    </p>
                  )
                })
              )}
              {(!locked || (finished && !paymentLocked)) && (
                <div className="flex flex-wrap gap-2">
                  {!finished && !locked && canCheckout && data.status !== 'pending' && (
                    <Button asChild>
                      <Link href={appPath(`/${slug}/sales/new?booking=${data.id}`)}>
                        <Receipt /> {t('bookings.order.finish')}
                      </Link>
                    </Button>
                  )}
                  {finished && !paymentLocked && canCheckout && canCommission && (
                    <CorrectOrderForm
                      slug={slug}
                      bookingId={data.id}
                      lines={order.lines}
                      payments={order.payments}
                      tips={order.tips}
                      staff={[
                        ...new Map(
                          data.items.flatMap((i) =>
                            i.therapists.map((x) => [x.staffId, { id: x.staffId, name: x.name ?? '—' }]),
                          ),
                        ).values(),
                      ]}
                    />
                  )}
                </div>
              )}
            </Stack>
          </Card>
        )}

        {canManage && (
          <Card title={t('bookings.detail.markTitle')} sub={t('bookings.detail.markSub')}>
            <BookingMarks
              slug={slug}
              bookingId={data.id}
              status={data.status}
              canReopen={canCommission && !locked}
            />
          </Card>
        )}
        <div>
          <Button variant="ghost" asChild>
            <Link href={appPath(`/${slug}/calendar?date=${data.businessDate}`)}>{t('nav.calendar')}</Link>
          </Button>
        </div>
      </Stack>
    </>
  )
}
