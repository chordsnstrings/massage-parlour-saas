// Notification producers that scan tenant data (worker jobs, PLAN §14.7 B2). Each returns the notifications to
// send; dedupe keys make re-runs harmless: per booking / invoice / reminder, or per day for daily summaries.
import {
  bookingItems,
  bookings,
  branches,
  clients,
  platformInvoices,
  platformReminders,
  reviews,
  socialPosts,
  stockLevels,
  type Tx,
} from '@spa/db'
import { and, asc, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import { documentsDueForReminder, dubaiToday } from './documents'
import { lowStock } from './inventory'
import type { NewNotification } from './notifications'
import { overdueInvoices } from './platform-billing'

type Scope = { tenantId: string; slug: string; now?: Date }

const firstService = sql<string | null>`(select ${bookingItems.serviceName} from ${bookingItems}
  where ${bookingItems.bookingId} = ${bookings.id} order by ${bookingItems.startsAt} limit 1)`

/** Online (or any) bookings still `pending` 15 min after they came in, for visits in the next 48 h. */
export async function pendingBookingNotices(tx: Tx, s: Scope): Promise<NewNotification[]> {
  const now = s.now ?? new Date()
  const rows = await tx
    .select({
      id: bookings.id,
      startsAt: bookings.startsAt,
      businessDate: bookings.businessDate,
      name: clients.name,
      service: firstService,
    })
    .from(bookings)
    .leftJoin(clients, eq(clients.id, bookings.clientId))
    .where(
      and(
        eq(bookings.status, 'pending'),
        lt(bookings.createdAt, new Date(now.getTime() - 15 * 60_000)),
        gt(bookings.startsAt, now),
        lt(bookings.startsAt, new Date(now.getTime() + 48 * 3600_000)),
      ),
    )
    .orderBy(asc(bookings.startsAt))
    .limit(50)
  return rows.map((b) => ({
    tenantId: s.tenantId,
    kind: 'booking.pending',
    params: { name: b.name ?? '—', service: b.service ?? '—', at: b.startsAt.toISOString() },
    url: `/${s.slug}/calendar?date=${b.businessDate}`,
    dedupeKey: `booking.pending:${b.id}`,
  }))
}

/** One notification per stock location (branch or warehouse) with products at/below threshold, once a day. */
export async function lowStockNotices(tx: Tx, s: Scope): Promise<NewNotification[]> {
  const today = dubaiToday(s.now)
  const locations = await tx
    .selectDistinct({ branchId: stockLevels.branchId, name: branches.name })
    .from(stockLevels)
    .leftJoin(branches, eq(branches.id, stockLevels.branchId))
  const out: NewNotification[] = []
  for (const loc of locations) {
    const low = await lowStock(tx, loc.branchId)
    if (low.length === 0) continue
    const names = low.map((p) => p.name.en)
    out.push({
      tenantId: s.tenantId,
      kind: 'stock.low',
      params: {
        count: low.length,
        location: loc.branchId ? (loc.name ?? '—') : { key: 'notifications.warehouse' },
        products: names.slice(0, 5).join(', ') + (names.length > 5 ? ` +${names.length - 5}` : ''),
      },
      url: loc.branchId ? `/${s.slug}/inventory` : `/${s.slug}/warehouse`,
      dedupeKey: `stock.low:${loc.branchId ?? 'warehouse'}:${today}`,
    })
  }
  return out
}

/** Documents at 60/30/7/0 days left (same milestones as before), summarised once a day. */
export async function documentExpiryNotices(tx: Tx, s: Scope): Promise<NewNotification[]> {
  const due = await documentsDueForReminder(tx, s.now)
  if (due.length === 0) return []
  const first = [...due].sort((a, b) => (a.days ?? 0) - (b.days ?? 0))[0]!
  return [
    {
      tenantId: s.tenantId,
      kind: 'document.expiry',
      params: {
        count: due.length,
        more: due.length - 1,
        name: first.scope === 'staff' ? `${first.typeLabel} — ${first.owner}` : first.typeLabel,
        date: first.expiresOn ?? dubaiToday(s.now),
      },
      url: `/${s.slug}/documents`,
      dedupeKey: `document.expiry:${dubaiToday(s.now)}`,
    },
  ]
}

/** AI drafts waiting for a human: Instagram posts pending approval + drafted review replies, once a day. */
export async function aiDraftNotices(tx: Tx, s: Scope): Promise<NewNotification[]> {
  const [p] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(socialPosts)
    .where(eq(socialPosts.status, 'pending_approval'))
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(reviews)
    .where(eq(reviews.replyStatus, 'draft'))
  const posts = Number(p?.n ?? 0)
  const replies = Number(r?.n ?? 0)
  if (posts + replies === 0) return []
  return [
    {
      tenantId: s.tenantId,
      kind: 'ai.drafts',
      params: { count: posts + replies, posts, replies },
      url: posts ? `/${s.slug}/ai/content` : `/${s.slug}/ai/reviews`,
      dedupeKey: `ai.drafts:${dubaiToday(s.now)}`,
    },
  ]
}

/** Overdue platform invoices (one notification each) and open payment reminders from the platform (W1 billing). */
export async function billingNotices(tx: Tx, s: Scope): Promise<NewNotification[]> {
  const today = dubaiToday(s.now)
  const out: NewNotification[] = (await overdueInvoices(tx, s.tenantId, today)).map((inv) => ({
    tenantId: s.tenantId,
    kind: 'billing.overdue',
    params: { number: inv.number, amount: inv.totalAed, date: inv.dueDate },
    url: `/${s.slug}/billing`,
    dedupeKey: `billing.overdue:${inv.id}`,
  }))
  const open = await tx
    .select({ id: platformReminders.id, amount: platformReminders.amountAed })
    .from(platformReminders)
    .where(and(eq(platformReminders.tenantId, s.tenantId), isNull(platformReminders.resolvedAt)))
  const [unpaid] = open.length
    ? await tx
        .select({ id: platformInvoices.id })
        .from(platformInvoices)
        .where(and(eq(platformInvoices.tenantId, s.tenantId), eq(platformInvoices.status, 'issued')))
        .limit(1)
    : []
  if (unpaid)
    for (const rem of open)
      out.push({
        tenantId: s.tenantId,
        kind: 'billing.reminder',
        params: { amount: rem.amount },
        url: `/${s.slug}/billing`,
        dedupeKey: `billing.reminder:${rem.id}`,
      })
  return out
}
