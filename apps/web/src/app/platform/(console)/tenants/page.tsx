import { plans, platformDb, subscriptions, tenants } from '@spa/db'
import { desc, eq, ilike, or } from 'drizzle-orm'
import { Building2, Search } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, statusTone } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { adminPath } from '@/lib/paths'
import { formatDate } from '@/lib/utils'

export const metadata: Metadata = { title: 'Spas' }

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q?.trim() ?? ''
  const rows = await platformDb()
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      deletedAt: tenants.deletedAt,
      plan: plans.name,
      periodEnd: subscriptions.currentPeriodEnd,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(q ? or(ilike(tenants.name, `%${q}%`), ilike(tenants.slug, `%${q}%`)) : undefined)
    .orderBy(desc(tenants.createdAt))
    .limit(200)
  return (
    <>
      <PageHeader title="Spas" description="Subscriptions, payments and access for every tenant." />
      <PageBody>
        <form className="relative max-w-sm">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            strokeWidth={1.5}
          />
          <Input name="q" defaultValue={q} placeholder="Search by name or address" className="ps-9" />
        </form>
        <Card>
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <EmptyState icon={<Building2 className="size-5" />} title={q ? 'No matches' : 'No spas yet'} />
            }
            columns={[
              {
                key: 'name',
                header: 'Spa',
                primary: true,
                cell: (r) => (
                  <Link href={adminPath(`/tenants/${r.id}`)} className="group">
                    <span className="block font-medium group-hover:text-accent">{r.name}</span>
                    <span className="block text-xs text-muted">{r.slug}</span>
                  </Link>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                cell: (r) =>
                  r.deletedAt ? (
                    <Badge tone="danger">deleted</Badge>
                  ) : (
                    <Badge tone={statusTone(r.status)}>
                      {r.status === 'read_only' ? 'paused' : r.status}
                    </Badge>
                  ),
              },
              { key: 'plan', header: 'Plan', cell: (r) => r.plan ?? '—' },
              {
                key: 'period',
                header: 'Period ends',
                cell: (r) => (r.periodEnd ? formatDate(r.periodEnd) : '—'),
              },
              {
                key: 'created',
                header: 'Joined',
                cell: (r) => <span className="text-muted">{formatDate(r.createdAt)}</span>,
                hideOnMobile: true,
              },
            ]}
          />
        </Card>
      </PageBody>
    </>
  )
}
