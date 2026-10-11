import type { Translator } from '@spa/core/i18n'
import { campaigns, segments, withTenant } from '@spa/db'
import { campaignResults, resolveSegment } from '@spa/services'
import { desc, isNotNull, isNull } from 'drizzle-orm'
import { Archive, CalendarCheck, Clock, Megaphone, Plus, Send, Sparkles, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  campaignState,
  describeRule,
  presetDescription,
  presetName,
  SEGMENT_PRESETS,
} from '@/components/campaigns/rules'
import { Card, Grid, Kpi, Meter, Pill, Seg } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { type Column, DataTable } from '@/components/ui/table'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { serviceOptions } from './data'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('campaigns.title') }
}

const TABS = [
  { key: 'campaigns', icon: Megaphone },
  { key: 'segments', icon: Users },
  { key: 'archived', icon: Archive },
] as const
type Tab = (typeof TABS)[number]['key']

const ratio = (n: number, of: number) => (of > 0 ? n / of : 0)

function Presets({ base, t }: { base: string; t: Translator }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {SEGMENT_PRESETS.map((p) => (
        <Link
          key={p.key}
          href={`${base}/segments/new?preset=${p.slug}`}
          title={presetDescription(t, p)}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--crm-line2)] bg-[var(--crm-surface)] px-4 text-[length:var(--crm-fs-note)] transition-[background-color,border-color,transform] duration-150 hover:-translate-y-px hover:border-[var(--crm-accent)] hover:bg-[var(--crm-info-bg)]"
        >
          <Sparkles className="size-3.5 text-[var(--crm-accent)]" strokeWidth={1.75} />
          {presetName(t, p)}
        </Link>
      ))}
    </div>
  )
}

export default async function CampaignsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'marketing.campaigns')) notFound()
  const tabParam = (await searchParams).tab
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : 'campaigns'
  const slug = ctx.tenant.slug
  const base = appPath(`/${slug}/campaigns`)
  const now = new Date()
  const { t, fmt } = await getI18n()

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const segRows = await tx.select().from(segments).orderBy(desc(segments.createdAt))
    const list =
      tab === 'segments'
        ? []
        : await tx
            .select()
            .from(campaigns)
            .where(tab === 'archived' ? isNotNull(campaigns.archivedAt) : isNull(campaigns.archivedAt))
            .orderBy(desc(campaigns.createdAt))
            .limit(200)
    const results = await campaignResults(
      tx,
      list.map((c) => c.id),
    )
    const sizes: number[] = []
    if (tab === 'segments')
      for (const s of segRows) sizes.push((await resolveSegment(tx, ctx.tenant.id, s.rules, now)).length)
    return {
      segments: segRows,
      list,
      results,
      sizes,
      services: tab === 'segments' ? await serviceOptions(tx) : [],
    }
  })
  const segName = new Map(data.segments.map((s) => [s.id, s.name]))
  const serviceName = (id: string) => data.services.find((s) => s.id === id)?.name
  const totals = [...data.results.values()].reduce(
    (t, r) => ({
      pending: t.pending + r.pending,
      sent: t.sent + r.sent,
      reached: t.reached + r.reached,
      booked: t.booked + r.bookedClients,
    }),
    { pending: 0, sent: 0, reached: 0, booked: 0 },
  )
  type Row = (typeof data.list)[number]
  const result = (c: Row) => data.results.get(c.id)!

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: t('campaigns.list.campaign'),
      primary: true,
      cell: (c) => (
        <div className="min-w-0">
          <Link href={`${base}/${c.id}`} className="font-semibold hover:underline">
            {c.name}
          </Link>
          <p className="crm-muted truncate text-[length:var(--crm-fs-sub)]">
            {c.segmentId
              ? (segName.get(c.segmentId) ?? t('campaigns.segmentFallback'))
              : t('campaigns.segmentDeleted')}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('campaigns.list.status'),
      cell: (c) => {
        const s = campaignState(c, result(c).pending, now)
        return (
          <Pill tone={s.tone} dot>
            {t(s.key)}
          </Pill>
        )
      },
    },
    {
      key: 'when',
      header: t('campaigns.list.sendTime'),
      hideOnMobile: true,
      cell: (c) => (c.scheduledAt ? fmt.dateTime(c.scheduledAt) : '—'),
    },
    {
      key: 'recipients',
      header: t('campaigns.list.recipients'),
      className: 'text-end tabular-nums',
      cell: (c) => (c.status === 'draft' ? '—' : fmt.number(c.recipients)),
    },
    {
      key: 'sent',
      header: t('campaigns.list.sent'),
      className: 'text-end tabular-nums',
      cell: (c) => {
        const r = result(c)
        if (!r.total) return '—'
        const text = t('campaigns.list.progress', { sent: fmt.number(r.sent), total: fmt.number(r.total) })
        return (
          <span className="inline-flex items-center gap-2.5">
            <Meter
              value={r.sent}
              max={r.total}
              label={t('campaigns.list.sent')}
              valueText={text}
              className="hidden w-14 lg:block"
            />
            {text}
          </span>
        )
      },
    },
    {
      key: 'booked',
      header: t('campaigns.list.booked'),
      className: 'text-end tabular-nums',
      cell: (c) => {
        const r = result(c)
        if (!r.reached) return '—'
        return (
          <span>
            {fmt.number(r.bookedClients)}
            <span className="crm-muted ms-1.5 text-[length:var(--crm-fs-sub)]">
              {fmt.percent(ratio(r.bookedClients, r.reached))}
            </span>
          </span>
        )
      },
    },
  ]

  const tabLabel = {
    campaigns: t('campaigns.tabs.campaigns'),
    segments: t('campaigns.tabs.segments'),
    archived: t('campaigns.tabs.archived'),
  }

  return (
    <>
      <PageHeader
        eyebrow={t('campaigns.eyebrow')}
        title={t('campaigns.title')}
        description={t('campaigns.description')}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href={`${base}/segments/new`}>
                <Users /> {t('campaigns.newSegment')}
              </Link>
            </Button>
            <Button asChild>
              <Link href={`${base}/new`}>
                <Plus /> {t('campaigns.newCampaign')}
              </Link>
            </Button>
          </>
        }
      />
      <PageBody>
        <Seg
          label={t('campaigns.tabs.label')}
          value={tab}
          className="self-start"
          items={TABS.map((x) => ({
            value: x.key,
            href: `${base}?tab=${x.key}`,
            label: (
              <>
                <x.icon className="hidden size-3.5 sm:block" strokeWidth={1.5} aria-hidden />
                {tabLabel[x.key]}
                {x.key === 'segments' && data.segments.length > 0 && (
                  <span className="crm-num opacity-70">{fmt.number(data.segments.length)}</span>
                )}
              </>
            ),
          }))}
        />

        {tab === 'campaigns' && data.list.length > 0 && (
          <Grid cols="g3">
            <Kpi
              label={t('campaigns.stats.waiting')}
              icon={<Clock />}
              value={fmt.number(totals.pending)}
              sub={t('campaigns.stats.waitingHint')}
            />
            <Kpi
              label={t('campaigns.stats.sent')}
              icon={<Send />}
              value={fmt.number(totals.sent)}
              sub={t('campaigns.stats.sentHint')}
            />
            <Kpi
              label={t('campaigns.stats.booked')}
              icon={<CalendarCheck />}
              value={fmt.number(totals.booked)}
              sub={
                totals.reached
                  ? t('campaigns.stats.bookedHint', {
                      pct: fmt.percent(ratio(totals.booked, totals.reached)),
                    })
                  : t('campaigns.stats.notTracked')
              }
            />
          </Grid>
        )}

        {tab !== 'segments' && (
          <Card flush>
            <DataTable
              columns={columns}
              rows={data.list}
              rowKey={(c) => c.id}
              empty={
                tab === 'archived' ? (
                  <EmptyState
                    icon={<Archive className="size-5" strokeWidth={1.5} />}
                    title={t('campaigns.empty.archivedTitle')}
                    description={t('campaigns.empty.archivedBody')}
                  />
                ) : (
                  <EmptyState
                    icon={<Megaphone className="size-5" strokeWidth={1.5} />}
                    title={t('campaigns.empty.campaignsTitle')}
                    description={t('campaigns.empty.campaignsBody')}
                    action={<Presets base={base} t={t} />}
                  />
                )
              }
            />
          </Card>
        )}

        {tab === 'segments' &&
          (data.segments.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Users className="size-5" strokeWidth={1.5} />}
                title={t('campaigns.empty.segmentsTitle')}
                description={t('campaigns.empty.segmentsBody')}
                action={<Presets base={base} t={t} />}
              />
            </Card>
          ) : (
            <Stagger className="crm-grid crm-g3">
              {data.segments.map((s, i) => (
                <StaggerItem key={s.id}>
                  <Card className="flex h-full flex-col" title={s.name}>
                    <ul className="crm-muted space-y-1 text-[length:var(--crm-fs-note)]">
                      {s.rules.length ? (
                        s.rules.map((r) => (
                          <li key={JSON.stringify(r)}>{describeRule(t, fmt, r, serviceName)}</li>
                        ))
                      ) : (
                        <li>{t('campaigns.everyone')}</li>
                      )}
                    </ul>
                    <p className="mt-4 text-2xl font-semibold tracking-tight tabular-nums">
                      {fmt.number(data.sizes[i] ?? 0)}
                      <span className="crm-muted ms-1.5 text-[length:var(--crm-fs-note)] font-normal">
                        {t('campaigns.segments.clientsNow', { count: data.sizes[i] ?? 0 })}
                      </span>
                    </p>
                    <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-4">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`${base}/segments/${s.id}`}>{t('common.edit')}</Link>
                      </Button>
                      <Button variant="secondary" size="sm" asChild>
                        <Link href={`${base}/new?segment=${s.id}`}>
                          <Megaphone /> {t('campaigns.segments.writeCampaign')}
                        </Link>
                      </Button>
                    </div>
                  </Card>
                </StaggerItem>
              ))}
            </Stagger>
          ))}
      </PageBody>
    </>
  )
}
