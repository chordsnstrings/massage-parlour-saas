import { plans, platformDb, spaApplications } from '@spa/db'
import { asc, eq, sql } from 'drizzle-orm'
import { Inbox } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, statusTone } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { adminPath } from '@/lib/paths'
import { cn, formatDate } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { emirateName } from '@/server/applications'

export const metadata: Metadata = { title: 'Applications' }

const FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Accepted' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
] as const
type Filter = (typeof FILTERS)[number]['key']

/** New spas apply; the owner accepts (provisions the spa + setup payment) or rejects (PLAN §18.3). */
export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await requirePlatformAdmin()
  const raw = (await searchParams).status
  const filter: Filter = FILTERS.some((f) => f.key === raw) ? (raw as Filter) : 'pending'
  const db = platformDb()
  const rows = await db
    .select({
      id: spaApplications.id,
      status: spaApplications.status,
      spaName: spaApplications.spaName,
      slug: spaApplications.slug,
      applicantName: spaApplications.applicantName,
      email: spaApplications.email,
      phone: spaApplications.phone,
      emirate: spaApplications.emirate,
      plan: plans.name,
      preferredStart: spaApplications.preferredStart,
      createdAt: spaApplications.createdAt,
    })
    .from(spaApplications)
    .leftJoin(plans, eq(plans.id, spaApplications.planId))
    .where(filter === 'all' ? undefined : eq(spaApplications.status, filter))
    // Pending first, oldest first: the longest-waiting applicant is at the top.
    .orderBy(sql`${spaApplications.status} = 'pending' desc`, asc(spaApplications.createdAt))
    .limit(300)
  const [counts] = await db
    .select({
      pending: sql<number>`count(*) filter (where status = 'pending')::int`,
      approved: sql<number>`count(*) filter (where status = 'approved')::int`,
      rejected: sql<number>`count(*) filter (where status = 'rejected')::int`,
      all: sql<number>`count(*)::int`,
    })
    .from(spaApplications)
  return (
    <>
      <PageHeader
        title="Applications"
        description="New spas apply here. Accept to create the spa and record the setup payment, or reject."
      />
      <PageBody>
        <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`${adminPath('/applications')}?status=${f.key}`}
              aria-current={f.key === filter ? 'page' : undefined}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors',
                f.key === filter ? 'border-fg bg-fg text-surface' : 'text-muted hover:text-fg',
              )}
            >
              {f.label} <span className="tabular opacity-70">{counts?.[f.key] ?? 0}</span>
            </Link>
          ))}
        </nav>
        <Card>
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                icon={<Inbox className="size-5" />}
                title={filter === 'pending' ? 'No applications waiting' : 'No applications'}
              />
            }
            columns={[
              {
                key: 'spa',
                header: 'Spa',
                primary: true,
                cell: (r) => (
                  <Link href={adminPath(`/applications/${r.id}`)} className="group">
                    <span className="block font-medium group-hover:text-accent">{r.spaName}</span>
                    <span className="text-sm text-muted">{r.slug}</span>
                  </Link>
                ),
              },
              {
                key: 'who',
                header: 'Applicant',
                cell: (r) => (
                  <span>
                    <span className="block">{r.applicantName}</span>
                    <span className="text-sm text-muted">{r.email}</span>
                  </span>
                ),
              },
              { key: 'phone', header: 'Mobile', cell: (r) => r.phone, hideOnMobile: true },
              { key: 'em', header: 'Emirate', cell: (r) => emirateName(r.emirate), hideOnMobile: true },
              { key: 'plan', header: 'Plan', cell: (r) => r.plan ?? '—', hideOnMobile: true },
              { key: 'start', header: 'Start', cell: (r) => formatDate(r.preferredStart) },
              { key: 'sent', header: 'Sent', cell: (r) => formatDate(r.createdAt) },
              {
                key: 'status',
                header: 'Status',
                className: 'text-end',
                cell: (r) => (
                  <Badge tone={statusTone(r.status)}>{r.status === 'approved' ? 'accepted' : r.status}</Badge>
                ),
              },
            ]}
          />
        </Card>
      </PageBody>
    </>
  )
}
