import { businessDateOf, businessDayWindow } from '@spa/core'
import { enumLabel } from '@spa/core/i18n'
import { bookingItems, bookings, branches, shifts, staff, staffServices, withTenant } from '@spa/db'
import { dubaiToday, type TrackedDocument, trackedDocuments } from '@spa/services'
import { and, asc, count, desc, eq, gt, lt, notInArray } from 'drizzle-orm'
import { UserRound } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Grid, Pill, TeamCard } from '@/components/crm'
import { docTypeLabel } from '@/components/documents/labels'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { memberOptions, serviceOptions } from './data'
import { StaffSheet } from './staff-client'

export async function generateMetadata() {
  return { title: (await getT())('staff.title') }
}

type Translator = Awaited<ReturnType<typeof getT>>

/** The most urgent dated document of a person → status pill (valid / expires in N days / expired). */
function docPill(t: Translator, docs: TrackedDocument[]) {
  const dated = docs.filter((d) => d.days !== null).sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
  if (docs.length === 0) return null
  const next = dated[0]
  if (!next || next.status === 'ok')
    return (
      <Pill tone="ok" dot>
        {t('staff.docs.valid')}
      </Pill>
    )
  const type = docTypeLabel(t, next.type, next.typeLabel)
  const days = next.days ?? 0
  return (
    <Pill tone={days < 0 ? 'bad' : 'warn'} dot>
      {days < 0
        ? t('staff.docs.expired', { type })
        : days === 0
          ? t('staff.docs.expiresToday', { type })
          : t('staff.docs.expiresIn', { type, count: days })}
    </Pill>
  )
}

export default async function StaffPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'staff.view')) notFound()
  const { t, fmt } = await getI18n()
  const slug = ctx.tenant.slug
  const manage = can(ctx, 'staff.manage')

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [branch] = await tx
      .select({ cutoff: branches.businessDayCutoff })
      .from(branches)
      .orderBy(desc(branches.isDefault), asc(branches.createdAt))
      .limit(1)
    const cutoff = (branch?.cutoff ?? '05:00').slice(0, 5)
    const businessDate = businessDateOf(new Date(), cutoff)
    const window = businessDayWindow(businessDate, cutoff)
    return {
      people: await tx
        .select()
        .from(staff)
        .orderBy(desc(staff.active), asc(staff.sort), asc(staff.createdAt)),
      skillCounts: await tx
        .select({ staffId: staffServices.staffId, n: count() })
        .from(staffServices)
        .groupBy(staffServices.staffId),
      today: await tx
        .select({ staffId: shifts.staffId, startsAt: shifts.startsAt, endsAt: shifts.endsAt })
        .from(shifts)
        .where(and(lt(shifts.startsAt, window.end), gt(shifts.endsAt, window.start)))
        .orderBy(asc(shifts.startsAt)),
      // Today's live bookings per therapist (a booking with two of their items counts once).
      todayItems: await tx
        .select({ bookingId: bookingItems.bookingId, staffIds: bookingItems.staffIds })
        .from(bookingItems)
        .innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
        .where(
          and(eq(bookings.businessDate, businessDate), notInArray(bookings.status, ['cancelled', 'no_show'])),
        ),
      docs: manage ? await trackedDocuments(tx, dubaiToday()) : [],
    }
  })
  const [memberList, serviceList] = manage
    ? await Promise.all([memberOptions(ctx.tenant.id), serviceOptions(ctx.tenant.id)])
    : [[], []]
  const skills = new Map(data.skillCounts.map((s) => [s.staffId, s.n]))
  const bookingsToday = new Map<string, Set<string>>()
  for (const item of data.todayItems)
    for (const id of item.staffIds) {
      const set = bookingsToday.get(id) ?? new Set<string>()
      set.add(item.bookingId)
      bookingsToday.set(id, set)
    }

  const addButton = manage ? <StaffSheet slug={slug} members={memberList} services={serviceList} /> : null

  return (
    <>
      <PageHeader title={t('staff.title')} description={t('staff.description')} actions={addButton} />
      <PageBody>
        {data.people.length === 0 ? (
          <Card>
            <EmptyState
              icon={<UserRound className="size-5" strokeWidth={1.5} />}
              title={t('staff.empty.title')}
              description={t('staff.empty.body')}
              action={addButton}
            />
          </Card>
        ) : (
          <Grid cols="g4">
            {data.people.map((p) => {
              const shift = data.today.find((s) => s.staffId === p.id)
              const n = skills.get(p.id) ?? 0
              const gender = p.gender ? enumLabel(t, 'staffGender', p.gender) : t('staff.genderNotSet')
              return (
                <Link
                  key={p.id}
                  href={appPath(`/${slug}/staff/${p.id}`)}
                  className="block h-full rounded-[var(--crm-radius)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/15"
                >
                  <TeamCard
                    className="h-full transition-[transform,border-color] duration-200 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                    name={p.displayName}
                    src={p.photoUrl}
                    color={p.color}
                    subtitle={`${gender} · ${t('staff.servicesCount', { count: n })}`}
                    stats={[
                      {
                        label: t('staff.card.bookingsToday'),
                        value: fmt.number(bookingsToday.get(p.id)?.size ?? 0),
                      },
                      {
                        label: t('staff.card.shift'),
                        value: shift
                          ? t('staff.card.shiftTime', {
                              start: fmt.time(shift.startsAt),
                              end: fmt.time(shift.endsAt),
                            })
                          : t('staff.card.off'),
                      },
                      {
                        label: t('staff.card.pay'),
                        value:
                          p.payType === 'sales_commission'
                            ? `${fmt.number(Number(p.commissionPct))}%`
                            : p.payType === 'salary'
                              ? fmt.aed(p.baseSalaryAed)
                              : p.payType === 'booking_fee'
                                ? enumLabel(t, 'staffPayType', p.payType)
                                : t('staff.card.perBooking'),
                      },
                    ]}
                  >
                    <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                      {!p.active ? (
                        <Pill>{t('staff.status.archived')}</Pill>
                      ) : !p.bookable ? (
                        <Pill tone="warn">{t('staff.status.notBookable')}</Pill>
                      ) : null}
                      {manage &&
                        p.active &&
                        docPill(
                          t,
                          data.docs.filter((d) => d.staffId === p.id),
                        )}
                    </div>
                  </TeamCard>
                </Link>
              )
            })}
          </Grid>
        )}
      </PageBody>
    </>
  )
}
