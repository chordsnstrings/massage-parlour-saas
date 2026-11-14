// R36 "From the website" (dashboard home, next to Today's bookings & sales): online bookings waiting for confirmation
// (calendar.manage, like the booking.online notice) and new website enquiries (clients.view) with the Enquiries page's
// own reply rules, plus the phone-alerts switch for this device. Client first names / typed names as-is.
import { addDays, whatsappLink } from '@spa/core'
import { enquiryNight, siteEnquiryReplyText, type WebsiteInbox } from '@spa/services'
import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { EnquiryActions } from '@/app/dashboard/[tenant]/enquiries/enquiries-client'
import { ConfirmBookingButton } from '@/components/bookings/confirm-booking'
import { Card, Pill } from '@/components/crm'
import { PushAlertsRow } from '@/components/push/enable-notifications'
import { Button } from '@/components/ui/button'
import { getI18n } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { can, type MemberContext } from '@/server/access'

const noon = (date: string) => `${date}T12:00:00+04:00`

export async function WebsiteCard({
  ctx,
  inbox,
  today,
  money,
  online,
  enquiries,
  live,
  publicKey,
}: {
  ctx: MemberContext
  inbox: WebsiteInbox
  /** Today's business date. */
  today: string
  money: boolean
  /** Sections the viewer may see (calendar.manage / clients.view). */
  online: boolean
  enquiries: boolean
  live?: React.ReactNode
  publicKey: string | null
}) {
  const { t, fmt } = await getI18n()
  const slug = ctx.tenant.slug
  const now = new Date()
  const calendar = appPath(`/${slug}/calendar`)
  const seeCalendar = can(ctx, 'calendar.view')
  const seePhone = can(ctx, 'clients.phone')
  const canManage = can(ctx, 'clients.manage')
  const canBook = can(ctx, 'calendar.manage')
  const at = (d: Date) => (fmt.dateShort(d) === fmt.dateShort(now) ? fmt.time(d) : fmt.dateTime(d))
  const when = (businessDate: string, startsAt: Date) => {
    const time = fmt.time(startsAt)
    if (businessDate === today) return t('overview.web.when.today', { time })
    if (businessDate === addDays(today, 1)) return t('overview.web.when.tomorrow', { time })
    return `${fmt.weekdayDate(noon(businessDate))} ${time}`
  }
  const minutes = (n: number | null) => (n ? t('overview.today.minutes', { min: fmt.number(n) }) : null)

  return (
    <Card title={t('overview.web.title')} actions={live} data-testid="website-inbox">
      <div className="space-y-5">
        {/* Two columns while the card spans the page (stacked layout), one beside the bookings card. */}
        <div className={cn('grid gap-5', online && enquiries && 'md:grid-cols-2 min-[90rem]:grid-cols-1')}>
          {online && (
            <section aria-labelledby="web-online" className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h4 id="web-online" tabIndex={-1} className="text-[13px] font-semibold outline-none">
                  {t('overview.web.online.title')}
                </h4>
                <Pill tone={inbox.pendingOnlineCount ? 'warn' : undefined}>
                  {fmt.number(inbox.pendingOnlineCount)}
                </Pill>
              </div>
              {inbox.pendingOnline.length ? (
                <ul className="divide-y">
                  {inbox.pendingOnline.map((b) => {
                    const name = b.clientFirstName ?? t('overview.today.walkIn')
                    const service = b.services
                      .map((s) => [s.name, minutes(s.minutes)].filter(Boolean).join(', '))
                      .join(' + ')
                    const open = `${calendar}?${new URLSearchParams({ date: b.businessDate, branch: b.branchId, open: b.bookingId })}`
                    return (
                      <li key={b.bookingId} className="space-y-1.5 py-2.5" data-web-booking={b.bookingId}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate font-medium" dir="auto">
                            {name}
                          </span>
                          <span className="crm-muted crm-num shrink-0 text-xs">
                            {t('overview.web.online.booked', { time: at(b.bookedAt) })}
                          </span>
                        </div>
                        <p className="crm-muted text-[13px]">
                          {[
                            service,
                            when(b.businessDate, b.startsAt),
                            money && !b.feeMissing ? fmt.aed(b.feeAed) : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <ConfirmBookingButton
                            slug={slug}
                            bookingId={b.bookingId}
                            name={name}
                            description={[name, service, when(b.businessDate, b.startsAt)].join(' · ')}
                            focusAfter={['#web-online']}
                          />
                          {seeCalendar && (
                            <Button size="sm" variant="ghost" asChild>
                              <Link href={open}>{t('overview.web.online.open')}</Link>
                            </Button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="crm-muted text-sm">{t('overview.web.online.empty')}</p>
              )}
              {inbox.pendingOnlineCount > inbox.pendingOnline.length && seeCalendar && (
                <Link
                  href={appPath(
                    `/${slug}/bookings?mark=pending&source=online&from=${today}&to=${addDays(today, 365)}`,
                  )}
                  className="inline-flex text-sm font-medium text-[var(--crm-accent)] hover:underline"
                >
                  {t('overview.web.online.all')}
                </Link>
              )}
            </section>
          )}

          {enquiries && (
            <section aria-labelledby="web-enquiries" className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h4 id="web-enquiries" className="text-[13px] font-semibold">
                  {t('overview.web.enquiries.title')}
                </h4>
                <Pill tone={inbox.enquiriesNewCount ? 'info' : undefined}>
                  {fmt.number(inbox.enquiriesNewCount)}
                </Pill>
              </div>
              {inbox.enquiries.length ? (
                <ul className="divide-y">
                  {inbox.enquiries.map((e) => {
                    const night = e.booking ? enquiryNight(e.booking, inbox.hours) : null
                    const request =
                      e.booking && night
                        ? [
                            e.booking.service,
                            minutes(e.booking.durationMin ?? null),
                            night.afterMidnight
                              ? t('enquiries.booking.night', {
                                  date: fmt.weekdayDate(noon(e.booking.date)),
                                  time: e.booking.time,
                                  calendarDate: fmt.weekdayDate(noon(night.calendarDate)),
                                })
                              : t('enquiries.booking.when', {
                                  date: fmt.date(noon(e.booking.date)),
                                  time: e.booking.time,
                                }),
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : null
                    const booked = e.booked
                    return (
                      <li key={e.id} className="space-y-1.5 py-2.5" data-web-enquiry={e.id}>
                        <div className="flex items-baseline justify-between gap-3">
                          {/* Names are as the guest typed them (never translated). */}
                          <span className="truncate font-medium" dir="auto">
                            {e.name}
                          </span>
                          <span className="crm-muted crm-num shrink-0 text-xs">{at(e.createdAt)}</span>
                        </div>
                        {request && (
                          <p className="text-[13px]">
                            <span className="font-medium">{t('enquiries.booking.title')}</span> · {request}
                          </p>
                        )}
                        {e.message && (
                          <p className="crm-muted line-clamp-2 whitespace-pre-line text-[13px]" dir="auto">
                            {e.message}
                          </p>
                        )}
                        <EnquiryActions
                          compact
                          slug={slug}
                          id={e.id}
                          name={e.name}
                          status={e.status}
                          canManage={canManage}
                          replyHref={
                            seePhone
                              ? whatsappLink(
                                  e.phone,
                                  siteEnquiryReplyText(e, ctx.tenant.name, { hours: inbox.hours, booked }),
                                )
                              : null
                          }
                          bookHref={canBook && e.booking && !booked ? `${calendar}?enquiry=${e.id}` : null}
                          booked={booked !== null}
                          bookedHref={
                            booked && seeCalendar
                              ? `${calendar}?${new URLSearchParams({ date: booked.businessDate, branch: booked.branchId, open: booked.id })}`
                              : null
                          }
                        />
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="crm-muted text-sm">{t('overview.web.enquiries.empty')}</p>
              )}
              <Link
                href={appPath(`/${slug}/enquiries`)}
                className="inline-flex items-center gap-1 text-sm font-medium text-[var(--crm-accent)] hover:underline"
              >
                {t('overview.web.enquiries.all')}{' '}
                <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
              </Link>
            </section>
          )}
        </div>

        <PushAlertsRow publicKey={publicKey} />
      </div>
    </Card>
  )
}
