import { campaigns, segments, withTenant } from '@spa/db'
import { campaignResults, resolveSegment } from '@spa/services'
import { desc, isNotNull, isNull } from 'drizzle-orm'
import { Archive, Megaphone, Plus, Sparkles, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { campaignState, describeRule, SEGMENT_PRESETS } from '@/components/campaigns/rules'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { type Column, DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { cn, formatDateTime } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { serviceOptions } from './data'

export const metadata: Metadata = { title: 'Campaigns' }

const TABS = [
  { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
  { key: 'segments', label: 'Segments', icon: Users },
  { key: 'archived', label: 'Archived', icon: Archive },
] as const
type Tab = (typeof TABS)[number]['key']

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

function Presets({ base }: { base: string }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {SEGMENT_PRESETS.map((p) => (
        <Link
          key={p.key}
          href={`${base}/segments/new?preset=${p.key}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-surface px-4 text-sm transition-[background-color,border-color,transform] duration-150 hover:-translate-y-px hover:border-accent/40 hover:bg-accent-soft"
        >
          <Sparkles className="size-3.5 text-accent" strokeWidth={1.75} />
          {p.name}
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
      header: 'Campaign',
      primary: true,
      cell: (c) => (
        <div className="min-w-0">
          <Link href={`${base}/${c.id}`} className="font-medium hover:underline">
            {c.name}
          </Link>
          <p className="truncate text-[13px] text-muted">
            {c.segmentId ? (segName.get(c.segmentId) ?? 'Segment') : 'Segment deleted'}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (c) => {
        const s = campaignState(c, result(c).pending, now)
        return <Badge tone={s.tone}>{s.label}</Badge>
      },
    },
    {
      key: 'when',
      header: 'Send time',
      hideOnMobile: true,
      cell: (c) => (c.scheduledAt ? formatDateTime(c.scheduledAt) : '—'),
    },
    {
      key: 'recipients',
      header: 'Recipients',
      className: 'text-right tabular-nums',
      cell: (c) => (c.status === 'draft' ? '—' : c.recipients),
    },
    {
      key: 'sent',
      header: 'Sent',
      className: 'text-right tabular-nums',
      cell: (c) => {
        const r = result(c)
        if (!r.total) return '—'
        return (
          <span className="inline-flex items-center gap-2.5">
            <span className="hidden h-1 w-14 overflow-hidden rounded-full bg-subtle lg:inline-block">
              <span
                className="block h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${pct(r.sent, r.total)}%` }}
              />
            </span>
            {r.sent} / {r.total}
          </span>
        )
      },
    },
    {
      key: 'booked',
      header: 'Booked ≤ 14 days',
      className: 'text-right tabular-nums',
      cell: (c) => {
        const r = result(c)
        if (!r.reached) return '—'
        return (
          <span>
            {r.bookedClients}
            <span className="ms-1.5 text-[13px] text-muted">{pct(r.bookedClients, r.reached)}%</span>
          </span>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="WhatsApp · click to send"
        title="Campaigns"
        description="Pick a group of clients, write one message in English and Arabic, and it lands in the WhatsApp queue for your team to send."
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href={`${base}/segments/new`}>
                <Users /> New segment
              </Link>
            </Button>
            <Button asChild>
              <Link href={`${base}/new`}>
                <Plus /> New campaign
              </Link>
            </Button>
          </>
        }
      />
      <nav className="-mt-4 mb-8 flex gap-6 overflow-x-auto border-b text-sm sm:-mt-6" aria-label="Campaigns">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`${base}?tab=${t.key}`}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cn(
              '-mb-px flex min-h-11 shrink-0 items-center gap-2 border-b-2 pb-3 transition-colors sm:min-h-0',
              tab === t.key ? 'border-fg font-medium text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            <t.icon className="hidden size-4 sm:block" strokeWidth={1.5} /> {t.label}
            {t.key === 'segments' && data.segments.length > 0 && (
              <span className="text-xs text-muted tabular-nums">{data.segments.length}</span>
            )}
          </Link>
        ))}
      </nav>
      <PageBody>
        {tab === 'campaigns' && data.list.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard label="Waiting" value={totals.pending} hint="In the WhatsApp queue" />
            <StatCard label="Sent" value={totals.sent} hint="Pressed send in WhatsApp" />
            <div className="col-span-2 sm:col-span-1">
              <StatCard
                label="Booked within 14 days"
                value={totals.booked}
                hint={
                  totals.reached
                    ? `${pct(totals.booked, totals.reached)}% of clients messaged`
                    : 'Clicks aren’t tracked'
                }
              />
            </div>
          </div>
        )}

        {tab !== 'segments' && (
          <Card className="py-2">
            <DataTable
              columns={columns}
              rows={data.list}
              rowKey={(c) => c.id}
              empty={
                tab === 'archived' ? (
                  <EmptyState
                    icon={<Archive className="size-5" strokeWidth={1.5} />}
                    title="Nothing archived"
                    description="Archived campaigns move here, with their results."
                  />
                ) : (
                  <EmptyState
                    icon={<Megaphone className="size-5" strokeWidth={1.5} />}
                    title="No campaigns yet"
                    description="Start with a ready-made group of clients, then write the message."
                    action={<Presets base={base} />}
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
                title="No segments yet"
                description="A segment is a saved group of clients — like everyone who hasn’t visited in 60 days."
                action={<Presets base={base} />}
              />
            </Card>
          ) : (
            <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.segments.map((s, i) => (
                <StaggerItem key={s.id}>
                  <Card className="flex h-full flex-col p-6">
                    <h2 className="text-[15px] font-semibold tracking-tight">{s.name}</h2>
                    <ul className="mt-2 space-y-1 text-[13px] text-muted">
                      {s.rules.length ? (
                        s.rules.map((r) => <li key={JSON.stringify(r)}>{describeRule(r, serviceName)}</li>)
                      ) : (
                        <li>Everyone who can receive marketing</li>
                      )}
                    </ul>
                    <p className="mt-5 text-2xl font-semibold tracking-tight tabular-nums">
                      {data.sizes[i] ?? 0}
                      <span className="ms-1.5 text-sm font-normal text-muted">
                        {data.sizes[i] === 1 ? 'client' : 'clients'} now
                      </span>
                    </p>
                    <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-5">
                      <Button variant="ghost" size="sm" className="h-11 sm:h-9" asChild>
                        <Link href={`${base}/segments/${s.id}`}>Edit</Link>
                      </Button>
                      <Button variant="secondary" size="sm" className="h-11 sm:h-9" asChild>
                        <Link href={`${base}/new?segment=${s.id}`}>
                          <Megaphone /> Write campaign
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
