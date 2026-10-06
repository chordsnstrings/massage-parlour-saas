import { addDays, businessDateOf } from '@spa/core'
import {
  bookings,
  branches,
  members,
  pageVersions,
  services,
  staff,
  subscriptions,
  withTenant,
} from '@spa/db'
import { type AgendaItem, kpis, peakHours, revenueSeries, upcomingItems } from '@spa/services'
import { and, count, eq } from 'drizzle-orm'
import { ArrowUpRight, CalendarDays, Check, Circle, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { PeriodSwitch } from '@/components/kpis/period-switch'
import { Sparkline } from '@/components/kpis/sparkline'
import { AgendaList, MetricStrip, PeakHeatmap, RankedList } from '@/components/kpis/widgets'
import { Badge, statusTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { appPath, tenantSiteUrl } from '@/lib/paths'
import { formatAed, formatDate } from '@/lib/utils'
import { can, type MemberContext, requireMember } from '@/server/access'

const PERIODS = {
  today: { label: 'Today', days: 1 },
  '7d': { label: '7 days', days: 7 },
  '30d': { label: '30 days', days: 30 },
} as const
type PeriodKey = keyof typeof PERIODS

const SOURCE_LABELS: Record<string, string> = {
  walk_in: 'Walk-in',
  online: 'Online',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  phone: 'Phone',
  ai_agent: 'AI agent',
  gbp: 'Google Business',
}

function greeting() {
  const h = Number(
    new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Dubai' }),
  )
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const pct = (v: number | null) => (v === null ? 0 : Math.round(v * 100))

export default async function TenantHome({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ period?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'dashboard.view')) return <TherapistHome ctx={ctx} />

  const { period: periodParam } = await searchParams
  const period: PeriodKey =
    periodParam && Object.hasOwn(PERIODS, periodParam) ? (periodParam as PeriodKey) : 'today'
  const { tenant } = ctx
  const showRevenue = can(ctx, 'dashboard.revenue')
  // Members scoped to specific branches see their first branch; everyone else sees the whole spa.
  const branchId = ctx.member && !ctx.member.allBranches ? ctx.member.branchIds[0] : undefined
  const now = new Date()

  const data = await withTenant(tenant.id, async (tx) => {
    const [branch] = await tx
      .select()
      .from(branches)
      .where(branchId ? eq(branches.id, branchId) : eq(branches.isDefault, true))
      .limit(1)
    const cutoff = branch?.businessDayCutoff.slice(0, 5) ?? '05:00'
    const to = businessDateOf(now, cutoff)
    const from = addDays(to, 1 - PERIODS[period].days)
    const [team] = await tx.select({ n: count() }).from(members)
    const [sub] = await tx.select().from(subscriptions).limit(1)
    const [svc] = await tx.select({ n: count() }).from(services)
    const [people] = await tx.select({ n: count() }).from(staff)
    const [published] = await tx
      .select({ n: count() })
      .from(pageVersions)
      .where(eq(pageVersions.status, 'published'))
    const [booked] = await tx.select({ n: count() }).from(bookings)
    const k = await kpis(tx, { branchId, from, to })
    // A single day can't draw a line, so "Today" shows the last week's trend.
    const series =
      period === 'today' ? await revenueSeries(tx, { branchId, from: addDays(to, -6), to }) : k.daily
    const heat = period === '30d' ? k : await peakHours(tx, { branchId, from: addDays(to, -29), to })
    const upNext = await upcomingItems(tx, { date: to, after: now, branchId, limit: 6 })
    return {
      branch,
      cutoff,
      teamSize: team?.n ?? 0,
      sub,
      services: svc?.n ?? 0,
      staff: people?.n ?? 0,
      published: (published?.n ?? 0) > 0,
      bookings: booked?.n ?? 0,
      k,
      series,
      heat,
      upNext,
    }
  })

  const slug = tenant.slug
  const site = tenantSiteUrl(slug)
  const steps = [
    {
      done: Boolean(data.branch?.whatsappE164 && data.branch.address),
      label: 'Add your address and WhatsApp number',
      href: appPath(`/${slug}/settings`),
      show: can(ctx, 'settings.manage'),
    },
    {
      done: data.services > 0,
      label: 'Add services, rooms and prices',
      href: appPath(`/${slug}/services`),
      show: can(ctx, 'services.manage'),
    },
    {
      done: data.staff > 0,
      label: 'Add therapists and their shifts',
      href: appPath(`/${slug}/staff`),
      show: can(ctx, 'staff.manage'),
    },
    {
      done: data.teamSize > 1,
      label: 'Invite your team',
      href: appPath(`/${slug}/team`),
      show: can(ctx, 'team.manage'),
    },
    {
      done: data.published,
      label: 'Design and publish your website',
      href: appPath(`/${slug}/website`),
      show: can(ctx, 'site.design') || can(ctx, 'site.publish'),
    },
    {
      done: data.bookings > 0,
      label: 'Take your first booking',
      href: appPath(`/${slug}/calendar`),
      show: can(ctx, 'calendar.manage'),
    },
  ].filter((s) => s.show)
  const doneCount = steps.filter((s) => s.done).length
  const setupDone = doneCount === steps.length

  const { k } = data
  const periodLabel = period === 'today' ? 'today' : `over the last ${PERIODS[period].days} days`
  const live = k.bookings - (k.byStatus.cancelled ?? 0)
  const periodHref = (key: PeriodKey) => appPath(key === 'today' ? `/${slug}` : `/${slug}?period=${key}`)
  const cutoffHour = Number(data.cutoff.slice(0, 2))

  const checklist = (
    <Card className="h-full">
      <CardHeader
        title="Get set up"
        description={`${doneCount} of ${steps.length} done`}
        action={
          <div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-700"
              style={{ width: `${(doneCount / Math.max(1, steps.length)) * 100}%` }}
            />
          </div>
        }
      />
      <CardBody className="pt-2 sm:pt-3">
        <ul className="divide-y">
          {steps.map((s) => {
            const row = (
              <span className="flex min-h-11 items-center gap-3 py-2.5">
                {s.done ? (
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
                    <Check className="size-3" strokeWidth={2.5} />
                  </span>
                ) : (
                  <Circle className="size-5 shrink-0 text-border" strokeWidth={1.5} />
                )}
                <span className={s.done ? 'text-muted line-through decoration-border' : ''}>{s.label}</span>
              </span>
            )
            return (
              <li key={s.label}>
                {s.done ? (
                  row
                ) : (
                  <Link href={s.href} className="block transition-colors hover:text-accent">
                    {row}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      </CardBody>
    </Card>
  )

  return (
    <>
      <PageHeader
        eyebrow={tenant.name}
        title={`${greeting()}, ${ctx.user.name.split(' ')[0]}`}
        description={`Here's how your spa is doing ${periodLabel}.`}
        actions={
          <>
            <PeriodSwitch
              current={period}
              options={(Object.keys(PERIODS) as PeriodKey[]).map((key) => ({
                key,
                label: PERIODS[key].label,
                href: periodHref(key),
              }))}
            />
            <Button variant="secondary" asChild className="hidden sm:inline-flex">
              <a href={site} target="_blank" rel="noreferrer">
                Website <ArrowUpRight />
              </a>
            </Button>
          </>
        }
      />
      <PageBody>
        {!setupDone && steps.length > 0 && checklist}

        <Stagger className="grid gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-4">
          {showRevenue ? (
            <>
              <StaggerItem>
                <StatCard
                  label="Revenue"
                  value={k.revenue}
                  format="aed"
                  hint={`${k.salesCount} paid sale${k.salesCount === 1 ? '' : 's'}`}
                />
              </StaggerItem>
              <StaggerItem>
                <StatCard label="Average ticket" value={k.averageTicket} format="aed" hint="Per paid sale" />
              </StaggerItem>
            </>
          ) : (
            <>
              <StaggerItem>
                <StatCard label="New clients" value={k.newClients} format="int" hint="First visit" />
              </StaggerItem>
              <StaggerItem>
                <StatCard
                  label="No-show rate"
                  value={pct(k.noShowRate)}
                  format="pct"
                  hint={`${k.byStatus.no_show ?? 0} no-show${k.byStatus.no_show === 1 ? '' : 's'}`}
                />
              </StaggerItem>
            </>
          )}
          <StaggerItem>
            <StatCard
              label="Bookings"
              value={live}
              format="int"
              hint={`${k.byStatus.completed ?? 0} completed · ${k.byStatus.cancelled ?? 0} cancelled`}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Utilisation"
              value={pct(k.utilisation)}
              format="pct"
              hint={
                k.shiftMinutes
                  ? `${Math.round(k.bookedMinutes / 60)} of ${Math.round(k.shiftMinutes / 60)} shift hours booked`
                  : 'No shifts scheduled'
              }
            />
          </StaggerItem>
        </Stagger>

        {showRevenue && (
          <MetricStrip
            items={[
              { label: 'Tips', value: k.tips, format: 'aed' },
              {
                label: 'Revenue / available hour',
                value: k.revenuePerAvailableHour ?? 0,
                format: 'aed',
                empty: k.revenuePerAvailableHour === null,
              },
              { label: 'New clients', value: k.newClients, format: 'int' },
              {
                label: 'No-show rate',
                value: pct(k.noShowRate),
                format: 'pct',
                empty: k.noShowRate === null,
              },
            ]}
          />
        )}

        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-8">
            <CardHeader
              title={showRevenue ? 'Revenue' : 'Bookings'}
              description={period === 'today' ? 'Last 7 days' : `Last ${PERIODS[period].days} days`}
              action={
                <p className="text-xl font-semibold tracking-tight tabular">
                  {showRevenue
                    ? formatAed(data.series.reduce((s, d) => s + d.revenue, 0))
                    : data.series.reduce((s, d) => s + d.bookings, 0).toLocaleString('en-AE')}
                </p>
              }
            />
            <CardBody>
              <Sparkline
                key={period}
                format={showRevenue ? 'aed' : 'int'}
                points={data.series.map((d) => ({
                  date: d.date,
                  value: showRevenue ? d.revenue : d.bookings,
                }))}
              />
            </CardBody>
          </Card>

          <Card className="lg:col-span-4">
            <CardHeader
              title="Up next"
              description="Rest of today"
              action={
                can(ctx, 'calendar.view') && (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={appPath(`/${slug}/calendar`)}>
                      Calendar <ArrowUpRight />
                    </Link>
                  </Button>
                )
              }
            />
            <CardBody>
              {data.upNext.length ? (
                <AgendaList items={data.upNext} />
              ) : (
                <EmptyState
                  icon={<CalendarDays className="size-5" />}
                  title="Nothing else today"
                  description="New bookings show up here as they come in."
                />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-12">
          <Card className="lg:col-span-4">
            <CardHeader title="Top services" description={showRevenue ? 'By revenue' : 'By sales'} />
            <CardBody>
              {k.topServices.length ? (
                <RankedList
                  money={showRevenue}
                  unit="sold"
                  rows={k.topServices.map((s) => ({
                    key: s.name,
                    label: s.name,
                    value: showRevenue ? s.revenue : s.count,
                  }))}
                />
              ) : (
                <Empty text="Paid sales will rank your services here." />
              )}
            </CardBody>
          </Card>
          <Card className="lg:col-span-4">
            <CardHeader title="Top therapists" description={showRevenue ? 'By revenue' : 'By services'} />
            <CardBody>
              {k.topTherapists.length ? (
                <RankedList
                  money={showRevenue}
                  unit="services"
                  rows={k.topTherapists.map((t) => ({
                    key: t.staffId,
                    label: t.name,
                    color: t.color,
                    value: showRevenue ? t.revenue : t.count,
                  }))}
                />
              ) : (
                <Empty text="Therapists rank here once their services are paid." />
              )}
            </CardBody>
          </Card>
          <Card className="md:col-span-2 lg:col-span-4">
            <CardHeader title="Booking sources" description="Where bookings came from" />
            <CardBody>
              {k.bySource.length ? (
                <RankedList
                  money={false}
                  rows={k.bySource.map((s) => ({
                    key: s.source,
                    label: SOURCE_LABELS[s.source] ?? s.source,
                    value: s.count,
                  }))}
                />
              ) : (
                <Empty text="No bookings in this period yet." />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-8">
            <CardHeader
              title="Peak hours"
              description={
                period === '30d' ? 'Bookings by day and hour' : 'Bookings by day and hour, last 30 days'
              }
            />
            <CardBody>
              <PeakHeatmap heatmap={data.heat.heatmap} cutoffHour={cutoffHour} />
            </CardBody>
          </Card>
          <div className="space-y-6 lg:col-span-4">
            <Card>
              <CardHeader title="Your website" />
              <CardBody className="space-y-3 pt-3 sm:pt-4">
                <p className="truncate rounded-lg bg-subtle px-3 py-2 font-mono text-[13px]">
                  {site.replace(/^https?:\/\//, '')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" asChild>
                    <a href={site} target="_blank" rel="noreferrer">
                      Open <ArrowUpRight />
                    </a>
                  </Button>
                  {(can(ctx, 'site.design') || can(ctx, 'site.content')) && (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={appPath(`/${slug}/website`)}>Edit</Link>
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
            {data.sub && can(ctx, 'billing.view') && (
              <Card>
                <CardHeader
                  title="Subscription"
                  action={<Badge tone={statusTone(data.sub.status)}>{data.sub.status}</Badge>}
                />
                <CardBody className="pt-3 text-sm text-muted sm:pt-4">
                  {data.sub.status === 'trialing' ? 'Trial ends' : 'Renews'} on{' '}
                  <span className="text-fg">{formatDate(data.sub.currentPeriodEnd)}</span>
                </CardBody>
              </Card>
            )}
          </div>
        </div>

        {setupDone && steps.length > 0 && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Sparkles className="size-4 text-accent" /> Setup complete — nice work.
          </p>
        )}
      </PageBody>
    </>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted">{text}</p>
}

/** Therapists (no dashboard access): their own agenda for today, nothing financial. */
async function TherapistHome({ ctx }: { ctx: MemberContext }) {
  const now = new Date()
  const memberId = ctx.member?.id
  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [me] = memberId
      ? await tx
          .select({ id: staff.id, branchIds: staff.branchIds })
          .from(staff)
          .where(and(eq(staff.memberId, memberId), eq(staff.active, true)))
          .limit(1)
      : []
    const [branch] = await tx.select().from(branches).where(eq(branches.isDefault, true)).limit(1)
    const date = businessDateOf(now, branch?.businessDayCutoff.slice(0, 5) ?? '05:00')
    const items: AgendaItem[] = me
      ? await upcomingItems(tx, { date, after: now, staffId: me.id, limit: 20 })
      : []
    return { linked: Boolean(me), items, date }
  })
  const next = data.items[0]

  return (
    <>
      <PageHeader
        eyebrow={ctx.tenant.name}
        title={`${greeting()}, ${ctx.user.name.split(' ')[0]}`}
        description={formatDate(`${data.date}T12:00:00+04:00`)}
        actions={
          can(ctx, 'calendar.view') && (
            <Button variant="secondary" asChild>
              <Link href={appPath(`/${ctx.tenant.slug}/calendar`)}>
                <CalendarDays /> Calendar
              </Link>
            </Button>
          )
        }
      />
      <PageBody>
        {!data.linked ? (
          <Card>
            <EmptyState
              icon={<CalendarDays className="size-5" />}
              title="Your schedule isn't linked yet"
              description="Ask your manager to link your team account to your therapist profile."
            />
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-12">
            {next && (
              <Card className="border-accent/40 bg-accent-soft/40 lg:col-span-5">
                <CardHeader title="Next client" />
                <CardBody className="space-y-1">
                  <p className="text-3xl font-semibold tracking-tight tabular">
                    {new Intl.DateTimeFormat('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Dubai',
                    }).format(next.startsAt)}
                  </p>
                  <p className="text-[15px]">
                    {next.clientName?.split(/\s+/)[0] ?? 'Walk-in'} · {next.serviceName}
                  </p>
                  <p className="text-sm text-muted">
                    {[`${next.durationMin} min`, next.roomName].filter(Boolean).join(' · ')}
                  </p>
                </CardBody>
              </Card>
            )}
            <Card className={next ? 'lg:col-span-7' : 'lg:col-span-12'}>
              <CardHeader title="Today" description={`${data.items.length} remaining`} />
              <CardBody>
                {data.items.length ? (
                  <AgendaList items={data.items} showTherapist={false} />
                ) : (
                  <EmptyState
                    icon={<CalendarDays className="size-5" />}
                    title="No more clients today"
                    description="Enjoy the break."
                  />
                )}
              </CardBody>
            </Card>
          </div>
        )}
      </PageBody>
    </>
  )
}
