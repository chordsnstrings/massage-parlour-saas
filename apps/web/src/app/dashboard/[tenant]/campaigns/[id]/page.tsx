import { campaigns, clients, outbox, promoCodes, segments, withTenant } from '@spa/db'
import { campaignBookedClients, campaignResults } from '@spa/services'
import { asc, eq } from 'drizzle-orm'
import { ArrowLeft, CalendarCheck, Info, MessageCircle, Pencil } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { formatPhone, maskPhone } from '@/components/calendar/time'
import { ArchiveButton, DuplicateButton } from '@/components/campaigns/campaign-buttons'
import { campaignState, describeRule } from '@/components/campaigns/rules'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { type Column, DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { formatDateTime } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { serviceOptions } from '../data'

export const metadata: Metadata = { title: 'Campaign' }

const STATUS_LABEL = { queued: 'Waiting', opened: 'Opened', sent: 'Sent', skipped: 'Skipped' } as const
const clientCount = (n: number) => `${n} ${n === 1 ? 'client' : 'clients'}`
const STATUS_TONE = { queued: 'warning', opened: 'accent', sent: 'success', skipped: 'neutral' } as const

export default async function CampaignPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const ctx = await requireMember(tenant)
  if (!can(ctx, 'marketing.campaigns')) notFound()
  if (!z.uuid().safeParse(id).success) notFound()
  const slug = ctx.tenant.slug
  const base = appPath(`/${slug}/campaigns`)
  const seePhone = can(ctx, 'clients.phone')
  const now = new Date()

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, id))
    if (!c) return null
    return {
      c,
      segment: c.segmentId
        ? (await tx.select().from(segments).where(eq(segments.id, c.segmentId)))[0]
        : undefined,
      promo: c.promoCodeId
        ? (await tx.select().from(promoCodes).where(eq(promoCodes.id, c.promoCodeId)))[0]
        : undefined,
      result: (await campaignResults(tx, [id])).get(id)!,
      booked: await campaignBookedClients(tx, id),
      services: await serviceOptions(tx),
      rows: await tx
        .select({
          id: outbox.id,
          clientId: outbox.clientId,
          name: clients.name,
          language: clients.language,
          phone: outbox.phoneE164,
          status: outbox.status,
          sentAt: outbox.sentAt,
        })
        .from(outbox)
        .leftJoin(clients, eq(clients.id, outbox.clientId))
        .where(eq(outbox.campaignId, id))
        .orderBy(asc(clients.name))
        .limit(600),
    }
  })
  if (!data) notFound()
  const { c, result: r } = data
  const state = campaignState(c, r.pending, now)
  const rules = c.rules ?? data.segment?.rules ?? []
  const serviceName = (sid: string) => data.services.find((s) => s.id === sid)?.name
  const skippedRecent = c.stats.skippedRecent ?? 0
  const skippedOverLimit = c.stats.skippedOverLimit ?? 0
  type Row = (typeof data.rows)[number]

  const columns: Column<Row>[] = [
    {
      key: 'client',
      header: 'Client',
      primary: true,
      cell: (row) => (
        <span className="whitespace-nowrap font-medium">
          {row.name ?? 'Client'}
          {row.language === 'ar' && (
            <Badge className="ms-2" tone="accent">
              AR
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'phone',
      header: 'Mobile',
      className: 'tabular-nums whitespace-nowrap',
      cell: (row) => <span dir="ltr">{seePhone ? formatPhone(row.phone) : maskPhone(row.phone)}</span>,
    },
    {
      key: 'status',
      header: 'Message',
      cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>,
    },
    {
      key: 'sent',
      header: 'Sent',
      hideOnMobile: true,
      cell: (row) => (row.sentAt ? formatDateTime(row.sentAt) : '—'),
    },
    {
      key: 'booked',
      header: 'Booked',
      className: 'text-right',
      cell: (row) =>
        row.clientId && data.booked.has(row.clientId) ? (
          <span className="inline-flex items-center gap-1.5 text-success">
            <CalendarCheck className="size-4" strokeWidth={1.5} /> Booked
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={base} className="inline-flex items-center gap-1.5 hover:text-fg">
            <ArrowLeft className="size-3.5 rtl:rotate-180" strokeWidth={1.75} /> Campaigns
          </Link>
        }
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {c.name} <Badge tone={state.tone}>{state.label}</Badge>
          </span>
        }
        description={[
          data.segment?.name ?? (c.segmentId ? null : 'Segment deleted'),
          c.scheduledAt
            ? `${c.status === 'draft' ? 'Planned for' : 'Due'} ${formatDateTime(c.scheduledAt)}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            {c.status === 'draft' && !c.archivedAt && (
              <Button asChild>
                <Link href={`${base}/${id}/edit`}>
                  <Pencil /> Edit &amp; queue
                </Link>
              </Button>
            )}
            {r.pending > 0 && can(ctx, 'marketing.send') && (
              <Button asChild>
                <Link href={appPath(`/${slug}/messages`)}>
                  <MessageCircle /> Open WhatsApp queue
                </Link>
              </Button>
            )}
            <DuplicateButton slug={slug} id={id} />
            <ArchiveButton slug={slug} id={id} archived={Boolean(c.archivedAt)} pending={r.pending} />
          </>
        }
      />
      <PageBody>
        {c.status !== 'draft' && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Recipients"
              value={c.recipients}
              hint={`of ${c.stats.matched ?? c.recipients} in the segment`}
            />
            <StatCard
              label="Sent"
              value={r.sent}
              hint={r.skipped ? `${r.skipped} skipped` : 'Pressed send in WhatsApp'}
            />
            <StatCard label="Waiting" value={r.pending} hint="In the WhatsApp queue" />
            <StatCard
              label="Booked ≤ 14 days"
              value={r.bookedClients}
              hint={
                r.reached
                  ? `${Math.round((r.bookedClients / r.reached) * 100)}% of clients messaged`
                  : 'After sending'
              }
            />
          </div>
        )}

        {(skippedRecent > 0 || skippedOverLimit > 0) && (
          <Card className="flex items-start gap-3 px-5 py-4 text-sm sm:px-6">
            <Info className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.5} />
            <div className="space-y-1 text-muted">
              {skippedRecent > 0 && (
                <p>
                  <span className="font-medium text-fg">{skippedRecent}</span> skipped — already messaged by
                  another campaign within 7 days.
                </p>
              )}
              {skippedOverLimit > 0 && (
                <p>
                  <span className="font-medium text-fg">{skippedOverLimit}</span> left out — a campaign
                  reaches at most 500 clients. Duplicate it next week to reach the rest.
                </p>
              )}
            </div>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
          <Card className="order-last min-w-0 py-2 lg:col-span-12">
            <CardHeader
              title="Recipients"
              description="Clicks aren’t tracked — “Booked” means the client booked within 14 days of their message."
              className="pb-3"
            />
            <DataTable
              columns={columns}
              rows={data.rows}
              rowKey={(row) => row.id}
              empty={
                <EmptyState
                  icon={<MessageCircle className="size-5" strokeWidth={1.5} />}
                  title={c.status === 'draft' ? 'Not queued yet' : 'Nobody was messaged'}
                  description={
                    c.status === 'draft'
                      ? 'Queue the campaign to write a message for each client in the segment.'
                      : 'Everyone in the segment was skipped by the guardrails.'
                  }
                />
              }
            />
          </Card>

          <div className="grid min-w-0 gap-6 lg:col-span-12 lg:grid-cols-12 lg:gap-8">
            <Card className="min-w-0 lg:col-span-7">
              <CardHeader title="Message" />
              <CardBody className="space-y-4">
                {(['en', 'ar'] as const).map((lang) =>
                  c.body[lang] ? (
                    <div key={lang}>
                      <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">
                        {lang === 'en' ? 'English' : 'Arabic'}
                        {c.status !== 'draft' &&
                          ` · ${clientCount((lang === 'en' ? c.stats.en : c.stats.ar) ?? 0)}`}
                      </p>
                      <p
                        dir={lang === 'ar' ? 'rtl' : 'ltr'}
                        className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-subtle/70 px-4 py-3 text-sm leading-relaxed"
                      >
                        {c.body[lang]}
                      </p>
                    </div>
                  ) : null,
                )}
                {data.promo && (
                  <p className="text-sm">
                    Offer code <span className="font-mono font-medium">{data.promo.code}</span>
                  </p>
                )}
              </CardBody>
            </Card>
            <Card className="min-w-0 lg:col-span-5">
              <CardHeader title="Audience" description={data.segment?.name ?? 'Saved conditions'} />
              <CardBody>
                <ul className="space-y-1.5 text-sm text-muted">
                  {rules.length ? (
                    rules.map((rule) => <li key={JSON.stringify(rule)}>{describeRule(rule, serviceName)}</li>)
                  ) : (
                    <li>Everyone who can receive marketing</li>
                  )}
                </ul>
              </CardBody>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  )
}
