import {
  platformDb,
  platformInvoices,
  platformJobRuns,
  platformPayments,
  subscriptions,
  tenants,
} from '@spa/db'
import { aiUsageOverview } from '@spa/services'
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import Link from 'next/link'
import { Badge, statusTone } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { ActionForm, SubmitButton } from '@/components/ui/form'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/table'
import { adminPath } from '@/lib/paths'
import { formatAed, formatDate, todayDubai } from '@/lib/utils'
import { pauseTenantAction } from './actions'

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
    .where(isNull(tenants.deletedAt))
  const [arr] = await db
    .select({
      arr: sql<string>`coalesce(sum(price_aed) filter (where status = 'active'), 0)`,
      overdue: sql<number>`count(*) filter (where status in ('active', 'past_due') and current_period_end < ${today})::int`,
    })
    .from(subscriptions)
  const [collected] = await db
    .select({ total: sql<string>`coalesce(sum(amount_aed), 0)` })
    .from(platformPayments)
    .where(gte(platformPayments.receivedAt, monthStart))
  const recent = await db
    .select()
    .from(tenants)
    .where(isNull(tenants.deletedAt))
    .orderBy(desc(tenants.createdAt))
    .limit(8)
  // Spas with overdue platform invoices (R12): pause here, remind from the spa's page.
  const late = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      status: tenants.status,
      count: sql<number>`count(*)::int`,
      total: sql<string>`sum(${platformInvoices.totalAed})`,
      oldest: sql<string>`min(${platformInvoices.dueDate})`,
    })
    .from(platformInvoices)
    .innerJoin(tenants, eq(tenants.id, platformInvoices.tenantId))
    .where(
      and(
        eq(platformInvoices.status, 'issued'),
        lt(platformInvoices.dueDate, today),
        isNull(tenants.deletedAt),
      ),
    )
    .groupBy(tenants.id)
    .orderBy(sql`min(${platformInvoices.dueDate})`)
  // Monthly restore drill (worker `restore-drill`, PLAN §3.5): latest outcome; stale after 35 days.
  const [drill] = await db
    .select()
    .from(platformJobRuns)
    .where(eq(platformJobRuns.job, 'restore-drill'))
    .orderBy(desc(platformJobRuns.finishedAt))
    .limit(1)
  const drillStale = !drill || Date.now() - drill.finishedAt.getTime() > 35 * 86_400_000
  // Nightly off-site backup (worker `db-backup`, G1): latest run + latest success; warn past 36 h.
  const [lastBackup] = await db
    .select()
    .from(platformJobRuns)
    .where(eq(platformJobRuns.job, 'db-backup'))
    .orderBy(desc(platformJobRuns.finishedAt))
    .limit(1)
  const [okBackup] = await db
    .select({ finishedAt: platformJobRuns.finishedAt, details: platformJobRuns.details })
    .from(platformJobRuns)
    .where(and(eq(platformJobRuns.job, 'db-backup'), eq(platformJobRuns.status, 'ok')))
    .orderBy(desc(platformJobRuns.finishedAt))
    .limit(1)
  const backupStale = !okBackup || Date.now() - okBackup.finishedAt.getTime() > 36 * 3_600_000
  // G18: spas at ≥ 80 % of their monthly AI budget (budget 0 = AI deliberately off, not flagged).
  const aiFlags = (await aiUsageOverview(db)).filter((r) => r.budgetUsd > 0 && r.level !== 'ok')

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
            <StatCard
              label="Overdue"
              value={late.length}
              hint={`Spas with invoices past due · ${arr?.overdue ?? 0} periods ended`}
            />
          </StaggerItem>
        </Stagger>
        <Card data-testid="offsite-backup">
          <CardHeader
            title="Off-site backup"
            description={`${
              okBackup
                ? `Last successful backup ${formatDate(okBackup.finishedAt.toISOString().slice(0, 10))}`
                : 'No successful off-site backup yet'
            }${
              lastBackup && lastBackup.status !== 'ok'
                ? ` · last run ${lastBackup.status}: ${
                    lastBackup.status === 'skipped'
                      ? 'no off-site bucket configured (set R2_* or S3_* for the worker)'
                      : String(lastBackup.details.error ?? 'failed')
                  }`
                : ''
            }${backupStale ? ' — the database is not safely backed up off the server.' : ''}`}
            action={
              <Badge tone={backupStale ? 'danger' : 'success'}>
                {backupStale ? (okBackup ? 'overdue' : 'missing') : 'ok'}
              </Badge>
            }
          />
        </Card>
        <Card data-testid="ai-budget-flags">
          <CardHeader
            title="AI budgets"
            description={
              aiFlags.length
                ? aiFlags
                    .map(
                      (r) =>
                        `${r.name} ${Math.round(r.ratio * 100)}%${r.level === 'over' ? ' (paused)' : ''}`,
                    )
                    .join(' · ')
                : 'Every spa is under 80 % of its monthly AI budget.'
            }
            action={
              <Link href={adminPath('/ai/usage')}>
                <Badge
                  tone={
                    aiFlags.some((r) => r.level === 'over')
                      ? 'danger'
                      : aiFlags.length
                        ? 'warning'
                        : 'success'
                  }
                >
                  {aiFlags.length ? `${aiFlags.length} at ≥ 80 %` : 'ok'}
                </Badge>
              </Link>
            }
          />
        </Card>
        <Card data-testid="restore-drill">
          <CardHeader
            title="Backup restore drill"
            description={
              drill
                ? `Last run ${formatDate(drill.finishedAt.toISOString().slice(0, 10))}${
                    drill.status === 'ok'
                      ? ` · ${String(drill.details.key ?? '')} restored · ${Object.entries(
                          (drill.details.counts as Record<string, number> | undefined) ?? {},
                        )
                          .map(([k, v]) => `${k} ${v}`)
                          .join(', ')}`
                      : drill.status === 'skipped'
                        ? ' · skipped: R2 backups are not configured'
                        : ` · ${String(drill.details.error ?? 'failed')}`
                  }`
                : 'No drill has run yet — the worker restores the latest R2 backup on the 2nd of each month.'
            }
            action={
              <Badge
                tone={
                  drill?.status === 'ok' && !drillStale
                    ? 'success'
                    : drill?.status === 'failed'
                      ? 'danger'
                      : 'warning'
                }
              >
                {drill ? (drillStale ? `${drill.status} · overdue` : drill.status) : 'never run'}
              </Badge>
            }
          />
        </Card>
        {late.length > 0 && (
          <Card>
            <CardHeader
              title="Payments overdue"
              description="Remind the spa from its page, or pause it until it pays."
            />
            <div className="mt-4 border-t">
              <DataTable
                rows={late}
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
                  { key: 'n', header: 'Invoices', cell: (r) => r.count },
                  { key: 'since', header: 'Oldest due', cell: (r) => formatDate(r.oldest) },
                  {
                    key: 'total',
                    header: 'Amount',
                    className: 'text-end',
                    cell: (r) => <span className="tabular">{formatAed(r.total)}</span>,
                  },
                  {
                    key: 'act',
                    header: <span className="sr-only">Actions</span>,
                    className: 'text-end',
                    cell: (r) =>
                      r.status === 'read_only' ? (
                        <Badge tone="warning">paused</Badge>
                      ) : (
                        <ActionForm action={pauseTenantAction.bind(null, r.id, true)}>
                          <SubmitButton size="sm" variant="secondary">
                            Pause
                          </SubmitButton>
                        </ActionForm>
                      ),
                  },
                ]}
              />
            </div>
          </Card>
        )}
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
