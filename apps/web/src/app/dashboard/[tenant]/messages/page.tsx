import { businessDateOf, businessDayWindow } from '@spa/core'
import { bookings, clients, outbox, platformDb, user, withTenant } from '@spa/db'
import { campaignConsentWithdrawn, outboxLink } from '@spa/services'
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lte, not, or } from 'drizzle-orm'
import { FileText } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { maskPhone } from '@/components/calendar/time'
import { OutboxQueue } from '@/components/messages/outbox-queue'
import type { MessageKind, OutboxRow } from '@/components/messages/shared'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { allowedBranches } from '../calendar/data'

export const metadata: Metadata = { title: 'WhatsApp' }

const TABS = ['due', 'scheduled', 'sent'] as const
type Tab = (typeof TABS)[number]

export default async function MessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'marketing.send')) notFound()
  const slug = ctx.tenant.slug
  const tabParam = (await searchParams).tab
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'due'
  const seePhone = can(ctx, 'clients.phone')
  const now = new Date()

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const branchRows = await allowedBranches(tx, ctx)
    const restricted = ctx.member && !ctx.member.allBranches
    const branchIds = branchRows.map((b) => b.id)
    // Members limited to some branches see those branches' messages (and branch-less ones).
    const inBranch = restricted
      ? or(isNull(outbox.branchId), branchIds.length ? inArray(outbox.branchId, branchIds) : undefined)
      : undefined
    // Campaign messages whose client opted out (or was blocklisted / tagged no-marketing) since queueing are
    // never offered for sending; the hourly campaigns job then marks them skipped.
    const pending = and(inArray(outbox.status, ['queued', 'opened']), not(campaignConsentWithdrawn()))
    const dueWhere = and(inBranch, pending, lte(outbox.dueAt, now))
    const scheduledWhere = and(inBranch, pending, gt(outbox.dueAt, now))
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000)
    const sentWhere = and(inBranch, eq(outbox.status, 'sent'), gte(outbox.sentAt, weekAgo))
    // "Sent today" is the business day of the main branch (late-night shops close after midnight).
    const cutoff = branchRows[0]?.businessDayCutoff?.slice(0, 5) ?? '05:00'
    const day = businessDayWindow(businessDateOf(now, cutoff), cutoff)

    const counter = async (where: ReturnType<typeof and>) =>
      (await tx.select({ n: count() }).from(outbox).where(where))[0]?.n ?? 0

    const rows = await tx
      .select({
        id: outbox.id,
        kind: outbox.kind,
        campaignId: outbox.campaignId,
        status: outbox.status,
        phone: outbox.phoneE164,
        text: outbox.text,
        dueAt: outbox.dueAt,
        sentAt: outbox.sentAt,
        sentBy: outbox.sentBy,
        clientName: clients.name,
        bookingAt: bookings.startsAt,
      })
      .from(outbox)
      .leftJoin(clients, eq(clients.id, outbox.clientId))
      .leftJoin(bookings, eq(bookings.id, outbox.bookingId))
      .where(tab === 'due' ? dueWhere : tab === 'scheduled' ? scheduledWhere : sentWhere)
      .orderBy(tab === 'sent' ? desc(outbox.sentAt) : asc(outbox.dueAt))
      .limit(200)

    return {
      rows,
      counts: {
        due: await counter(dueWhere),
        scheduled: await counter(scheduledWhere),
        sentToday: await counter(
          and(
            inBranch,
            eq(outbox.status, 'sent'),
            gte(outbox.sentAt, day.start),
            lte(outbox.sentAt, day.end),
          ),
        ),
        sentWeek: await counter(sentWhere),
      },
    }
  })

  // Who pressed send (names live in the platform-scoped auth table).
  const senderIds = [...new Set(data.rows.map((r) => r.sentBy).filter((v): v is string => Boolean(v)))]
  const senders = senderIds.length
    ? await platformDb()
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(inArray(user.id, senderIds))
    : []
  const senderName = new Map(senders.map((s) => [s.id, s.name]))

  const rows: OutboxRow[] = data.rows.map((r) => ({
    id: r.id,
    kind: r.kind as MessageKind,
    campaign: r.campaignId !== null,
    status: r.status,
    clientName: r.clientName ?? 'Client',
    phone: seePhone ? `+${r.phone}` : maskPhone(r.phone),
    text: r.text,
    dueAt: r.dueAt.toISOString(),
    bookingAt: r.bookingAt?.toISOString() ?? null,
    sentAt: r.sentAt?.toISOString() ?? null,
    sentBy: r.sentBy ? (senderName.get(r.sentBy) ?? null) : null,
    links: {
      web: outboxLink({ phoneE164: r.phone, text: r.text }, 'web'),
      desktop: outboxLink({ phoneE164: r.phone, text: r.text }, 'desktop'),
      mobile: outboxLink({ phoneE164: r.phone, text: r.text }, 'mobile'),
    },
  }))

  return (
    <>
      <PageHeader
        eyebrow="Click to send"
        title="WhatsApp"
        description="Messages are written for you. Open each one in WhatsApp, press send, then mark it sent."
        actions={
          <Button variant="secondary" asChild>
            <Link href={appPath(`/${slug}/messages/templates`)}>
              <FileText /> Templates
            </Link>
          </Button>
        }
      />
      <OutboxQueue
        key={tab}
        slug={slug}
        tab={tab}
        base={appPath(`/${slug}/messages`)}
        rows={rows}
        counts={data.counts}
      />
    </>
  )
}
