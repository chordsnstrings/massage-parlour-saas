import { campaigns, clients, outbox, promoCodes, segments, withTenant } from '@spa/db'
import { campaignBookedClients, campaignResults } from '@spa/services'
import { asc, eq } from 'drizzle-orm'
import { ArrowLeft, CalendarCheck, Clock, Info, MessageCircle, Pencil, Send, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { formatPhone, maskPhone } from '@/components/calendar/time'
import { ArchiveButton, DuplicateButton } from '@/components/campaigns/campaign-buttons'
import { campaignState, describeRule } from '@/components/campaigns/rules'
import { Card, Grid, Kpi, Note, Pill, type Tone } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { type Column, DataTable } from '@/components/ui/table'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { serviceOptions } from '../data'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('campaigns.detail.metaTitle') }
}

const STATUS_TONE: Record<'queued' | 'opened' | 'sent' | 'skipped', Tone> = {
  queued: 'warn',
  opened: 'acc',
  sent: 'ok',
  skipped: 'neutral',
}

export default async function CampaignPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const ctx = await requireMember(tenant)
  if (!can(ctx, 'marketing.campaigns')) notFound()
  if (!z.uuid().safeParse(id).success) notFound()
  const slug = ctx.tenant.slug
  const base = appPath(`/${slug}/campaigns`)
  const seePhone = can(ctx, 'clients.phone')
  const now = new Date()
  const { t, fmt } = await getI18n()

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
      header: t('campaigns.detail.client'),
      primary: true,
      cell: (row) => (
        <span className="whitespace-nowrap font-semibold">
          {row.name ?? t('campaigns.detail.client')}
          {row.language === 'ar' && (
            <Pill className="ms-2" tone="acc">
              {t('campaigns.langAr')}
            </Pill>
          )}
        </span>
      ),
    },
    {
      key: 'phone',
      header: t('campaigns.detail.mobile'),
      className: 'tabular-nums whitespace-nowrap',
      cell: (row) => <span dir="ltr">{seePhone ? formatPhone(row.phone) : maskPhone(row.phone)}</span>,
    },
    {
      key: 'status',
      header: t('campaigns.detail.message'),
      cell: (row) => (
        <Pill tone={STATUS_TONE[row.status]} dot>
          {t(`campaigns.recipientStatus.${row.status}`)}
        </Pill>
      ),
    },
    {
      key: 'sent',
      header: t('campaigns.detail.sent'),
      hideOnMobile: true,
      cell: (row) => (row.sentAt ? fmt.dateTime(row.sentAt) : '—'),
    },
    {
      key: 'booked',
      header: t('campaigns.detail.booked'),
      className: 'text-end',
      cell: (row) =>
        row.clientId && data.booked.has(row.clientId) ? (
          <span className="inline-flex items-center gap-1.5 text-[var(--crm-ok)]">
            <CalendarCheck className="size-4" strokeWidth={1.5} /> {t('campaigns.detail.booked')}
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
            <ArrowLeft className="size-3.5 rtl:rotate-180" strokeWidth={1.75} /> {t('campaigns.detail.back')}
          </Link>
        }
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {c.name}{' '}
            <Pill tone={state.tone} dot>
              {t(state.key)}
            </Pill>
          </span>
        }
        description={[
          data.segment?.name ?? (c.segmentId ? null : t('campaigns.segmentDeleted')),
          c.scheduledAt
            ? t(c.status === 'draft' ? 'campaigns.detail.plannedFor' : 'campaigns.detail.due', {
                time: fmt.dateTime(c.scheduledAt),
              })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            {c.status === 'draft' && !c.archivedAt && (
              <Button asChild>
                <Link href={`${base}/${id}/edit`}>
                  <Pencil /> {t('campaigns.detail.editQueue')}
                </Link>
              </Button>
            )}
            {r.pending > 0 && can(ctx, 'marketing.send') && (
              <Button asChild>
                <Link href={appPath(`/${slug}/messages`)}>
                  <MessageCircle /> {t('campaigns.detail.openQueue')}
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
          <Grid cols="g4">
            <Kpi
              label={t('campaigns.stats.recipients')}
              icon={<Users />}
              value={fmt.number(c.recipients)}
              sub={t('campaigns.stats.ofSegment', { count: fmt.number(c.stats.matched ?? c.recipients) })}
            />
            <Kpi
              label={t('campaigns.stats.sent')}
              icon={<Send />}
              value={fmt.number(r.sent)}
              sub={
                r.skipped
                  ? t('campaigns.stats.skipped', { count: fmt.number(r.skipped) })
                  : t('campaigns.stats.sentHint')
              }
            />
            <Kpi
              label={t('campaigns.stats.waiting')}
              icon={<Clock />}
              value={fmt.number(r.pending)}
              sub={t('campaigns.stats.waitingHint')}
            />
            <Kpi
              label={t('campaigns.stats.bookedShort')}
              icon={<CalendarCheck />}
              value={fmt.number(r.bookedClients)}
              sub={
                r.reached
                  ? t('campaigns.stats.bookedHint', { pct: fmt.percent(r.bookedClients / r.reached) })
                  : t('campaigns.stats.afterSending')
              }
            />
          </Grid>
        )}

        {(skippedRecent > 0 || skippedOverLimit > 0) && (
          <Note tone="info" icon={<Info />}>
            {skippedRecent > 0 && (
              <p>{t('campaigns.detail.skippedRecent', { count: fmt.number(skippedRecent) })}.</p>
            )}
            {skippedOverLimit > 0 && (
              <p>
                {t('campaigns.detail.skippedOverLimit', { count: fmt.number(skippedOverLimit) })}.{' '}
                {t('campaigns.detail.overLimitHint')}
              </p>
            )}
          </Note>
        )}

        <Grid cols="col-2b">
          <Card title={t('campaigns.detail.messageTitle')} className="min-w-0">
            <div className="space-y-4">
              {(['en', 'ar'] as const).map((lang) =>
                c.body[lang] ? (
                  <div key={lang}>
                    <p className="crm-ey">
                      {lang === 'en' ? t('campaigns.detail.english') : t('campaigns.detail.arabic')}
                      {c.status !== 'draft' &&
                        ` · ${t('campaigns.detail.clients', { count: (lang === 'en' ? c.stats.en : c.stats.ar) ?? 0 })}`}
                    </p>
                    <p
                      dir={lang === 'ar' ? 'rtl' : 'ltr'}
                      lang={lang}
                      className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-[var(--crm-surface2)] px-4 py-3 text-[length:var(--crm-fs-note)] leading-relaxed"
                    >
                      {c.body[lang]}
                    </p>
                  </div>
                ) : null,
              )}
              {data.promo && (
                <p className="text-[length:var(--crm-fs-note)]">
                  {t('campaigns.detail.offerCode')}{' '}
                  <span className="font-mono font-semibold">{data.promo.code}</span>
                </p>
              )}
            </div>
          </Card>
          <Card
            title={t('campaigns.detail.audienceTitle')}
            sub={data.segment?.name ?? t('campaigns.detail.savedConditions')}
            className="min-w-0"
          >
            <ul className="crm-muted space-y-1.5 text-[length:var(--crm-fs-note)]">
              {rules.length ? (
                rules.map((rule) => (
                  <li key={JSON.stringify(rule)}>{describeRule(t, fmt, rule, serviceName)}</li>
                ))
              ) : (
                <li>{t('campaigns.everyone')}</li>
              )}
            </ul>
          </Card>
        </Grid>

        <Card
          flush
          className="min-w-0"
          title={t('campaigns.detail.recipientsTitle')}
          sub={t('campaigns.detail.recipientsSub')}
        >
          <DataTable
            columns={columns}
            rows={data.rows}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                icon={<MessageCircle className="size-5" strokeWidth={1.5} />}
                title={
                  c.status === 'draft'
                    ? t('campaigns.detail.notQueuedTitle')
                    : t('campaigns.detail.nobodyTitle')
                }
                description={
                  c.status === 'draft'
                    ? t('campaigns.detail.notQueuedBody')
                    : t('campaigns.detail.nobodyBody')
                }
              />
            }
          />
        </Card>
      </PageBody>
    </>
  )
}
