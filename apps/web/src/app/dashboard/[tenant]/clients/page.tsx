import { bookingItems, bookings, clientPackages, clients, withTenant } from '@spa/db'
import { and, arrayContains, asc, eq, gt, ilike, or, type SQL, sql } from 'drizzle-orm'
import { ClipboardList, Contact, EyeOff, SearchX } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatPhone } from '@/components/calendar/time'
import { maskClientPhone } from '@/components/clients/shared'
import { Card, Grid, Note, Pill, Stack, Stat, TName } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { ClientSearch, NewClientSheet } from './clients-client'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT()
  return { title: t('clients.title') }
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const LIMIT = 200
const DAY = 86_400_000

export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'clients.view')) notFound()
  const { t, fmt } = await getI18n()
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

  const { rows, tags, totals, pkgTotals } = await withTenant(ctx.tenant.id, async (tx) => {
    const visits = tx
      .select({
        clientId: bookings.clientId,
        visits: sql<number>`count(*) filter (where ${bookings.status} = 'completed')::int`.as('visits'),
      })
      .from(bookings)
      .groupBy(bookings.clientId)
      .as('v')
    const spend = tx
      .select({
        clientId: sql<string>`${bookings.clientId}`.as('spend_client'),
        spend: sql<string>`sum(${bookingItems.priceAed})`.as('spend'),
      })
      .from(bookings)
      .innerJoin(bookingItems, eq(bookingItems.bookingId, bookings.id))
      .where(eq(bookings.status, 'completed'))
      .groupBy(bookings.clientId)
      .as('s')
    const activePkg = and(eq(clientPackages.status, 'active'), gt(clientPackages.expiresAt, sql`now()`))
    const pkgs = tx
      .select({
        clientId: sql<string>`${clientPackages.clientId}`.as('pkg_client'),
        pkgCount: sql<number>`count(*)::int`.as('pkg_count'),
        pkgName: sql<string>`min(${clientPackages.name})`.as('pkg_name'),
      })
      .from(clientPackages)
      .where(activePkg)
      .groupBy(clientPackages.clientId)
      .as('p')
    const rows = await tx
      .select({
        id: clients.id,
        name: clients.name,
        phone: clients.phoneE164,
        tags: clients.tags,
        blocklisted: clients.blocklisted,
        noShows: clients.noShowCount,
        lastVisitAt: clients.lastVisitAt,
        createdAt: clients.createdAt,
        birthday: clients.birthday,
        visits: sql<number>`coalesce(${visits.visits}, 0)`,
        spend: sql<string>`coalesce(${spend.spend}, 0)`,
        pkgCount: sql<number>`coalesce(${pkgs.pkgCount}, 0)`,
        pkgName: pkgs.pkgName,
      })
      .from(clients)
      .leftJoin(visits, eq(visits.clientId, clients.id))
      .leftJoin(spend, eq(spend.clientId, clients.id))
      .leftJoin(pkgs, eq(pkgs.clientId, clients.id))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(sql`${clients.lastVisitAt} desc nulls last`, asc(clients.name))
      .limit(LIMIT)
    const tags = await tx
      .selectDistinct({ tag: sql<string>`unnest(${clients.tags})`.as('tag') })
      .from(clients)
      .orderBy(asc(sql`tag`))
      .limit(30)
    const dubaiNow = sql`(now() at time zone 'Asia/Dubai')`
    const [totals] = await tx
      .select({
        all: sql<number>`count(*)::int`,
        newMonth: sql<number>`count(*) filter (where ${clients.createdAt} >= (date_trunc('month', ${dubaiNow}) at time zone 'Asia/Dubai'))::int`,
        birthdays: sql<number>`count(*) filter (where extract(month from ${clients.birthday}) = extract(month from ${dubaiNow}))::int`,
        winBack: sql<number>`count(*) filter (where not ${clients.blocklisted} and ${clients.lastVisitAt} < now() - interval '60 days')::int`,
      })
      .from(clients)
    const [pkgTotals] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        balance: sql<string>`coalesce(sum(${clientPackages.remainingValueAed}), 0)`,
      })
      .from(clientPackages)
      .where(activePkg)
    return { rows, tags: tags.map((r) => r.tag), totals: totals!, pkgTotals: pkgTotals! }
  })

  const tagHref = (value: string | null) => {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (value) p.set('tag', value)
    const s = p.toString()
    return appPath(`/${slug}/clients${s ? `?${s}` : ''}`)
  }
  const profile = (id: string) => appPath(`/${slug}/clients/${id}`)
  const filtered = Boolean(q || tag)
  const now = Date.now()
  const col = {
    client: t('clients.col.client'),
    phone: t('clients.col.phone'),
    visits: t('clients.col.visits'),
    spend: t('clients.col.spend'),
    package: t('clients.col.package'),
    birthday: t('clients.col.birthday'),
    last: t('clients.col.lastVisit'),
  }

  return (
    <>
      <PageHeader
        title={t('clients.title')}
        description={t('clients.description')}
        actions={
          <>
            {can(ctx, 'settings.manage') && (
              <Button variant="secondary" asChild>
                <Link href={appPath(`/${slug}/settings/intake`)}>
                  <ClipboardList /> {t('clients.intakeForm')}
                </Link>
              </Button>
            )}
            {can(ctx, 'clients.manage') && <NewClientSheet slug={slug} />}
          </>
        }
      />
      <Stack>
        <Grid cols="g4">
          <Stat
            label={t('clients.stats.total')}
            value={fmt.number(totals.all)}
            change={
              totals.newMonth > 0
                ? {
                    text: t('clients.stats.newThisMonth', { count: fmt.number(totals.newMonth) }),
                    dir: 'up',
                  }
                : undefined
            }
          />
          <Stat
            label={t('clients.stats.activePackages')}
            value={fmt.number(pkgTotals.count)}
            change={{ text: t('clients.stats.packageBalance', { amount: fmt.aed(pkgTotals.balance) }) }}
          />
          <Stat
            label={t('clients.stats.birthdays')}
            value={fmt.number(totals.birthdays)}
            change={{ text: fmt.monthYear(now) }}
          />
          <Stat
            label={t('clients.stats.winBack')}
            value={fmt.number(totals.winBack)}
            change={{ text: t('clients.stats.winBackSub') }}
          />
        </Grid>
        <Note icon={<EyeOff aria-hidden strokeWidth={1.8} />}>{t('clients.phoneNote')}</Note>
        <Card
          flush
          title={filtered ? t('clients.list.results') : t('clients.list.all')}
          sub={
            rows.length === LIMIT
              ? t('clients.list.firstN', { count: fmt.number(LIMIT) })
              : t('clients.list.shown', { count: rows.length })
          }
          actions={
            <ClientSearch
              initial={q}
              placeholder={seePhone ? t('clients.search.namePhone') : t('clients.search.name')}
            />
          }
        >
          {tags.length > 0 && (
            <nav
              aria-label={t('clients.list.filterByTag')}
              className="flex flex-wrap gap-2 px-[var(--crm-pad-card)] pb-3"
            >
              <TagChip href={tagHref(null)} active={!tag}>
                {t('common.all')}
              </TagChip>
              {tags.map((x) => (
                <TagChip key={x} href={tagHref(x === tag ? null : x)} active={x === tag}>
                  {x}
                </TagChip>
              ))}
            </nav>
          )}
          {rows.length === 0 ? (
            filtered ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title={t('clients.list.noMatch')}
                description={t('clients.list.noMatchSub')}
              />
            ) : (
              <EmptyState
                icon={<Contact className="size-5" />}
                title={t('clients.list.none')}
                description={t('clients.list.noneSub')}
              />
            )
          ) : (
            <div className="crm-tbl-wrap px-[var(--crm-pad-card)] pb-2">
              <table className="crm-tbl" data-stack="true">
                <thead>
                  <tr>
                    <th>{col.client}</th>
                    <th>{col.phone}</th>
                    <th className="crm-num-c">{col.visits}</th>
                    <th className="crm-num-c">{col.spend}</th>
                    <th>{col.package}</th>
                    <th>{col.birthday}</th>
                    <th>{col.last}</th>
                    <th>
                      <span className="sr-only">{t('clients.col.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const lapsed = r.lastVisitAt && now - r.lastVisitAt.getTime() > 60 * DAY
                    const fresh = now - r.createdAt.getTime() < 30 * DAY
                    return (
                      <tr key={r.id}>
                        <td data-label={col.client}>
                          <Link href={profile(r.id)} className="group block min-w-0">
                            <TName
                              name={r.name}
                              sub={
                                <span className="mt-0.5 flex flex-wrap gap-1">
                                  {r.blocklisted && <Pill tone="bad">{t('clients.blocklisted')}</Pill>}
                                  {r.tags.slice(0, 2).map((x) => (
                                    <Pill key={x} tone={x === 'vip' ? 'acc' : 'neutral'}>
                                      {x}
                                    </Pill>
                                  ))}
                                  {r.tags.length > 2 && (
                                    <Pill>{t('clients.more', { count: r.tags.length - 2 })}</Pill>
                                  )}
                                  {lapsed && !r.blocklisted && (
                                    <Pill tone="warn">{t('clients.tagWinBack')}</Pill>
                                  )}
                                  {fresh && !lapsed && <Pill tone="info">{t('clients.tagNew')}</Pill>}
                                  {r.noShows > 0 && (
                                    <Pill tone="warn">{t('clients.noShows', { count: r.noShows })}</Pill>
                                  )}
                                </span>
                              }
                            />
                          </Link>
                        </td>
                        <td data-label={col.phone} className="crm-muted tabular-nums">
                          {r.phone
                            ? seePhone
                              ? formatPhone(r.phone)
                              : maskClientPhone(r.phone)
                            : t('clients.noPhone')}
                        </td>
                        <td data-label={col.visits} className="crm-num-c">
                          {fmt.number(r.visits)}
                        </td>
                        <td data-label={col.spend} className="crm-num-c font-semibold">
                          {fmt.aed(r.spend)}
                        </td>
                        <td data-label={col.package} className="crm-muted">
                          {r.pkgName
                            ? r.pkgCount > 1
                              ? `${r.pkgName} ${t('clients.more', { count: r.pkgCount - 1 })}`
                              : r.pkgName
                            : '—'}
                        </td>
                        <td data-label={col.birthday} className="crm-muted">
                          {r.birthday ? fmt.dateShort(r.birthday) : '—'}
                        </td>
                        <td data-label={col.last} className="crm-muted">
                          {r.lastVisitAt ? fmt.date(r.lastVisitAt) : t('clients.never')}
                        </td>
                        <td>
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={profile(r.id)} aria-label={`${t('common.view')} ${r.name}`}>
                              {t('common.view')}
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Stack>
    </>
  )
}

function TagChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'inline-flex h-8 items-center rounded-full border px-3 text-[length:var(--crm-fs-sub)] transition-colors',
        active ? 'border-accent bg-accent-soft text-accent' : 'text-muted hover:border-fg/20 hover:text-fg',
      )}
    >
      {children}
    </Link>
  )
}
