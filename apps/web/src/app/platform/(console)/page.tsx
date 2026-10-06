import { platformDb, platformPayments, subscriptions, tenants } from '@spa/db'
import { desc, gte, sql } from 'drizzle-orm'
import Link from 'next/link'
import { Badge, statusTone } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/table'
import { adminPath } from '@/lib/paths'
import { formatDate, todayDubai } from '@/lib/utils'

export default async function PlatformOverview() {
  const db = platformDb()
  const today = todayDubai()
  const monthStart = `${today.slice(0, 7)}-01`
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where status = 'active')::int`,
      trial: sql<number>`count(*) filter (where status = 'trial')::int`,
    })
    .from(tenants)
  const [arr] = await db
    .select({
      arr: sql<string>`coalesce(sum(case when billing_interval = 'month' then price_aed * 12 else price_aed end) filter (where status = 'active'), 0)`,
      overdue: sql<number>`count(*) filter (where status in ('active', 'past_due') and current_period_end < ${today})::int`,
    })
    .from(subscriptions)
  const [collected] = await db
    .select({ total: sql<string>`coalesce(sum(amount_aed), 0)` })
    .from(platformPayments)
    .where(gte(platformPayments.receivedAt, monthStart))
  const recent = await db.select().from(tenants).orderBy(desc(tenants.createdAt)).limit(8)

  return (
    <>
      <PageHeader title="Overview" description="Every spa on the platform at a glance." />
      <PageBody>
        <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StaggerItem>
            <StatCard
              label="Spas"
              value={counts?.total ?? 0}
              hint={`${counts?.active ?? 0} active · ${counts?.trial ?? 0} in trial`}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="ARR" value={Number(arr?.arr ?? 0)} format="aed" hint="Active subscriptions" />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Collected this month" value={Number(collected?.total ?? 0)} format="aed" />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Overdue" value={arr?.overdue ?? 0} hint="Period ended, not renewed" />
          </StaggerItem>
        </Stagger>
        <Card>
          <CardHeader
            title="Newest spas"
            action={
              <Link href={adminPath('/tenants')} className="text-sm text-muted hover:text-fg">
                View all
              </Link>
            }
          />
          <div className="mt-4 border-t">
            <DataTable
              rows={recent}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: 'name',
                  header: 'Spa',
                  primary: true,
                  cell: (r) => (
                    <Link href={adminPath(`/tenants/${r.id}`)} className="font-medium hover:text-accent">
                      {r.name}
                    </Link>
                  ),
                },
                { key: 'slug', header: 'Address', cell: (r) => <span className="text-muted">{r.slug}</span> },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
                },
                { key: 'created', header: 'Joined', cell: (r) => formatDate(r.createdAt) },
              ]}
            />
          </div>
        </Card>
      </PageBody>
    </>
  )
}
