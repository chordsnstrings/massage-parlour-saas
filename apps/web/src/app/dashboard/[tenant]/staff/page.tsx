import { businessDateOf, businessDayWindow } from '@spa/core'
import { branches, shifts, staff, staffServices, withTenant } from '@spa/db'
import { and, asc, count, desc, gt, lt } from 'drizzle-orm'
import { ChevronRight, UserRound } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { initials } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { dubaiTime, memberOptions, serviceOptions } from './data'
import { StaffSheet } from './staff-client'

export const metadata: Metadata = { title: 'Staff' }

const GENDER = { female: 'Female', male: 'Male', other: 'Other' } as const

export default async function StaffPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'staff.view')) notFound()
  const slug = ctx.tenant.slug
  const manage = can(ctx, 'staff.manage')

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [branch] = await tx
      .select({ cutoff: branches.businessDayCutoff })
      .from(branches)
      .orderBy(desc(branches.isDefault), asc(branches.createdAt))
      .limit(1)
    const cutoff = (branch?.cutoff ?? '05:00').slice(0, 5)
    const window = businessDayWindow(businessDateOf(new Date(), cutoff), cutoff)
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
    }
  })
  const [memberList, serviceList] = manage
    ? await Promise.all([memberOptions(ctx.tenant.id), serviceOptions(ctx.tenant.id)])
    : [[], []]
  const skills = new Map(data.skillCounts.map((s) => [s.staffId, s.n]))

  const addButton = manage ? <StaffSheet slug={slug} members={memberList} services={serviceList} /> : null

  return (
    <>
      <PageHeader
        title="Staff"
        description="Therapists, their skills and when they work."
        actions={addButton}
      />
      <PageBody>
        {data.people.length === 0 ? (
          <Card>
            <EmptyState
              icon={<UserRound className="size-5" strokeWidth={1.5} />}
              title="No therapists yet"
              description="Add the people who perform treatments. They don’t need a login."
              action={addButton}
            />
          </Card>
        ) : (
          <Stagger className="grid gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
            {data.people.map((p) => {
              const shift = data.today.find((s) => s.staffId === p.id)
              const n = skills.get(p.id) ?? 0
              return (
                <StaggerItem key={p.id}>
                  <Link
                    href={appPath(`/${slug}/staff/${p.id}`)}
                    className="group block h-full rounded-xl border bg-surface p-5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-fg/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/15 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-6"
                  >
                    <div className="flex items-start gap-4">
                      <span
                        className="grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
                        style={{ background: p.color }}
                        aria-hidden
                      >
                        {initials(p.displayName)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate font-medium">
                          {p.displayName}
                          <ChevronRight className="size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                        </p>
                        <p className="text-sm text-muted">
                          {p.gender ? GENDER[p.gender] : 'Gender not set'} · {n}{' '}
                          {n === 1 ? 'service' : 'services'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-sm">
                      {shift ? (
                        <span className="flex items-center gap-2">
                          <span className="size-1.5 rounded-full bg-accent" aria-hidden />
                          Today {dubaiTime(shift.startsAt)}–{dubaiTime(shift.endsAt)}
                        </span>
                      ) : (
                        <span className="text-muted">Off today</span>
                      )}
                      <span className="flex gap-1.5">
                        {!p.active ? (
                          <Badge>Archived</Badge>
                        ) : (
                          !p.bookable && <Badge tone="warning">Not bookable</Badge>
                        )}
                      </span>
                    </div>
                  </Link>
                </StaggerItem>
              )
            })}
          </Stagger>
        )}
      </PageBody>
    </>
  )
}
