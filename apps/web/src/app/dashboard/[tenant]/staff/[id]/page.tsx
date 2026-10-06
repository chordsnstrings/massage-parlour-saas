import { addDays, businessDateOf, dubaiParts } from '@spa/core'
import { branches, members, platformDb, shifts, staff, staffServices, user, withTenant } from '@spa/db'
import { and, asc, desc, eq, gt, lt } from 'drizzle-orm'
import { ArrowLeft, CalendarDays } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { formatAed, initials } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { dayLabel, dubaiTime, memberOptions, serviceOptions } from '../data'
import { DeleteShiftButton, PatternForm, StaffSheet } from '../staff-client'

export const metadata: Metadata = { title: 'Therapist' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GENDER = { female: 'Female', male: 'Male', other: 'Other' } as const

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>
}) {
  const { tenant, id } = await params
  const ctx = await requireMember(tenant)
  if (!can(ctx, 'staff.view') || !UUID.test(id)) notFound()
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
    ['Gender', person.gender ? GENDER[person.gender] : '—'],
    ['Mobile', person.phoneE164 ? `+${person.phoneE164}` : '—'],
    ['Commission', `${Number(person.commissionPct)}%`],
    ['Base salary', formatAed(person.baseSalaryAed)],
    ['Login', linkedUser?.name ?? 'Not linked'],
  ]

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={appPath(`/${slug}/staff`)}
            className="inline-flex items-center gap-1 transition-colors hover:text-fg"
          >
            <ArrowLeft className="size-3.5" /> Staff
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <span
              className="grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
              style={{ background: person.color }}
              aria-hidden
            >
              {initials(person.displayName)}
            </span>
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
              }}
            />
          ) : null
        }
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
          <div className="space-y-6 lg:col-span-4">
            <Card>
              <CardHeader
                title="Profile"
                action={
                  !person.active ? (
                    <Badge>Archived</Badge>
                  ) : person.bookable ? (
                    <Badge tone="success">Bookable</Badge>
                  ) : (
                    <Badge tone="warning">Not bookable</Badge>
                  )
                }
              />
              <CardBody>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                  {details.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted">{k}</dt>
                      <dd className="text-end tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="Skills"
                description={`${skillNames.length} of ${serviceList.length} services`}
              />
              <CardBody className="flex flex-wrap gap-1.5">
                {skillNames.length === 0 ? (
                  <p className="text-sm text-muted">No services assigned yet.</p>
                ) : (
                  skillNames.map((s) => <Badge key={s.id}>{s.name}</Badge>)
                )}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-6 lg:col-span-8">
            {manage && (
              <Card>
                <CardHeader
                  title="Weekly schedule"
                  description="Set a pattern and generate shifts for a date range. An end time before the start runs past midnight."
                />
                <CardBody>
                  <PatternForm
                    slug={slug}
                    staffId={person.id}
                    branches={data.branches.map((b) => ({ id: b.id, name: b.name }))}
                    from={today}
                    to={addDays(today, 27)}
                    initial={initial}
                  />
                </CardBody>
              </Card>
            )}
            <Card>
              <CardHeader title="Upcoming shifts" description="Next 14 days" />
              <div className="mt-4 border-t">
                {data.upcoming.length === 0 ? (
                  <EmptyState
                    icon={<CalendarDays className="size-5" strokeWidth={1.5} />}
                    title="No shifts scheduled"
                    description={
                      manage
                        ? 'Generate shifts from the weekly schedule above.'
                        : 'A manager hasn’t scheduled shifts yet.'
                    }
                  />
                ) : (
                  <ul className="divide-y" aria-label="Upcoming shifts">
                    {data.upcoming.map((s) => {
                      const date = businessDateOf(s.startsAt, cutoff)
                      const overnight = dubaiParts(s.endsAt).date !== dubaiParts(s.startsAt).date
                      const label = `${dayLabel(dubaiParts(s.startsAt).date)} ${dubaiTime(s.startsAt)}–${dubaiTime(s.endsAt)}`
                      return (
                        <li key={s.id} className="anim-fade-in flex items-center gap-4 px-5 py-3 sm:px-6">
                          <div className="w-24 shrink-0 text-sm font-medium">
                            {dayLabel(dubaiParts(s.startsAt).date)}
                            {date === today && (
                              <span className="ms-2 text-xs font-normal text-accent">Today</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1 text-sm tabular-nums">
                            {dubaiTime(s.startsAt)}–{dubaiTime(s.endsAt)}
                            {overnight && <span className="ms-1.5 text-xs text-muted">+1 day</span>}
                            {data.branches.length > 1 && (
                              <span className="block truncate text-xs text-muted">
                                {branchName.get(s.branchId)}
                              </span>
                            )}
                          </div>
                          {manage && <DeleteShiftButton slug={slug} shiftId={s.id} label={label} />}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  )
}
