'use client'
// R36 "Today's bookings & sales" (dashboard home, under the KPI row): every booking of one business day (all
// statuses) with its sale, plus the day's sales not on one of its bookings; filter chips, totals and the next step
// per row. Money (fees, paid, totals, sale-only rows) only when `money` (dashboard.revenue or pos.use); the service
// already leaves it out otherwise. Client first names only, typed names never translated.
import { enumLabel } from '@spa/core/i18n'
import type { TodayOrderRow, TodayOrders, TodayStage } from '@spa/services'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { ConfirmBookingButton } from '@/components/bookings/confirm-booking'
import { Card, Pill, Seg, Stat, statusTone, type Tone } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/page'
import { useI18n } from '@/i18n/client'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'

type Filter = 'all' | TodayStage
const FILTERS = [
  'all',
  'to_confirm',
  'to_finish',
  'not_paid',
  'paid',
  'cancelled',
] as const satisfies Filter[]
const METHODS = ['cash', 'card', 'other'] as const
const noon = (date: string) => `${date}T12:00:00+04:00`

export function TodayOrdersCard({
  slug,
  orders,
  isToday,
  money,
  branchNames,
  nav,
  calendarHref,
  bookingsHref,
  allow,
}: {
  slug: string
  orders: TodayOrders
  isToday: boolean
  money: boolean
  /** Branch names by id when the viewer works in more than one branch (shown on each row), else null. */
  branchNames: Record<string, string> | null
  nav: { prev: string; next: string; today: string | null }
  calendarHref: string | null
  bookingsHref: string | null
  /** confirm = calendar.manage; finish = pos.use + calendar.view (the booking page's Finish); pos = pos.use. */
  allow: { confirm: boolean; finish: boolean; pos: boolean }
}) {
  const { t, fmt } = useI18n()
  const [filter, setFilter] = useState<Filter>('all')
  const rows = filter === 'all' ? orders.rows : orders.rows.filter((r) => r.stage === filter)
  const { totals } = orders
  const methodLabel = (m: (typeof METHODS)[number]) => enumLabel(t, 'paymentMethod', m)
  const split = METHODS.filter((m) => totals.paid[m] > 0)
    .map((m) => `${methodLabel(m)} ${fmt.aed(totals.paid[m])}`)
    .join(' · ')
  const base = appPath(`/${slug}`)

  const pill = (r: TodayOrderRow): { tone: Tone; label: string } => {
    if (r.kind === 'sale' || (r.stage === 'paid' && r.sale)) {
      const status = r.sale?.status ?? 'paid'
      return { tone: statusTone(status), label: enumLabel(t, 'saleStatus', status) }
    }
    if (r.status === 'pending') return { tone: 'warn', label: t('overview.today.pill.toConfirm') }
    const status = r.status ?? 'confirmed'
    return { tone: statusTone(status), label: enumLabel(t, 'bookingStatus', status) }
  }

  const note = (r: TodayOrderRow) => {
    if (r.kind === 'sale')
      return [
        r.clientFirstName && r.saleNumber !== null
          ? t('overview.today.note.sale', { number: r.saleNumber })
          : null,
        r.bookingDate
          ? t('overview.today.note.otherDay', { date: fmt.weekdayDate(noon(r.bookingDate)) })
          : t('overview.today.note.noBooking'),
      ]
    const cancelled = r.stage === 'cancelled'
    const source =
      r.source === 'online' && r.bookedAt
        ? t('overview.today.note.bookedOnline', {
            time:
              fmt.dateShort(r.bookedAt) === fmt.dateShort(r.startsAt)
                ? fmt.time(r.bookedAt)
                : fmt.dateTime(r.bookedAt),
          })
        : r.source === 'walk_in'
          ? t('overview.today.note.walkIn')
          : r.source && r.source !== 'online'
            ? t('overview.today.note.via', { source: enumLabel(t, 'bookingSource', r.source) })
            : null
    return [
      // Typed text (never translated).
      cancelled ? r.cancelReason : null,
      !cancelled && r.sale?.status === 'open'
        ? t('overview.today.note.finished', { time: fmt.time(r.sale.createdAt) })
        : null,
      source,
      r.clientType === 'regular'
        ? t('overview.today.note.regular')
        : r.clientType === 'new'
          ? t('overview.today.note.newClient')
          : null,
      r.notes,
    ]
  }

  const paid = (r: TodayOrderRow) => {
    const s = r.sale
    if (!s || s.status === 'open')
      return r.stage === 'not_paid' ? (
        <span className="font-medium text-[var(--crm-bad)]">{t('overview.today.paid.notPaid')}</span>
      ) : (
        <span className="crm-muted">—</span>
      )
    const used = METHODS.filter((m) => s.methods[m] > 0)
    const amount = used.reduce((sum, m) => sum + s.methods[m], 0) || s.totalAed
    return (
      <span className="block">
        <span className="crm-num block whitespace-nowrap font-medium">{fmt.aed(amount)}</span>
        {used.length > 0 && (
          <span className="crm-muted crm-num block text-xs">
            {used.length === 1
              ? methodLabel(used[0]!)
              : used.map((m) => `${methodLabel(m)} ${fmt.aed(s.methods[m])}`).join(' · ')}
          </span>
        )}
        {s.paidOn === 'other_day' && (
          <span className="crm-muted block whitespace-nowrap text-xs">
            {t('overview.today.paid.on', { date: fmt.dateShort(noon(s.businessDate)) })}
          </span>
        )}
      </span>
    )
  }

  const action = (r: TodayOrderRow, name: string, service: string) => {
    if (r.stage === 'cancelled') return null
    if (r.kind === 'booking' && r.status === 'pending')
      return allow.confirm && r.bookingId ? (
        <ConfirmBookingButton
          slug={slug}
          bookingId={r.bookingId}
          name={name}
          description={[name, service, fmt.time(r.startsAt)].filter(Boolean).join(' · ')}
          focusAfter={[
            `[data-order="${r.key}"] td:last-child :is(a, button)`,
            '[data-testid="today-orders"] [aria-pressed="true"]',
          ]}
        />
      ) : null
    const link = (href: string, label: string, primary: boolean) => (
      <Button size="sm" variant={primary ? 'primary' : 'secondary'} asChild>
        <Link href={href}>{label}</Link>
      </Button>
    )
    if (r.sale)
      return allow.pos
        ? link(
            `${base}/sales/${r.sale.id}`,
            t(
              r.sale.status === 'open'
                ? 'overview.today.action.takePayment'
                : 'overview.today.action.openSale',
            ),
            r.sale.status === 'open',
          )
        : null
    if (r.kind === 'booking' && r.bookingId && allow.finish)
      return link(
        `${base}/bookings/${r.bookingId}`,
        t(r.status === 'completed' ? 'overview.today.action.takePayment' : 'overview.today.action.finish'),
        r.status === 'completed',
      )
    return null
  }

  const day = fmt.weekdayDate(noon(orders.date))
  return (
    <Card
      title={isToday ? t('overview.today.title') : t('overview.today.titleDay')}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would add legend chrome; a toolbar-like group */}
          <div className="flex items-center gap-0.5" role="group" aria-label={t('overview.today.dayNav')}>
            <Button variant="ghost" size="icon" asChild>
              <Link href={nav.prev} aria-label={t('overview.today.prevDay')} scroll={false}>
                <ChevronLeft className="rtl:rotate-180" />
              </Link>
            </Button>
            <span
              className="crm-num min-w-24 text-center text-[length:var(--crm-fs-td)] font-semibold"
              data-today-day=""
            >
              {day}
            </span>
            <Button variant="ghost" size="icon" asChild>
              <Link href={nav.next} aria-label={t('overview.today.nextDay')} scroll={false}>
                <ChevronRight className="rtl:rotate-180" />
              </Link>
            </Button>
          </div>
          {nav.today && (
            <Button variant="secondary" size="sm" asChild>
              <Link href={nav.today} scroll={false}>
                {t('overview.today.backToToday')}
              </Link>
            </Button>
          )}
          {calendarHref && (
            <Button size="sm" asChild>
              <Link href={calendarHref}>{t('overview.today.openCalendar')}</Link>
            </Button>
          )}
        </div>
      }
      footer={
        bookingsHref ? (
          <Link href={bookingsHref} className="text-sm font-medium text-[var(--crm-accent)] hover:underline">
            {t('overview.today.allBookings')}
          </Link>
        ) : undefined
      }
      data-testid="today-orders"
    >
      <div className="space-y-4">
        {money && (
          <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            <Stat
              label={t('overview.today.totals.booked')}
              value={fmt.aed(totals.booked.aed)}
              change={{ text: t('overview.today.totals.bookings', { count: totals.booked.count }) }}
            />
            <Stat
              label={isToday ? t('overview.today.totals.paidToday') : t('overview.today.totals.paid')}
              value={fmt.aed(totals.paid.aed)}
              change={{ text: split || t('overview.today.totals.paidNone') }}
            />
            <Stat
              label={t('overview.today.totals.notPaid')}
              value={fmt.aed(totals.notPaid.aed)}
              change={{
                text: t('overview.today.totals.unpaid', { count: totals.notPaid.count }),
                dir: totals.notPaid.count ? 'down' : 'flat',
              }}
            />
            <Stat
              label={t('overview.today.totals.toFinish')}
              value={fmt.aed(totals.toFinish.aed)}
              change={{ text: t('overview.today.totals.bookings', { count: totals.toFinish.count }) }}
            />
          </div>
        )}

        {orders.rows.length > 0 && (
          <Seg
            label={t('overview.today.filter')}
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            // Without money the stages don't say whether anything is paid (completed rows stay under All).
            items={FILTERS.filter((f) => money || (f !== 'not_paid' && f !== 'paid')).map((f) => ({
              value: f,
              label: (
                <>
                  {t(`overview.today.chip.${f}`)}
                  <span className="tabular font-normal">{fmt.number(orders.counts[f])}</span>
                </>
              ),
            }))}
          />
        )}

        {orders.rows.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-5" />}
            title={t('overview.today.emptyTitle')}
            description={t('overview.today.emptyText')}
          />
        ) : rows.length === 0 ? (
          <p className="crm-muted py-6 text-center text-sm">{t('overview.today.emptyFilter')}</p>
        ) : (
          <div className="crm-tbl-wrap">
            {/* Phones: rows stack as cards (kit data-stack), so Status / Fee / Paid / the action stay in view. */}
            <table className="crm-tbl md:min-w-[34rem]" data-stack="true">
              <thead>
                <tr>
                  <th>{t('overview.today.col.time')}</th>
                  <th>{t('overview.today.col.client')}</th>
                  <th>{t('overview.today.col.service')}</th>
                  <th>{t('overview.today.col.therapist')}</th>
                  <th>{t('overview.today.col.status')}</th>
                  {money && <th className="crm-num-c">{t('overview.today.col.fee')}</th>}
                  {money && <th>{t('overview.today.col.paid')}</th>}
                  <th>
                    <span className="sr-only">{t('overview.today.col.action')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const name =
                    r.clientFirstName ??
                    (r.kind === 'sale' && r.saleNumber !== null
                      ? t('overview.today.shopSale', { number: r.saleNumber })
                      : t('overview.today.walkIn'))
                  const services = r.services.map((s) => s.name).join(', ')
                  const minutes = r.services.reduce((sum, s) => sum + (s.minutes ?? 0), 0)
                  const lines = note(r).filter(Boolean).slice(0, 2).join(' · ')
                  const p = pill(r)
                  const cancelled = r.stage === 'cancelled'
                  return (
                    <tr
                      key={r.key}
                      data-order={r.key}
                      data-stage={money ? r.stage : undefined}
                      className={cn(cancelled && 'crm-muted')}
                    >
                      <td className="align-top">
                        <span className="crm-num block font-semibold">{fmt.time(r.startsAt)}</span>
                        {branchNames?.[r.branchId] && (
                          <span className="crm-muted block whitespace-nowrap text-xs">
                            {branchNames[r.branchId]}
                          </span>
                        )}
                      </td>
                      <td className="align-top" data-label={t('overview.today.col.client')}>
                        <div className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5 max-md:justify-end">
                            <span className="font-medium" dir="auto">
                              {name}
                            </span>
                            {r.source === 'online' && <Pill tone="info">{t('overview.today.website')}</Pill>}
                          </span>
                          {lines && (
                            <span className="crm-muted line-clamp-2 max-w-[16rem] text-xs" dir="auto">
                              {lines}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="align-top" data-label={t('overview.today.col.service')}>
                        <div className="min-w-0">
                          <span className="line-clamp-2 max-w-[16rem]">{services || '—'}</span>
                          {minutes > 0 && (
                            <span className="crm-muted block text-xs">
                              {t('overview.today.minutes', { min: fmt.number(minutes) })}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="crm-muted align-top" data-label={t('overview.today.col.therapist')}>
                        {r.staff.join(', ') || '—'}
                      </td>
                      <td className="align-top" data-label={t('overview.today.col.status')}>
                        <Pill tone={p.tone} dot>
                          {p.label}
                        </Pill>
                      </td>
                      {money && (
                        <td className="crm-num-c align-top" data-label={t('overview.today.col.fee')}>
                          <div>
                            <span
                              className={cn('crm-num block whitespace-nowrap', cancelled && 'line-through')}
                            >
                              {fmt.aed(r.feeAed)}
                            </span>
                            {r.feeMissing && !cancelled && (
                              <span className="block whitespace-nowrap text-xs text-[var(--crm-warn)]">
                                {t('overview.today.feeMissing')}
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                      {money && (
                        <td className="align-top" data-label={t('overview.today.col.paid')}>
                          {paid(r)}
                        </td>
                      )}
                      {/* No label on phones: the button sits at the card's end. */}
                      <td className="align-top text-end">{action(r, name, services)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}
