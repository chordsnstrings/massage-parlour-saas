// In-app notifications + their web push (PLAN §14.7 B2). Rows live per tenant (RLS); `user_id` NULL = every member
// whose role grants the kind's permission. Producers call `notify()` (create, deduped, then push in each
// recipient's locale); the bell/page use list/unread/markRead/markAll with the viewer's resolved permissions.
import {
  type NotificationKind,
  type NotificationParams,
  notificationPermission,
  notificationText,
  type Permission,
} from '@spa/core'
import { createFormat, isLocale, translator } from '@spa/core/i18n'
import {
  type Db,
  type NotificationPayload,
  notificationReads,
  notifications,
  platformDb,
  type Tx,
  user,
  withTenant,
} from '@spa/db'
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import {
  memberUserIds,
  type PushResult,
  type PushSender,
  pushConfigured,
  sendPush,
  subscriptionsOf,
} from './notify'

export type NewNotification = {
  tenantId: string
  kind: NotificationKind
  /** One person only; omit for everyone holding the kind's permission. */
  userId?: string | null
  params?: NotificationParams
  /** Dashboard path without the routing prefix, e.g. "/serenity/calendar?date=2026-10-09". */
  url?: string
  /** Same key → the event is stored (and pushed) once. */
  dedupeKey?: string | null
}

export type NotificationRow = typeof notifications.$inferSelect

/** Inserts a notification; returns null when its dedupe key already exists. */
export async function createNotification(tx: Tx, n: NewNotification): Promise<NotificationRow | null> {
  const [row] = await tx
    .insert(notifications)
    .values({
      tenantId: n.tenantId,
      userId: n.userId ?? null,
      kind: n.kind,
      permission: notificationPermission(n.kind),
      payload: { params: n.params, url: n.url } as NotificationPayload,
      dedupeKey: n.dedupeKey ?? null,
    })
    .onConflictDoNothing({
      target: [notifications.tenantId, notifications.dedupeKey],
      where: sql`${notifications.dedupeKey} is not null`,
    })
    .returning()
  return row ?? null
}

export type Viewer = { userId: string; permissions: Iterable<Permission> }

const visibleTo = (v: Viewer) => {
  const perms = [...v.permissions]
  return and(
    or(isNull(notifications.userId), eq(notifications.userId, v.userId)),
    perms.length ? inArray(notifications.permission, perms) : sql`false`,
  )
}

const readAtFor = (userId: string) =>
  sql<Date | null>`coalesce(${notifications.readAt}, (select ${notificationReads.readAt} from ${notificationReads}
    where ${notificationReads.notificationId} = ${notifications.id} and ${notificationReads.userId} = ${userId}))`

const unread = (userId: string) => sql`${readAtFor(userId)} is null`

export type NotificationItem = {
  id: string
  kind: string
  params: NotificationParams
  url: string | null
  createdAt: Date
  readAt: Date | null
}

/** Newest first. `before` pages by created_at; `unreadOnly` hides what this viewer has read. */
export async function listNotifications(
  tx: Tx,
  v: Viewer,
  opts: { limit?: number; unreadOnly?: boolean; before?: Date } = {},
): Promise<NotificationItem[]> {
  const rows = await tx
    .select({
      id: notifications.id,
      kind: notifications.kind,
      payload: notifications.payload,
      createdAt: notifications.createdAt,
      readAt: readAtFor(v.userId),
    })
    .from(notifications)
    .where(
      and(
        visibleTo(v),
        opts.unreadOnly ? unread(v.userId) : undefined,
        opts.before ? lt(notifications.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(Math.min(Math.max(opts.limit ?? 20, 1), 100))
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    params: (r.payload.params ?? {}) as NotificationParams,
    url: r.payload.url ?? null,
    createdAt: r.createdAt,
    readAt: r.readAt ? new Date(r.readAt) : null,
  }))
}

export async function unreadNotificationCount(tx: Tx, v: Viewer) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(visibleTo(v), unread(v.userId)))
  return Number(row?.n ?? 0)
}

/** Marks one notification read for this viewer; false when it isn't theirs to see. */
export async function markNotificationRead(tx: Tx, v: Viewer, id: string) {
  const [n] = await tx
    .select({ id: notifications.id, tenantId: notifications.tenantId, userId: notifications.userId })
    .from(notifications)
    .where(and(eq(notifications.id, id), visibleTo(v)))
    .limit(1)
  if (!n) return false
  if (n.userId) {
    await tx
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(eq(notifications.id, n.id))
  } else {
    await tx
      .insert(notificationReads)
      .values({ tenantId: n.tenantId, notificationId: n.id, userId: v.userId })
      .onConflictDoNothing()
  }
  return true
}

/** Marks everything this viewer can see as read; returns how many were unread. */
export async function markAllNotificationsRead(tx: Tx, v: Viewer) {
  const open = await tx
    .select({ id: notifications.id, tenantId: notifications.tenantId, userId: notifications.userId })
    .from(notifications)
    .where(and(visibleTo(v), unread(v.userId)))
  const own = open.filter((n) => n.userId).map((n) => n.id)
  const shared = open.filter((n) => !n.userId)
  if (own.length)
    await tx.update(notifications).set({ readAt: new Date() }).where(inArray(notifications.id, own))
  if (shared.length)
    await tx
      .insert(notificationReads)
      .values(shared.map((n) => ({ tenantId: n.tenantId, notificationId: n.id, userId: v.userId })))
      .onConflictDoNothing()
  return open.length
}

/** Housekeeping: drops notifications older than `before` (reads cascade). */
export async function pruneNotifications(tx: Tx, before: Date) {
  const rows = await tx
    .delete(notifications)
    .where(lt(notifications.createdAt, before))
    .returning({ id: notifications.id })
  return rows.length
}

export type DeliverOptions = { db?: Db; appDb?: Db; send?: PushSender }

/**
 * Web push for a stored notification: every device of each recipient, title/body in that user's locale. A personal
 * row only reaches its user while they still hold the permission. Never throws for delivery problems.
 */
export async function deliverNotification(
  row: Pick<NotificationRow, 'tenantId' | 'id' | 'kind' | 'userId' | 'permission' | 'payload'>,
  opts: DeliverOptions = {},
): Promise<PushResult> {
  const total: PushResult = { sent: 0, pruned: 0, failed: 0 }
  if (!opts.send && !pushConfigured()) return total
  const allowed = await memberUserIds(row.tenantId, row.permission as Permission, opts.appDb)
  const userIds = row.userId ? allowed.filter((u) => u === row.userId) : allowed
  if (userIds.length === 0) return total
  const db = opts.db ?? platformDb()
  const [targets, locales] = await Promise.all([
    subscriptionsOf(userIds, db),
    db.select({ id: user.id, locale: user.locale }).from(user).where(inArray(user.id, userIds)),
  ])
  if (targets.length === 0) return total
  const localeOf = new Map(locales.map((u) => [u.id, isLocale(u.locale) ? u.locale : 'en']))
  const byLocale = new Map<'en' | 'th', typeof targets>()
  for (const t of targets) {
    const loc = localeOf.get(t.userId ?? '') ?? 'en'
    byLocale.set(loc, [...(byLocale.get(loc) ?? []), t])
  }
  for (const [locale, group] of byLocale) {
    const text = notificationText(translator(locale), createFormat(locale), {
      kind: row.kind,
      params: row.payload.params as NotificationParams | undefined,
    })
    const res = await sendPush(
      group,
      { ...text, url: row.payload.url, tag: `${row.kind}:${row.id}` },
      { db, send: opts.send },
    )
    total.sent += res.sent
    total.pruned += res.pruned
    total.failed += res.failed
  }
  return total
}

/** Producer entry point: store (deduped) then push. `created: false` = already notified, nothing sent. */
export async function notify(n: NewNotification, opts: DeliverOptions = {}) {
  const row = await withTenant(n.tenantId, (tx) => createNotification(tx, n), opts.appDb)
  if (!row) return { created: false as const }
  let push: PushResult = { sent: 0, pruned: 0, failed: 0 }
  try {
    push = await deliverNotification(row, opts)
  } catch (error) {
    console.error('notification push failed', error)
  }
  return { created: true as const, id: row.id, push }
}
