import { bookingSourceLabel } from '@spa/core/i18n'
import { withTenant } from '@spa/db'
import { bookingDetail } from '@spa/services'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { allowedBranches, ownStaffId } from '@/app/dashboard/[tenant]/calendar/data'
import { formatPhone } from '@/components/calendar/time'
import { maskClientPhone } from '@/components/clients/shared'
import { Card, Grid, Note, Stack, TName } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { BookingMarks, CommissionForm, CompleteButton } from '../booking-client'
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
  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const b = await bookingDetail(tx, id)
    if (!b || !(await allowedBranches(tx, ctx)).some((br) => br.id === b.branchId)) return null
    // Therapists see only bookings they work on.
    if (!canManage) {
      const mine = await ownStaffId(tx, ctx)
      if (!mine || !b.items.some((i) => i.therapists.some((x) => x.staffId === mine))) return null
    }
    return b
  })
  if (!data) notFound()

  const completed = data.status === 'completed'
  const open = !completed && data.status !== 'cancelled' && data.status !== 'no_show'
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
    [t('bookings.detail.source'), bookingSourceLabel(t, data.source, data.attribution)],
    [t('bookings.detail.total'), fmt.aed(total)],
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
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-[length:var(--crm-fs-body)]">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="crm-muted">{k}</dt>
                  <dd className="min-w-0">{v}</dd>
                </div>
              ))}
            </dl>
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
            title={t('bookings.commission.title')}
            sub={completed ? t('bookings.commission.subDone') : t('bookings.commission.sub')}
          >
            <Stack>
              {completed && rows.length > 0 && !data.commissionEntered && (
                <Note tone="warn">{t('bookings.commission.missingNote')}</Note>
              )}
              {!canCommission ? (
                <>
                  {rows.map((r) => (
                    <p key={`${r.itemId}:${r.staffId}`} className="flex justify-between gap-3">
                      <span>
                        {r.name} · {r.service}
                      </span>
                      <span className="crm-num">
                        {r.amountAed === null ? t('bookings.missing') : fmt.aed(r.amountAed)}
                      </span>
                    </p>
                  ))}
                  {open && <Note>{t('bookings.commission.noPermission')}</Note>}
                </>
              ) : rows.length ? (
                <CommissionForm slug={slug} bookingId={data.id} rows={rows} completed={completed} />
              ) : (
                <>
                  <p className="crm-muted">{t('bookings.commission.noTherapists')}</p>
                  {open && <CompleteButton slug={slug} bookingId={data.id} />}
                </>
              )}
            </Stack>
          </Card>
        )}

        {canManage && (
          <Card title={t('bookings.detail.markTitle')} sub={t('bookings.detail.markSub')}>
            <BookingMarks slug={slug} bookingId={data.id} status={data.status} canReopen={canCommission} />
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
