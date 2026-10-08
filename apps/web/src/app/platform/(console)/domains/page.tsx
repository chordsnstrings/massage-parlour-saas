import { domains, platformDb, tenants } from '@spa/db'
import { cloudflareConfig, cnameTarget, getBalance, listDomainOrders, namecheapConfig } from '@spa/services'
import { and, count, desc, eq, ilike, or } from 'drizzle-orm'
import { Cloud, CloudOff, Globe, Search, ShoppingBag } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/table'
import { adminPath } from '@/lib/paths'
import { cn, formatDateTime } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { DomainRowActions } from './domain-row-actions'
import { OrderActions } from './order-actions'

export const metadata: Metadata = { title: 'Domains' }

const STATUSES = ['pending', 'verifying', 'active', 'failed'] as const
type Status = (typeof STATUSES)[number]
const TONE = { pending: 'warning', verifying: 'accent', active: 'success', failed: 'danger' } as const
const ORDER_TONE = {
  requested: 'warning',
  purchasing: 'accent',
  purchased: 'success',
  failed: 'danger',
  rejected: 'neutral',
  cancelled: 'neutral',
} as const

/** Live Namecheap balance; null when not configured, 'error' when the API refuses (e.g. IP not whitelisted). */
async function registrarBalance() {
  const cfg = namecheapConfig()
  if (!cfg) return null
  try {
    return await getBalance(cfg)
  } catch {
    return 'error' as const
  }
}

export default async function PlatformDomainsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  await requirePlatformAdmin()
  const sp = await searchParams
  const q = sp.q?.trim() ?? ''
  const status = STATUSES.includes(sp.status as Status) ? (sp.status as Status) : null
  const db = platformDb()
  const [rows, totals] = await Promise.all([
    db
      .select({
        id: domains.id,
        hostname: domains.hostname,
        status: domains.status,
        isPrimary: domains.isPrimary,
        cfHostnameId: domains.cfHostnameId,
        sslStatus: domains.sslStatus,
        lastError: domains.lastError,
        checkedAt: domains.checkedAt,
        createdAt: domains.createdAt,
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
      })
      .from(domains)
      .innerJoin(tenants, eq(tenants.id, domains.tenantId))
      .where(
        and(
          eq(domains.kind, 'custom'),
          status ? eq(domains.status, status) : undefined,
          q
            ? or(
                ilike(domains.hostname, `%${q}%`),
                ilike(tenants.name, `%${q}%`),
                ilike(tenants.slug, `%${q}%`),
              )
            : undefined,
        ),
      )
      .orderBy(desc(domains.createdAt))
      .limit(300),
    db
      .select({ status: domains.status, n: count() })
      .from(domains)
      .where(eq(domains.kind, 'custom'))
      .groupBy(domains.status),
  ])
  const [orders, balance] = await Promise.all([listDomainOrders(30, db), registrarBalance()])
  const n = (s: Status) => totals.find((t) => t.status === s)?.n ?? 0
  const cf = cloudflareConfig()
  const filterHref = (s: Status | null) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (s) params.set('status', s)
    const qs = params.toString()
    return adminPath(`/domains${qs ? `?${qs}` : ''}`)
  }

  return (
    <>
      <PageHeader
        title="Domains"
        description="Custom domains across every spa: DNS verification, Cloudflare hostnames and certificates."
      />
      <PageBody>
        <div
          role="status"
          className={cn(
            'flex items-start gap-3 rounded-xl border px-5 py-4 text-sm',
            cf ? 'bg-surface' : 'border-warning/25 bg-warning-soft',
          )}
        >
          {cf ? (
            <Cloud className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.5} />
          ) : (
            <CloudOff className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.5} />
          )}
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">
              {cf ? 'Cloudflare for SaaS connected' : 'Cloudflare for SaaS is not configured yet'}
            </p>
            <p className="text-muted">
              {cf ? (
                <>
                  Zone …{cf.zoneId.slice(-6)} · customers CNAME to <span dir="ltr">{cnameTarget()}</span>
                </>
              ) : (
                <>
                  Domains are verified by DNS and point at <span dir="ltr">{cnameTarget()}</span>; the server
                  issues their certificates on the first visit. Set CF_API_TOKEN, CF_ZONE_ID and
                  CF_CNAME_TARGET to use Cloudflare instead.
                </>
              )}
            </p>
          </div>
        </div>

        <Card>
          <div className="flex flex-col gap-1 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="min-w-0">
              <h2 className="font-medium">Purchase requests</h2>
              <p className="text-sm text-muted">
                Spas ask; you approve; the domain is bought on Namecheap and connected.
              </p>
            </div>
            <p className="text-sm text-muted">
              {balance === null
                ? 'Namecheap not configured'
                : balance === 'error'
                  ? 'Namecheap unreachable — check the API whitelist'
                  : `Balance ${balance.currency} ${balance.availableUsd.toFixed(2)}`}
            </p>
          </div>
          <DataTable
            rows={orders}
            rowKey={(r) => r.order.id}
            empty={
              <EmptyState
                icon={<ShoppingBag className="size-5" />}
                title="No purchase requests"
                description="Spas request domains under Settings → Domains → Buy a domain."
              />
            }
            columns={[
              {
                key: 'domain',
                header: 'Domain',
                primary: true,
                cell: (r) => (
                  <div className="min-w-0">
                    <span dir="ltr" className="block break-all font-medium">
                      {r.order.domain}
                    </span>
                    <Link
                      href={adminPath(`/tenants/${r.order.tenantId}`)}
                      className="block text-xs text-muted hover:text-fg"
                    >
                      {r.spa} · <span className="whitespace-nowrap">{r.slug}</span>
                    </Link>
                  </div>
                ),
              },
              {
                key: 'price',
                header: 'Price',
                cell: (r) => (
                  <div className="min-w-0 whitespace-nowrap">
                    <span className="block">
                      USD {r.order.priceUsd}
                      {Number(r.order.markupUsd) > 0 && (
                        <span className="text-muted"> (incl. {r.order.markupUsd} markup)</span>
                      )}
                    </span>
                    <span className="block text-xs text-muted">
                      AED {r.order.priceAed} · {r.order.years}y{r.order.premium ? ' · premium' : ''}
                      {r.order.chargedUsd ? ` · charged ${r.order.chargedUsd}` : ''}
                    </span>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                className: 'max-w-xs',
                cell: (r) => (
                  <div className="min-w-0 space-y-0.5">
                    <Badge tone={ORDER_TONE[r.order.status]}>{r.order.status}</Badge>
                    <span className="block text-xs text-muted">
                      {formatDateTime(r.order.decidedAt ?? r.order.createdAt)}
                    </span>
                    {(r.order.error || r.order.note) && (
                      <span
                        title={r.order.error ?? r.order.note ?? ''}
                        className={cn(
                          'block text-xs md:line-clamp-2',
                          r.order.status === 'failed' ? 'text-danger' : 'text-muted',
                        )}
                      >
                        {r.order.error ?? r.order.note}
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                className: 'text-end',
                cell: (r) =>
                  r.order.status === 'requested' || r.order.status === 'failed' ? (
                    <OrderActions
                      id={r.order.id}
                      domain={r.order.domain}
                      spa={r.spa}
                      priceUsd={(Number(r.order.priceUsd) - Number(r.order.markupUsd)).toFixed(2)}
                      retry={r.order.status === 'failed'}
                    />
                  ) : null,
              },
            ]}
          />
        </Card>

        <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          <StatCard label="Active" value={n('active')} />
          <StatCard label="Pending" value={n('pending')} />
          <StatCard label="Verifying" value={n('verifying')} />
          <StatCard label="Failed" value={n('failed')} />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Filter by status" className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {[null, ...STATUSES].map((s) => (
              <Link
                key={s ?? 'all'}
                href={filterHref(s)}
                className={cn(
                  'inline-flex h-11 shrink-0 items-center rounded-full px-4 text-sm capitalize transition-colors sm:h-9',
                  s === status
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-muted hover:bg-subtle hover:text-fg',
                )}
              >
                {s ?? 'All'}
              </Link>
            ))}
          </nav>
          <form className="relative w-full sm:max-w-xs">
            {status && <input type="hidden" name="status" value={status} />}
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              strokeWidth={1.5}
            />
            <Input
              name="q"
              defaultValue={q}
              placeholder="Search domain or spa"
              className="h-11 ps-9 sm:h-10"
            />
          </form>
        </div>

        <Card>
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                icon={<Globe className="size-5" />}
                title={q || status ? 'No matching domains' : 'No custom domains yet'}
                description="Spas connect their own domain under Settings → Domains."
              />
            }
            columns={[
              {
                key: 'domain',
                header: 'Domain',
                primary: true,
                cell: (r) => (
                  <div className="min-w-0">
                    <a
                      href={`https://${r.hostname}`}
                      target="_blank"
                      rel="noreferrer"
                      dir="ltr"
                      className="block break-all font-medium hover:text-accent"
                    >
                      {r.hostname}
                    </a>
                    <Link
                      href={adminPath(`/tenants/${r.tenantId}`)}
                      className="block text-xs text-muted hover:text-fg"
                    >
                      {r.tenantName} · <span className="whitespace-nowrap">{r.tenantSlug}</span>
                    </Link>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                cell: (r) => (
                  <span className="inline-flex flex-wrap items-center justify-end gap-1.5 md:flex-nowrap md:justify-start">
                    <Badge tone={TONE[r.status]}>{r.status}</Badge>
                    {r.isPrimary && <Badge>primary</Badge>}
                  </span>
                ),
              },
              {
                key: 'check',
                header: <span className="whitespace-nowrap">Last check</span>,
                className: 'max-w-xs',
                cell: (r) => (
                  <div className="min-w-0 space-y-0.5">
                    <span className="block whitespace-nowrap">
                      {r.checkedAt ? formatDateTime(r.checkedAt) : 'Never'}
                    </span>
                    {r.lastError && (
                      <span
                        title={r.lastError}
                        className={cn(
                          'block text-xs md:line-clamp-2',
                          r.status === 'failed' ? 'text-danger' : 'text-muted',
                        )}
                      >
                        {r.lastError}
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: 'cf',
                header: 'Cloudflare',
                cell: (r) =>
                  r.cfHostnameId ? (
                    <div className="min-w-0">
                      <span dir="ltr" title={r.cfHostnameId} className="block font-mono text-xs">
                        {r.cfHostnameId.slice(0, 8)}…
                      </span>
                      <span className="block text-xs text-muted">
                        SSL {r.sslStatus?.replaceAll('_', ' ') ?? '—'}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted">—</span>
                  ),
              },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                className: 'text-end',
                cell: (r) => <DomainRowActions id={r.id} hostname={r.hostname} status={r.status} />,
              },
            ]}
          />
        </Card>
      </PageBody>
    </>
  )
}
