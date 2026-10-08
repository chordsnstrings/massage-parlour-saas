import { addDays, businessDateOf, dubaiParts } from '@spa/core'
import { enumLabel } from '@spa/core/i18n'
import { branches, members, platformDb, shifts, staff, staffServices, user, withTenant } from '@spa/db'
import { and, asc, desc, eq, gt, lt } from 'drizzle-orm'
import { ArrowLeft, CalendarDays } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Avatar, Card, Grid, Pill, Stack } from '@/components/crm'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { dubaiTime, memberOptions, serviceOptions } from '../data'
import { DeleteShiftButton, PatternForm, StaffSheet } from '../staff-client'

export async function generateMetadata() {
  return { title: (await getT())('staff.therapist') }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>
}) {
  const { tenant, id } = await params
  const ctx = await requireMember(tenant)
  if (!can(ctx, 'staff.view') || !UUID.test(id)) notFound()
  const { t, fmt } = await getI18n()
  const slug = ctx.tenant.slug
  const manage = can(ctx, 'staff.manage')
  const now = new Date()

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [person] = await tx.select().from(staff).where(eq(staff.id, id))
    if (!person) return null
    return {
      person,
      skills: await tx
        .select({ serviceId: staffServices.serviceId })
        .from(staffServices)
        .where(eq(staffServices.staffId, id)),
      branches: await tx
        .select({ id: branches.id, name: branches.name, cutoff: branches.businessDayCutoff })
        .from(branches)
        .orderBy(desc(branches.isDefault), asc(branches.createdAt)),
      upcoming: await tx
        .select({
          id: shifts.id,
          branchId: shifts.branchId,
          startsAt: shifts.startsAt,
          endsAt: shifts.endsAt,
        })
        .from(shifts)
        .where(
          and(
            eq(shifts.staffId, id),
            gt(shifts.endsAt, now),
            lt(shifts.startsAt, new Date(now.getTime() + 14 * 86_400_000)),
          ),
        )
        .orderBy(asc(shifts.startsAt)),
      linked: person.memberId
        ? (
            await tx.select({ userId: members.userId }).from(members).where(eq(members.id, person.memberId))
          )[0]
        : undefined,
    }
  })
  if (!data) notFound()
  const { person } = data
  const [serviceList, memberList, linkedUser] = await Promise.all([
    serviceOptions(ctx.tenant.id),
    manage ? memberOptions(ctx.tenant.id) : Promise.resolve([]),
    data.linked
      ? platformDb()
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, data.linked.userId))
          .then((r) => r[0])
      : Promise.resolve(undefined),
  ])
  const skillIds = new Set(data.skills.map((s) => s.serviceId))
  const skillNames = serviceList.filter((s) => skillIds.has(s.id))
  const branchName = new Map(data.branches.map((b) => [b.id, b.name]))
  const cutoff = (data.branches[0]?.cutoff ?? '05:00').slice(0, 5)
  const today = businessDateOf(now, cutoff)

  // Pre-fill the pattern from the coming week's shifts, if any.
  const initial: Record<string, { start: string; end: string }> = {}
  for (const s of data.upcoming) {
    const wd = dubaiParts(s.startsAt).weekday
    initial[wd] ??= { start: dubaiTime(s.startsAt), end: dubaiTime(s.endsAt) }
  }

  const details: [string, React.ReactNode][] = [
    [t('staff.detail.gender'), person.gender ? enumLabel(t, 'staffGender', person.gender) : '—'],
    [t('staff.detail.mobile'), person.phoneE164 ? `+${person.phoneE164}` : '—'],
    [t('staff.detail.commission'), `${fmt.number(Number(person.commissionPct))}%`],
    [t('staff.detail.baseSalary'), fmt.aed(person.baseSalaryAed)],
    [t('staff.detail.login'), linkedUser?.name ?? t('staff.detail.notLinked')],
  ]

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={appPath(`/${slug}/staff`)}
            className="inline-flex items-center gap-1 transition-colors hover:text-fg"
          >
            <ArrowLeft className="size-3.5 rtl:-scale-x-100" /> {t('staff.title')}
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <Avatar name={person.displayName} src={person.photoUrl} size="lg" />
            {person.displayName}
          </span>
        }
        actions={
          manage ? (
            <StaffSheet
              slug={slug}
              members={memberList}
              services={serviceList}
              person={{
                id: person.id,
                displayName: person.displayName,
                gender: person.gender,
                phoneE164: person.phoneE164,
                color: person.color,
                bookable: person.bookable,
                active: person.active,
                commissionPct: Number(person.commissionPct),
                baseSalaryAed: Number(person.baseSalaryAed),
                memberId: person.memberId,
                skills: [...skillIds],
                photoUrl: person.photoUrl,
              }}
            />
          ) : null
        }
      />
      <PageBody>
        <Grid cols="col-2b">
          <Stack>
            <Card
              title={t('staff.detail.profile')}
              actions={
                !person.active ? (
                  <Pill>{t('staff.status.archived')}</Pill>
                ) : person.bookable ? (
                  <Pill tone="ok">{t('staff.status.bookable')}</Pill>
                ) : (
                  <Pill tone="warn">{t('staff.status.notBookable')}</Pill>
                )
              }
            >
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                {details.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="crm-muted">{k}</dt>
                    <dd className="crm-num text-end">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card
              title={t('staff.detail.skills')}
              sub={t('staff.detail.skillsOf', { count: skillNames.length, total: serviceList.length })}
            >
              <div className="flex flex-wrap gap-1.5">
                {skillNames.length === 0 ? (
                  <p className="crm-muted text-sm">{t('staff.detail.noSkills')}</p>
                ) : (
                  skillNames.map((s) => <Pill key={s.id}>{s.name}</Pill>)
                )}
              </div>
            </Card>
          </Stack>

          <Stack>
            {manage && (
              <Card title={t('staff.detail.weekly')} sub={t('staff.detail.weeklyHint')}>
                <PatternForm
                  slug={slug}
                  staffId={person.id}
                  branches={data.branches.map((b) => ({ id: b.id, name: b.name }))}
                  from={today}
                  to={addDays(today, 27)}
                  initial={initial}
                />
              </Card>
            )}
            <Card title={t('staff.detail.upcoming')} sub={t('staff.detail.next14')} flush>
              {data.upcoming.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays className="size-5" strokeWidth={1.5} />}
                  title={t('staff.detail.noShifts')}
                  description={manage ? t('staff.detail.noShiftsManage') : t('staff.detail.noShiftsView')}
                />
              ) : (
                <ul className="divide-y" aria-label={t('staff.detail.upcoming')}>
                  {data.upcoming.map((s) => {
                    const date = businessDateOf(s.startsAt, cutoff)
                    const overnight = dubaiParts(s.endsAt).date !== dubaiParts(s.startsAt).date
                    const day = fmt.weekdayDate(s.startsAt)
                    const times = `${dubaiTime(s.startsAt)}–${dubaiTime(s.endsAt)}`
                    return (
                      <li key={s.id} className="anim-fade-in flex items-center gap-4 px-5 py-3 sm:px-6">
                        <div className="w-28 shrink-0 text-sm font-medium">
                          {day}
                          {date === today && (
                            <span className="ms-2 text-xs font-normal text-accent">{t('common.today')}</span>
                          )}
                        </div>
                        <div className="crm-num min-w-0 flex-1 text-sm">
                          {times}
                          {overnight && (
                            <span className="crm-muted ms-1.5 text-xs">{t('staff.detail.plusDay')}</span>
                          )}
                          {data.branches.length > 1 && (
                            <span className="crm-muted block truncate text-xs">
                              {branchName.get(s.branchId)}
                            </span>
                          )}
                        </div>
                        {manage && <DeleteShiftButton slug={slug} shiftId={s.id} label={`${day} ${times}`} />}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          </Stack>
        </Grid>
      </PageBody>
    </>
  )
}
