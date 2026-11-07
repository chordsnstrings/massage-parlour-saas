import { auditLog, platformDb, tenants, user } from '@spa/db'
import { desc, eq, ilike, or } from 'drizzle-orm'
import { Search } from 'lucide-react'
import type { Metadata } from 'next'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { formatDateTime } from '@/lib/utils'

export const metadata: Metadata = { title: 'Audit log' }

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q?.trim() ?? ''
  const rows = await platformDb()
    .select({
      id: auditLog.id,
      action: auditLog.action,
      createdAt: auditLog.createdAt,
      ip: auditLog.ip,
      tenant: tenants.slug,
      actor: user.email,
    })
    .from(auditLog)
    .leftJoin(tenants, eq(tenants.id, auditLog.tenantId))
    .leftJoin(user, eq(user.id, auditLog.actorUserId))
    .where(
      q
        ? or(ilike(auditLog.action, `%${q}%`), ilike(tenants.slug, `%${q}%`), ilike(user.email, `%${q}%`))
        : undefined,
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(200)
  return (
    <>
      <PageHeader title="Audit log" description="Every change across the platform, newest first." />
      <PageBody>
        <form className="relative max-w-sm">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            strokeWidth={1.5}
          />
          <Input name="q" defaultValue={q} placeholder="Filter by action, spa or email" className="ps-9" />
        </form>
        <Card>
          <DataTable
            rows={rows}
            rowKey={(r) => String(r.id)}
            empty={<p className="px-6 py-10 text-sm text-muted">No events.</p>}
            columns={[
              {
                key: 'action',
                header: 'Action',
                primary: true,
                cell: (r) => <span className="font-medium">{r.action}</span>,
              },
              { key: 'tenant', header: 'Spa', cell: (r) => r.tenant ?? 'platform' },
              { key: 'actor', header: 'By', cell: (r) => r.actor ?? '—' },
              {
                key: 'ip',
                header: 'IP',
                cell: (r) => <span className="text-muted">{r.ip ?? '—'}</span>,
                hideOnMobile: true,
              },
              {
                key: 'when',
                header: 'When',
                cell: (r) => <span className="text-muted">{formatDateTime(r.createdAt)}</span>,
              },
            ]}
          />
        </Card>
      </PageBody>
    </>
  )
}
