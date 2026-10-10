import { platformDb } from '@spa/db'
import {
  billingRules,
  billingStageSummary,
  isTenantSort,
  type TenantSort,
  type TenantUsageRow,
  tenantUsageList,
} from '@spa/services'
import { ArrowDown, ArrowUp, Building2, Search } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, statusTone } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { adminPath } from '@/lib/paths'
import { cn, formatDate } from '@/lib/utils'

export const metadata: Metadata = { title: 'Spas' }

/** "3 h ago" / "5 d ago" / a date — the console list only needs a feel for recency. */
function ago(d: Date | null, now: number) {
  if (!d) return '—'
  const mins = Math.max(0, Math.round((now - d.getTime()) / 60_000))
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days < 60 ? `${days} d ago` : formatDate(d)
}

function bytes(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

const STAGE_LABEL = { overdue: 'overdue', grace: 'grace', read_only: 'read-only (billing)' } as const

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; dir?: string }>
}) {
  const sp = await searchParams
  const q = sp.q?.trim() ?? ''
  const sort: TenantSort = isTenantSort(sp.sort) ? sp.sort : 'joined'
  const dir = sp.dir === 'asc' || sp.dir === 'desc' ? sp.dir : undefined
  const db = platformDb()
  const [rows, rules] = await Promise.all([tenantUsageList(db, { q, sort, dir }), billingRules(db)])
  const now = Date.now()
  const activeDir = dir ?? (sort === 'name' || sort === 'status' || sort === 'plan' ? 'asc' : 'desc')

  /** Column header that sorts the list (server-side; second click flips the direction). */
  const sortable = (key: TenantSort, label: string, numeric = false) => {
    const on = sort === key
    const next = on ? (activeDir === 'asc' ? 'desc' : 'asc') : undefined
    const params = new URLSearchParams({ ...(q ? { q } : {}), sort: key, ...(next ? { dir: next } : {}) })
    const Icon = activeDir === 'asc' ? ArrowUp : ArrowDown
    return (
      <Link
        href={`${adminPath('/tenants')}?${params}`}
        className={cn(
          'inline-flex items-center gap-1 transition-colors hover:text-fg',
          on && 'text-fg',
          numeric && 'justify-end',
        )}
      >
        {label}
        {on && <Icon className="size-3" strokeWidth={2} />}
      </Link>
    )
  }
  const num = 'text-end tabular whitespace-nowrap'

  return (
    <>
      <PageHeader
        title="Spas"
        description="Subscriptions, usage and access for every tenant. Usage is whole-spa totals only — no client data."
      />
      <PageBody>
        <form className="relative max-w-sm">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            strokeWidth={1.5}
          />
          {sort !== 'joined' && <input type="hidden" name="sort" value={sort} />}
          {dir && <input type="hidden" name="dir" value={dir} />}
          <Input name="q" defaultValue={q} placeholder="Search by name or address" className="ps-9" />
        </form>
        <Card>
          <DataTable<TenantUsageRow>
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <EmptyState icon={<Building2 className="size-5" />} title={q ? 'No matches' : 'No spas yet'} />
            }
            columns={[
              {
                key: 'name',
                header: sortable('name', 'Spa'),
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
                header: sortable('status', 'Status'),
                cell: (r) => {
                  const stage = billingStageSummary(r, rules)
                  return (
                    <span className="flex flex-wrap gap-1">
                      {r.deletedAt ? (
                        <Badge tone="danger">deleted</Badge>
                      ) : (
                        <Badge tone={statusTone(r.status)}>
                          {r.status === 'read_only' ? 'paused' : r.status.replace('_', ' ')}
                        </Badge>
                      )}
                      {stage && !r.deletedAt && (
                        <Badge
                          tone={stage.stage === 'read_only' ? 'danger' : 'warning'}
                          title={
                            stage.stage === 'read_only'
                              ? 'Read-only until paid'
                              : `Read-only from ${formatDate(stage.readOnlyFrom)}`
                          }
                        >
                          {STAGE_LABEL[stage.stage]}
                        </Badge>
                      )}
                    </span>
                  )
                },
              },
              { key: 'plan', header: sortable('plan', 'Plan'), cell: (r) => r.plan ?? '—' },
              {
                key: 'signin',
                header: sortable('signin', 'Last staff sign-in'),
                className: 'whitespace-nowrap',
                cell: (r) => <span title={r.lastSignInAt?.toISOString()}>{ago(r.lastSignInAt, now)}</span>,
              },
              {
                key: 'booking',
                header: sortable('booking', 'Last booking'),
                className: 'whitespace-nowrap',
                cell: (r) => <span title={r.lastBookingAt?.toISOString()}>{ago(r.lastBookingAt, now)}</span>,
              },
              {
                key: 'bookings30',
                header: sortable('bookings30', 'Bookings 30 d', true),
                className: num,
                cell: (r) => r.bookings30d.toLocaleString('en-US'),
              },
              {
                key: 'members',
                header: sortable('members', 'Team', true),
                className: num,
                cell: (r) => r.activeMembers,
                hideOnMobile: true,
              },
              {
                key: 'storage',
                header: sortable('storage', 'Storage', true),
                className: num,
                cell: (r) => bytes(r.storageBytes),
                hideOnMobile: true,
              },
              {
                key: 'ai',
                header: sortable('ai', 'AI this month', true),
                className: num,
                cell: (r) => (
                  <span title={`Budget USD ${r.aiBudgetUsd}`}>
                    ${Number(r.aiSpendUsd).toFixed(2)}
                    <span className="text-muted"> / {Number(r.aiBudgetUsd).toFixed(0)}</span>
                  </span>
                ),
                hideOnMobile: true,
              },
              {
                key: 'joined',
                header: sortable('joined', 'Joined'),
                cell: (r) => <span className="whitespace-nowrap text-muted">{formatDate(r.createdAt)}</span>,
                hideOnMobile: true,
              },
            ]}
          />
        </Card>
        <p className="text-xs text-muted">
          Last staff sign-in = newest sign-in of an active team member. Bookings 30 d = bookings created in
          the last 30 days (any source). Storage = uploaded files. AI = this Dubai month&apos;s spend (USD) /
          budget.
        </p>
      </PageBody>
    </>
  )
}
