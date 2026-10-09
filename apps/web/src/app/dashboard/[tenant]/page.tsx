import { addDays, businessDateOf, weekStartOf } from '@spa/core'
import { enumLabel } from '@spa/core/i18n'
import {
  bookings,
  branches,
  clients,
  members,
  outbox,
  pageVersions,
  services,
  staff,
  subscriptions,
  withTenant,
} from '@spa/db'
import {
  type AgendaItem,
  campaignConsentWithdrawn,
  kpis,
  outboxBookingLive,
  peakHours,
  revenueSeries,
  staffEarnings,
  upcomingItems,
} from '@spa/services'
import { and, count, eq, inArray, isNull, lte, not, or } from 'drizzle-orm'
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Circle,
  Coins,
  Gauge,
  MessageSquare,
  Sparkles,
  Users,
  UserX,
} from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Card,
  CHART_COLOURS,
  type Dir,
  Grid,
  Kpi,
  Legend,
  Meter,
  Pill,
  Seg,
  SegBar,
  Stack,
  Stat,
  statusTone,
} from '@/components/crm'
import { InsightsCard } from '@/components/kpis/insights-card'
import { Sparkline } from '@/components/kpis/sparkline'
import { AgendaList, PeakHeatmap, RankedList, UpNextTable } from '@/components/kpis/widgets'
import { InstallTip } from '@/components/pwa/install-app'
import { Button } from '@/components/ui/button'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, type MemberContext, requireMember } from '@/server/access'
import { pwaFor } from '@/server/pwa'
import { publicSiteUrl } from '@/server/sites'
import { allowedBranches } from './calendar/data'

/** Matches no branch: a member scoped to branches that are all archived sees empty figures, not the whole spa. */
const NO_BRANCH = '00000000-0000-0000-0000-000000000000'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('overview.metaTitle') }
}

const PERIODS = {
  today: { key: 'overview.period.today', days: 1 },
  '7d': { key: 'overview.period.d7', days: 7 },
  '30d': { key: 'overview.period.d30', days: 30 },
} as const
type PeriodKey = keyof typeof PERIODS

type Delta = { text: string; dir: Dir } | undefined

export default async function TenantHome({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ period?: string; branch?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'dashboard.view')) return <TherapistHome ctx={ctx} />
  const { t, fmt } = await getI18n()

  const { period: periodParam, branch: branchParam } = await searchParams
  const period: PeriodKey =
    periodParam && Object.hasOwn(PERIODS, periodParam) ? (periodParam as PeriodKey) : 'today'
  const days = PERIODS[period].days
  const { tenant } = ctx
  const showRevenue = can(ctx, 'dashboard.revenue')
  const showClients = can(ctx, 'clients.view')
  const showMessages = can(ctx, 'marketing.send')
  // Branch picker (G22): members scoped to branches pick one of theirs (first by default); everyone else sees
  // the whole spa or picks a branch. A scoped member without an open branch sees nothing.
  const scoped = Boolean(ctx.member && !ctx.member.allBranches)
  const now = new Date()

  const data = await withTenant(tenant.id, async (tx) => {
    const allowed = await allowedBranches(tx, ctx)
    const picked = allowed.find((b) => b.id === branchParam) ?? (scoped ? allowed[0] : undefined)
    const branchId = picked?.id ?? (scoped ? NO_BRANCH : undefined)
    const branch =
      picked ??
      (await tx.select().from(branches).where(eq(branches.isDefault, true)).limit(1))[0] ??
      allowed[0]
    const cutoff = branch?.businessDayCutoff.slice(0, 5) ?? '05:00'
    const to = businessDateOf(now, cutoff)
    const from = addDays(to, 1 - days)
    const [team] = await tx.select({ n: count() }).from(members)
    const [sub] = await tx.select().from(subscriptions).limit(1)
    const [svc] = await tx.select({ n: count() }).from(services)
    const [people] = await tx.select({ n: count() }).from(staff)
    const [published] = await tx
      .select({ n: count() })
      .from(pageVersions)
      .where(eq(pageVersions.status, 'published'))
    const [booked] = await tx.select({ n: count() }).from(bookings)
    const [clientCount] = showClients ? await tx.select({ n: count() }).from(clients) : []
    // WhatsApp messages due now (same rule as the Messages page's "Due" tab).
    const [due] = showMessages
      ? await tx
          .select({ n: count() })
          .from(outbox)
          .where(
            and(
              branchId ? or(isNull(outbox.branchId), eq(outbox.branchId, branchId)) : undefined,
              inArray(outbox.status, ['queued', 'opened']),
              not(campaignConsentWithdrawn()),
              outboxBookingLive(),
              lte(outbox.dueAt, now),
            ),
          )
      : []
    const k = await kpis(tx, { branchId, from, to })
    // Same-length window just before, for the KPI deltas.
    const prev = await kpis(tx, { branchId, from: addDays(from, -days), to: addDays(from, -1) })
    // A single day can't draw a line, so "Today" shows the last week's trend.
    const series =
      period === 'today' ? await revenueSeries(tx, { branchId, from: addDays(to, -6), to }) : k.daily
    const heat = period === '30d' ? k : await peakHours(tx, { branchId, from: addDays(to, -29), to })
    const upToday = await upcomingItems(tx, { date: to, after: now, branchId, limit: 8 })
    const upTomorrow =
      upToday.length < 8
        ? await upcomingItems(tx, { date: addDays(to, 1), after: now, branchId, limit: 8 - upToday.length })
        : []
    return {
      branch,
      branchId: picked?.id,
      branchOptions: allowed.map((b) => ({ id: b.id, name: b.name })),
      cutoff,
      teamSize: team?.n ?? 0,
      sub,
      services: svc?.n ?? 0,
      staff: people?.n ?? 0,
      published: (published?.n ?? 0) > 0,
      bookings: booked?.n ?? 0,
      clients: clientCount?.n ?? 0,
      due: due?.n ?? 0,
      k,
      prev,
      series,
      heat,
      upNext: [...upToday, ...upTomorrow.map((i) => ({ ...i, tomorrow: true }))],
    }
  })

  const slug = tenant.slug
  const site = await publicSiteUrl(tenant)
  const steps = [
    {
      done: Boolean(data.branch?.whatsappE164 && data.branch.address),
      label: t('overview.setup.address'),
      href: appPath(`/${slug}/settings`),
      show: can(ctx, 'settings.manage'),
    },
    {
      done: data.services > 0,
      label: t('overview.setup.services'),
      href: appPath(`/${slug}/services`),
      show: can(ctx, 'services.manage'),
    },
    {
      done: data.staff > 0,
      label: t('overview.setup.staff'),
      href: appPath(`/${slug}/staff`),
      show: can(ctx, 'staff.manage'),
    },
    {
      done: data.teamSize > 1,
      label: t('overview.setup.team'),
      href: appPath(`/${slug}/team`),
      show: can(ctx, 'team.manage'),
    },
    {
      done: data.published,
      label: t('overview.setup.website'),
      href: appPath(`/${slug}/website`),
      show: can(ctx, 'site.design') || can(ctx, 'site.publish'),
    },
    {
      done: data.bookings > 0,
      label: t('overview.setup.booking'),
      href: appPath(`/${slug}/calendar`),
      show: can(ctx, 'calendar.manage'),
    },
  ].filter((s) => s.show)
  const doneCount = steps.filter((s) => s.done).length
  const setupDone = doneCount === steps.length

  const { k, prev } = data
  const live = k.bookings - (k.byStatus.cancelled ?? 0)
  const prevLive = prev.bookings - (prev.byStatus.cancelled ?? 0)
  const walkIns = k.bySource.find((s) => s.source === 'walk_in')?.count ?? 0
  const homeHref = (key: PeriodKey, branch = data.branchId) => {
    const q = new URLSearchParams()
    if (key !== 'today') q.set('period', key)
    if (branch) q.set('branch', branch)
    return appPath(q.size ? `/${slug}?${q}` : `/${slug}`)
  }
  const periodHref = (key: PeriodKey) => homeHref(key)
  const cutoffHour = Number(data.cutoff.slice(0, 2))
  const viewDetails = t('common.viewDetails')

  const signed = (n: number, text: string) => (n > 0 ? `+${text}` : n < 0 ? `−${text}` : text)
  const dirOf = (n: number): Dir => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat')
  const stable = { text: t('overview.kpi.stable'), dir: 'flat' as const }
  /** Relative change (revenue): +12% / −3%; nothing when the previous window had no data. */
  const relDelta = (cur: number, before: number): Delta => {
    if (!before) return undefined
    const r = (cur - before) / before
    return Math.abs(r) < 0.005 ? stable : { text: signed(r, fmt.percent(Math.abs(r))), dir: dirOf(r) }
  }
  /** Absolute change (counts): +3 / −1. */
  const absDelta = (cur: number, before: number): Delta => {
    const d = cur - before
    return d === 0 ? stable : { text: signed(d, fmt.number(Math.abs(d))), dir: dirOf(d) }
  }
  /** Percentage-point change (rates). */
  const ppDelta = (cur: number | null, before: number | null): Delta => {
    if (cur === null || before === null) return undefined
    const d = cur - before
    return Math.abs(d) < 0.005 ? stable : { text: signed(d, fmt.percent(Math.abs(d))), dir: dirOf(d) }
  }
  const pct = (v: number | null) => (v === null ? '—' : fmt.percent(v))
  const noShows = k.byStatus.no_show ?? 0

  const kpiRevenue = showRevenue ? (
    <Kpi
      icon={<Coins aria-hidden />}
      label={t('overview.kpi.revenue')}
      value={fmt.aed(k.revenue)}
      delta={relDelta(k.revenue, prev.revenue)}
      sub={t('overview.kpi.paidSales', { count: k.salesCount })}
      href={can(ctx, 'reports.view') ? appPath(`/${slug}/analytics`) : undefined}
      linkLabel={viewDetails}
    />
  ) : (
    <Kpi
      icon={<Users aria-hidden />}
      label={t('overview.kpi.newClients')}
      value={fmt.number(k.newClients)}
      delta={absDelta(k.newClients, prev.newClients)}
      sub={t('overview.kpi.firstVisit')}
    />
  )

  const sourceTotal = k.bySource.reduce((s, r) => s + r.count, 0)
  const sources = k.bySource.map((s, i) => ({
    label: enumLabel(t, 'bookingSource', s.source),
    count: s.count,
    color: CHART_COLOURS[i % CHART_COLOURS.length]!,
  }))

  const checklist = (
    <Card
      title={t('overview.setup.title')}
      sub={t('overview.setup.progress', { done: doneCount, total: steps.length })}
      actions={
        <Meter
          value={doneCount}
          max={Math.max(1, steps.length)}
          label={t('overview.setup.progressLabel')}
          className="w-28"
        />
      }
    >
      <ul className="divide-y">
        {steps.map((s) => {
          const row = (
            <span className="flex min-h-10 items-center gap-3 py-2">
              {s.done ? (
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
                  <Check className="size-3" strokeWidth={2.5} />
                </span>
              ) : (
                <Circle className="size-5 shrink-0 text-border" strokeWidth={1.5} />
              )}
              <span className={s.done ? 'crm-muted line-through decoration-border' : ''}>{s.label}</span>
            </span>
          )
          return (
            <li key={s.href}>
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
    </Card>
  )

  return (
    <>
      <PageHeader
        title={tenant.name}
        description={
          period === 'today' ? t('overview.description.today') : t('overview.description.period', { days })
        }
        actions={
          <>
            {data.branchOptions.length > 1 && (
              <Seg
                label={t('overview.branch.label')}
                value={data.branchId ?? 'all'}
                items={[
                  ...(scoped
                    ? []
                    : [{ value: 'all', label: t('overview.branch.all'), href: homeHref(period, '') }]),
                  ...data.branchOptions.map((b) => ({
                    value: b.id,
                    label: b.name,
                    href: homeHref(period, b.id),
                  })),
                ]}
              />
            )}
            <Seg
              label={t('overview.period.label')}
              value={period}
              items={(Object.keys(PERIODS) as PeriodKey[]).map((key) => ({
                value: key,
                label: t(PERIODS[key].key),
                href: periodHref(key),
              }))}
            />
            <Button variant="secondary" asChild className="hidden sm:inline-flex">
              <a href={site} target="_blank" rel="noreferrer">
                {t('overview.website')} <ArrowUpRight />
              </a>
            </Button>
          </>
        }
      />
      <PageBody>
        <Stack>
          {/* One-time install tip (PLAN §18.6) for the people who run the spa; everyone has it in the user menu. */}
          {(ctx.member?.roleKey === 'owner' || ctx.member?.roleKey === 'manager') && (
            <InstallTip app={pwaFor(tenant).name} slug={tenant.slug} />
          )}
          {!setupDone && steps.length > 0 && checklist}

          <Grid cols="kgrid">
            {kpiRevenue}
            <Kpi
              icon={<CalendarDays aria-hidden />}
              label={t('overview.kpi.bookings')}
              value={fmt.number(live)}
              delta={absDelta(live, prevLive)}
              sub={t('overview.kpi.bookingsSub', {
                walkIns: fmt.number(walkIns),
                cancelled: fmt.number(k.byStatus.cancelled ?? 0),
              })}
              href={can(ctx, 'calendar.view') ? appPath(`/${slug}/calendar`) : undefined}
              linkLabel={viewDetails}
            />
            <Kpi
              icon={<Gauge aria-hidden />}
              label={t('overview.kpi.occupancy')}
              value={pct(k.utilisation)}
              delta={ppDelta(k.utilisation, prev.utilisation)}
              sub={
                k.shiftMinutes
                  ? t('overview.kpi.shiftHours', {
                      booked: fmt.number(Math.round(k.bookedMinutes / 60)),
                      total: fmt.number(Math.round(k.shiftMinutes / 60)),
                    })
                  : t('overview.kpi.noShifts')
              }
            />
            {showClients && (
              <Kpi
                icon={<Users aria-hidden />}
                label={t('overview.kpi.clients')}
                value={fmt.number(data.clients)}
                delta={
                  k.newClients
                    ? { text: t('overview.kpi.newCount', { count: k.newClients }), dir: 'up' }
                    : undefined
                }
                sub={t('overview.kpi.clientsSub')}
                href={appPath(`/${slug}/clients`)}
                linkLabel={viewDetails}
              />
            )}
            {showMessages && (
              <Kpi
                icon={<MessageSquare aria-hidden />}
                label={t('overview.kpi.messages')}
                value={fmt.number(data.due)}
                sub={t('overview.kpi.messagesSub')}
                href={appPath(`/${slug}/messages`)}
                linkLabel={viewDetails}
              />
            )}
            {!showRevenue && (
              <Kpi
                icon={<UserX aria-hidden />}
                label={t('overview.kpi.noShowRate')}
                value={pct(k.noShowRate)}
                sub={t('overview.kpi.noShows', { count: noShows })}
              />
            )}
          </Grid>

          {showRevenue && (
            <Grid cols="g4">
              <Stat
                label={t('overview.metrics.averageTicket')}
                value={fmt.aed(k.averageTicket)}
                change={{ text: t('overview.metrics.perSale') }}
              />
              <Stat label={t('overview.metrics.tips')} value={fmt.aed(k.tips)} />
              <Stat
                label={t('overview.metrics.perHour')}
                value={k.revenuePerAvailableHour === null ? '—' : fmt.aed(k.revenuePerAvailableHour)}
                change={{ text: t('overview.metrics.perHourSub') }}
              />
              <Stat
                label={t('overview.kpi.noShowRate')}
                value={pct(k.noShowRate)}
                change={{ text: t('overview.kpi.noShows', { count: noShows }) }}
              />
            </Grid>
          )}

          <InsightsCard ctx={ctx} />

          <Grid cols="col-2">
            <Card
              title={showRevenue ? t('overview.chart.revenue') : t('overview.chart.bookings')}
              sub={t('overview.chart.lastDays', { days: period === 'today' ? 7 : days })}
              actions={
                <p className="text-xl font-semibold tracking-tight tabular">
                  {showRevenue
                    ? fmt.aed(data.series.reduce((s, d) => s + d.revenue, 0))
                    : fmt.number(data.series.reduce((s, d) => s + d.bookings, 0))}
                </p>
              }
            >
              <Sparkline
                key={period}
                format={showRevenue ? 'aed' : 'int'}
                label={showRevenue ? t('overview.chart.revenue') : t('overview.chart.bookings')}
                points={data.series.map((d) => ({
                  date: d.date,
                  value: showRevenue ? d.revenue : d.bookings,
                }))}
              />
            </Card>

            <Card title={t('overview.sources.title')} sub={t('overview.sources.sub')}>
              {sources.length ? (
                <div className="space-y-4">
                  <SegBar
                    label={t('overview.sources.barLabel')}
                    items={sources.map((s) => ({ value: s.count, color: s.color, title: s.label }))}
                  />
                  <Legend
                    items={sources.map((s) => ({
                      label: s.label,
                      color: s.color,
                      value: `${fmt.number(s.count)} · ${fmt.percent(s.count / Math.max(1, sourceTotal))}`,
                    }))}
                  />
                </div>
              ) : (
                <Empty text={t('overview.sources.empty')} />
              )}
            </Card>
          </Grid>

          <Card
            title={t('overview.upNext.title')}
            sub={t('overview.upNext.sub')}
            flush={data.upNext.length > 0}
            actions={
              can(ctx, 'calendar.view') && (
                <Button size="sm" asChild>
                  <Link href={appPath(`/${slug}/calendar`)}>{t('overview.upNext.openCalendar')}</Link>
                </Button>
              )
            }
          >
            {data.upNext.length ? (
              <UpNextTable items={data.upNext} />
            ) : (
              <EmptyState
                icon={<CalendarDays className="size-5" />}
                title={t('overview.upNext.emptyTitle')}
                description={t('overview.upNext.emptyText')}
              />
            )}
          </Card>

          <Grid cols="g3">
            <Card
              title={t('overview.top.services')}
              sub={showRevenue ? t('overview.top.byRevenue') : t('overview.top.bySales')}
            >
              {k.topServices.length ? (
                <RankedList
                  rows={k.topServices.map((s) => ({
                    key: s.name,
                    label: s.name,
                    value: showRevenue ? s.revenue : s.count,
                    display: showRevenue ? fmt.aed(s.revenue) : t('overview.top.sold', { count: s.count }),
                  }))}
                />
              ) : (
                <Empty text={t('overview.top.servicesEmpty')} />
              )}
            </Card>
            <Card
              title={t('overview.top.therapists')}
              sub={showRevenue ? t('overview.top.byRevenue') : t('overview.top.byServices')}
            >
              {k.topTherapists.length ? (
                <RankedList
                  rows={k.topTherapists.map((x) => ({
                    key: x.staffId,
                    label: x.name,
                    color: x.color,
                    value: showRevenue ? x.revenue : x.count,
                    display: showRevenue
                      ? fmt.aed(x.revenue)
                      : t('overview.top.servicesUnit', { count: x.count }),
                  }))}
                />
              ) : (
                <Empty text={t('overview.top.therapistsEmpty')} />
              )}
            </Card>
            <Stack>
              <Card title={t('overview.site.title')}>
                <div className="space-y-3">
                  <p className="truncate rounded-lg bg-subtle px-3 py-2 font-mono text-[13px]" dir="ltr">
                    {site.replace(/^https?:\/\//, '')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" asChild>
                      <a href={site} target="_blank" rel="noreferrer">
                        {t('overview.site.open')} <ArrowUpRight />
                      </a>
                    </Button>
                    {(can(ctx, 'site.design') || can(ctx, 'site.content')) && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={appPath(`/${slug}/website`)}>{t('overview.site.manage')}</Link>
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
              {data.sub && can(ctx, 'billing.view') && (
                <Card
                  title={t('overview.subscription.title')}
                  actions={
                    <Pill tone={statusTone(data.sub.status)}>
                      {enumLabel(t, 'subscriptionStatus', data.sub.status)}
                    </Pill>
                  }
                >
                  <p className="crm-muted text-sm">
                    {t(
                      data.sub.status === 'trialing'
                        ? 'overview.subscription.trialEnds'
                        : 'overview.subscription.renews',
                      { date: fmt.date(data.sub.currentPeriodEnd) },
                    )}
                  </p>
                </Card>
              )}
            </Stack>
          </Grid>

          <Card
            title={t('overview.peak.title')}
            sub={period === '30d' ? t('overview.peak.sub') : t('overview.peak.sub30')}
          >
            <PeakHeatmap heatmap={data.heat.heatmap} cutoffHour={cutoffHour} />
          </Card>

          {setupDone && steps.length > 0 && (
            <p className="crm-muted flex items-center gap-2 text-sm">
              <Sparkles className="size-4 text-accent" /> {t('overview.setup.complete')}
            </p>
          )}
        </Stack>
      </PageBody>
    </>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="crm-muted py-6 text-center text-sm">{text}</p>
}

/** Therapists (no dashboard access): their own agenda for today and their own earnings (G14) — no spa figures. */
async function TherapistHome({ ctx }: { ctx: MemberContext }) {
  const { t, fmt } = await getI18n()
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
    // Own commission + tips only (business dates: today, Mon-start week, calendar month to date).
    const earnings = me
      ? await staffEarnings(tx, me.id, {
          today: { from: date, to: date },
          week: { from: weekStartOf(date), to: date },
          month: { from: `${date.slice(0, 8)}01`, to: date },
        })
      : null
    return { linked: Boolean(me), items, date, earnings }
  })
  const next = data.items[0]

  return (
    <>
      <PageHeader
        title={ctx.tenant.name}
        description={fmt.date(`${data.date}T12:00:00+04:00`)}
        actions={
          can(ctx, 'calendar.view') && (
            <Button variant="secondary" asChild>
              <Link href={appPath(`/${ctx.tenant.slug}/calendar`)}>
                <CalendarDays /> {t('overview.therapist.calendar')}
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
              title={t('overview.therapist.notLinkedTitle')}
              description={t('overview.therapist.notLinkedText')}
            />
          </Card>
        ) : (
          <Grid cols={next ? 'col-2b' : undefined}>
            {next && (
              <Card title={t('overview.therapist.nextClient')} arch>
                <div className="space-y-1">
                  <p className="text-3xl font-semibold tracking-tight tabular">{fmt.time(next.startsAt)}</p>
                  <p className="text-[15px]">
                    {next.clientName?.split(/\s+/)[0] ?? t('overview.therapist.walkIn')} · {next.serviceName}
                  </p>
                  <p className="crm-muted text-sm">
                    {[t('overview.therapist.minutes', { min: next.durationMin }), next.roomName]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </Card>
            )}
            <Card
              title={t('overview.therapist.today')}
              sub={t('overview.therapist.remaining', { count: data.items.length })}
            >
              {data.items.length ? (
                <AgendaList items={data.items} />
              ) : (
                <EmptyState
                  icon={<CalendarDays className="size-5" />}
                  title={t('overview.therapist.emptyTitle')}
                  description={t('overview.therapist.emptyText')}
                />
              )}
            </Card>
          </Grid>
        )}
        {data.earnings && (
          <Card
            title={t('overview.therapist.earnings.title')}
            sub={t('overview.therapist.earnings.sub')}
            footer={<p className="crm-muted text-[13px]">{t('overview.therapist.earnings.note')}</p>}
          >
            <Grid cols="g3">
              {(['today', 'week', 'month'] as const).map((k) => {
                const e = data.earnings![k]
                return (
                  <Stat
                    key={k}
                    label={t(`overview.therapist.earnings.${k}`)}
                    value={fmt.aed(e.commissionAed + e.tipsAed)}
                    change={{
                      text: `${t('overview.therapist.earnings.commission')} ${fmt.aed(e.commissionAed)} · ${t('overview.therapist.earnings.tips')} ${fmt.aed(e.tipsAed)}`,
                    }}
                  />
                )
              })}
            </Grid>
          </Card>
        )}
        {data.linked && can(ctx, 'calendar.ownStatus') && (
          <p className="crm-muted text-sm">{t('overview.therapist.actions')}</p>
        )}
      </PageBody>
    </>
  )
}
