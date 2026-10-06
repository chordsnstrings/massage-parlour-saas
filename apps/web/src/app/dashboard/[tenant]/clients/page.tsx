import { bookings, clients, withTenant } from '@spa/db'
import { and, arrayContains, asc, eq, ilike, or, type SQL, sql } from 'drizzle-orm'
import { ClipboardList, Contact, SearchX } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatPhone } from '@/components/calendar/time'
import { maskClientPhone } from '@/components/clients/shared'
import { StatStrip } from '@/components/clients/stat-strip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { cn, formatDate, initials } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { ClientSearch, NewClientSheet } from './clients-client'

export const metadata: Metadata = { title: 'Clients' }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const LIMIT = 200

export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'clients.view')) notFound()
  const slug = ctx.tenant.slug
  const sp = await searchParams
  const q = (one(sp.q) ?? '').trim().slice(0, 60)
  const tag = (one(sp.tag) ?? '').trim().toLowerCase().slice(0, 40)
  const seePhone = can(ctx, 'clients.phone')

  const filters: SQL[] = []
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const digits = q.replace(/\D/g, '').replace(/^0+/, '')
    filters.push(
      seePhone && digits.length >= 3
        ? or(ilike(clients.name, like), ilike(clients.phoneE164, `%${digits}%`))!
        : ilike(clients.name, like),
    )
  }
  if (tag) filters.push(arrayContains(clients.tags, [tag]))

  const { rows, tags, totals } = await withTenant(ctx.tenant.id, async (tx) => {
    const visits = tx
      .select({
        clientId: bookings.clientId,
        visits: sql<number>`count(*) filter (where ${bookings.status} = 'completed')::int`.as('visits'),
      })
      .from(bookings)
      .groupBy(bookings.clientId)
      .as('v')
    const rows = await tx
      .select({
        id: clients.id,
        name: clients.name,
        phone: clients.phoneE164,
        tags: clients.tags,
        blocklisted: clients.blocklisted,
        noShows: clients.noShowCount,
        lastVisitAt: clients.lastVisitAt,
        language: clients.language,
        visits: sql<number>`coalesce(${visits.visits}, 0)`,
      })
      .from(clients)
      .leftJoin(visits, eq(visits.clientId, clients.id))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(sql`${clients.lastVisitAt} desc nulls last`, asc(clients.name))
      .limit(LIMIT)
    const tags = await tx
      .selectDistinct({ tag: sql<string>`unnest(${clients.tags})`.as('tag') })
      .from(clients)
      .orderBy(asc(sql`tag`))
      .limit(30)
    const [totals] = await tx
      .select({
        all: sql<number>`count(*)::int`,
        blocked: sql<number>`count(*) filter (where ${clients.blocklisted})::int`,
        recent: sql<number>`count(*) filter (where ${clients.lastVisitAt} > now() - interval '30 days')::int`,
      })
      .from(clients)
    return { rows, tags: tags.map((t) => t.tag), totals: totals! }
  })

  const tagHref = (t: string | null) => {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (t) p.set('tag', t)
    const s = p.toString()
    return appPath(`/${slug}/clients${s ? `?${s}` : ''}`)
  }
  const profile = (id: string) => appPath(`/${slug}/clients/${id}`)
  const filtered = Boolean(q || tag)

  return (
    <>
      <PageHeader
        title="Clients"
        description="Everyone who has booked or walked in — preferences, visits and signed intake forms."
        actions={
          <>
            {can(ctx, 'settings.manage') && (
              <Button variant="secondary" asChild>
                <Link href={appPath(`/${slug}/settings/intake`)}>
                  <ClipboardList /> Intake form
                </Link>
              </Button>
            )}
            {can(ctx, 'clients.manage') && <NewClientSheet slug={slug} />}
          </>
        }
      />
      <PageBody>
        <StatStrip
          stats={[
            { label: 'Clients', value: totals.all },
            { label: 'Active 30 days', value: totals.recent },
            { label: 'Blocklisted', value: totals.blocked },
          ]}
        />
        <Card>
          <CardHeader
            title={filtered ? 'Results' : 'All clients'}
            description={
              rows.length === LIMIT
                ? `Showing the first ${LIMIT}. Search to narrow down.`
                : `${rows.length} shown`
            }
            action={
              <ClientSearch initial={q} placeholder={seePhone ? 'Search name or phone' : 'Search name'} />
            }
            className="sm:items-center"
          />
          {tags.length > 0 && (
            <nav aria-label="Filter by tag" className="flex flex-wrap gap-2 px-5 pt-4 sm:px-6">
              <TagChip href={tagHref(null)} active={!tag}>
                All
              </TagChip>
              {tags.map((t) => (
                <TagChip key={t} href={tagHref(t === tag ? null : t)} active={t === tag}>
                  {t}
                </TagChip>
              ))}
            </nav>
          )}
          <div className="mt-4 border-t">
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              empty={
                filtered ? (
                  <EmptyState
                    icon={<SearchX className="size-5" />}
                    title="No matching clients"
                    description="Try another name or number."
                  />
                ) : (
                  <EmptyState
                    icon={<Contact className="size-5" />}
                    title="No clients yet"
                    description="Clients appear here when they book online, message you or walk in."
                  />
                )
              }
              columns={[
                {
                  key: 'name',
                  header: 'Client',
                  primary: true,
                  cell: (r) => (
                    <Link href={profile(r.id)} className="group flex min-h-11 items-center gap-3">
                      <span
                        className={cn(
                          'grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold transition-transform duration-200 group-hover:scale-105',
                          r.blocklisted ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent',
                        )}
                      >
                        {initials(r.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium group-hover:text-accent">{r.name}</span>
                          {r.blocklisted && <Badge tone="danger">Blocklisted</Badge>}
                        </span>
                        <span className="block truncate text-xs text-muted tabular-nums">
                          {r.phone
                            ? seePhone
                              ? formatPhone(r.phone)
                              : maskClientPhone(r.phone)
                            : 'No phone'}
                        </span>
                      </span>
                    </Link>
                  ),
                },
                {
                  key: 'tags',
                  header: 'Tags',
                  hideOnMobile: true,
                  cell: (r) =>
                    r.tags.length ? (
                      <span className="flex flex-wrap gap-1">
                        {r.tags.slice(0, 3).map((t) => (
                          <Badge key={t}>{t}</Badge>
                        ))}
                        {r.tags.length > 3 && <Badge>+{r.tags.length - 3}</Badge>}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    ),
                },
                {
                  key: 'visits',
                  header: 'Visits',
                  className: 'tabular-nums',
                  cell: (r) => r.visits,
                },
                {
                  key: 'last',
                  header: 'Last visit',
                  cell: (r) => (
                    <span className="text-muted">{r.lastVisitAt ? formatDate(r.lastVisitAt) : 'Never'}</span>
                  ),
                },
                {
                  key: 'noshow',
                  header: 'No-shows',
                  className: 'tabular-nums',
                  cell: (r) =>
                    r.noShows > 0 ? (
                      <Badge tone="warning">{r.noShows}</Badge>
                    ) : (
                      <span className="text-muted">0</span>
                    ),
                },
              ]}
            />
          </div>
        </Card>
      </PageBody>
    </>
  )
}

function TagChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'inline-flex h-8 items-center rounded-full border px-3 text-[13px] transition-colors',
        active ? 'border-accent bg-accent-soft text-accent' : 'text-muted hover:border-fg/20 hover:text-fg',
      )}
    >
      {children}
    </Link>
  )
}
