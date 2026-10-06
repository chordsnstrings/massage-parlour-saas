// Web push to staff and owners (PLAN §1.18). Subscriptions are per user and device (platform table
// push_subscriptions); who receives a tenant notification is decided by active membership + role permission.
// Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT; without them every send is a no-op.
import { type Permission, resolvePermissions } from '@spa/core'
import { type Db, members, platformDb, pushSubscriptions, roles, withTenant } from '@spa/db'
import { and, eq, inArray } from 'drizzle-orm'
import webpush from 'web-push'

export type PushPayload = {
  title: string
  body: string
  /**
   * Dashboard path opened on click, without the routing prefix (e.g. "/serenity/calendar"): the service worker
   * adds the app surface base it was registered with ("/app" in path routing), so the worker needn't know it.
   */
  url?: string
  /** Notifications with the same tag replace each other on the device. */
  tag?: string
}

export type PushKeys = { p256dh: string; auth: string }
export type PushTarget = { id: string; endpoint: string; keys: PushKeys }
export type PushResult = { sent: number; pruned: number; failed: number }
export type PushSender = (target: PushTarget, payload: string) => Promise<unknown>

export function pushConfig() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return null
  return { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT }
}

export const pushConfigured = () => pushConfig() !== null

function webPushSender(): PushSender | null {
  const cfg = pushConfig()
  if (!cfg) return null
  return (target, payload) =>
    webpush.sendNotification({ endpoint: target.endpoint, keys: target.keys }, payload, {
      vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
      TTL: 6 * 3600,
      urgency: 'normal',
      timeout: 10_000,
    })
}

/** The push service says the subscription is gone (unsubscribed, expired or uninstalled). */
const isGone = (e: unknown) => {
  const status = (e as { statusCode?: number })?.statusCode
  return status === 404 || status === 410
}

/** Sends one payload to many devices; endpoints the push service reports as gone are deleted. */
export async function sendPush(
  targets: PushTarget[],
  payload: PushPayload,
  opts: { db?: Db; send?: PushSender } = {},
): Promise<PushResult> {
  const result: PushResult = { sent: 0, pruned: 0, failed: 0 }
  const send = opts.send ?? webPushSender()
  if (!send || targets.length === 0) return result
  const body = JSON.stringify({ ...payload, body: payload.body.slice(0, 240) })
  const gone: string[] = []
  await Promise.all(
    targets.map(async (t) => {
      try {
        await send(t, body)
        result.sent++
      } catch (e) {
        if (isGone(e)) gone.push(t.id)
        else result.failed++
      }
    }),
  )
  if (gone.length) {
    await (opts.db ?? platformDb()).delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone))
    result.pruned = gone.length
  }
  return result
}

/** User ids of the tenant's active members whose role grants `permission`. */
export async function memberUserIds(tenantId: string, permission: Permission, appDb?: Db) {
  const rows = await withTenant(
    tenantId,
    (tx) =>
      tx
        .select({ userId: members.userId, key: roles.key, permissions: roles.permissions })
        .from(members)
        .innerJoin(roles, eq(roles.id, members.roleId))
        .where(eq(members.status, 'active')),
    appDb,
  )
  return [
    ...new Set(
      rows
        .filter((r) => resolvePermissions({ key: r.key, permissions: r.permissions }).has(permission))
        .map((r) => r.userId),
    ),
  ]
}

export async function subscriptionsOf(userIds: string[], db: Db = platformDb()): Promise<PushTarget[]> {
  if (userIds.length === 0) return []
  return db
    .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, keys: pushSubscriptions.keys })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds))
}

export type NotifyOptions = {
  permission: Permission
  /** Test seams: platform + app databases and the push sender. */
  db?: Db
  appDb?: Db
  send?: PushSender
}

/**
 * Pushes to every device of the tenant's active members holding `permission`. Never throws for delivery
 * problems (a booking must not fail because a phone is offline); returns counts for logging.
 */
export async function notifyTenant(
  tenantId: string,
  payload: PushPayload,
  opts: NotifyOptions,
): Promise<PushResult & { skipped?: 'not_configured' }> {
  if (!opts.send && !pushConfigured()) return { sent: 0, pruned: 0, failed: 0, skipped: 'not_configured' }
  const users = await memberUserIds(tenantId, opts.permission, opts.appDb)
  const targets = await subscriptionsOf(users, opts.db)
  return sendPush(targets, payload, { db: opts.db, send: opts.send })
}

/** Pushes to one user's devices (or one of them, by endpoint) — the account page's test button. */
export async function notifyUser(
  userId: string,
  payload: PushPayload,
  opts: { endpoint?: string; db?: Db; send?: PushSender } = {},
) {
  const db = opts.db ?? platformDb()
  const targets = await db
    .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, keys: pushSubscriptions.keys })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        opts.endpoint ? eq(pushSubscriptions.endpoint, opts.endpoint) : undefined,
      ),
    )
  return sendPush(targets, payload, { db, send: opts.send })
}

/** Stores (or moves to this user) a browser's push subscription. */
export async function savePushSubscription(
  userId: string,
  sub: { endpoint: string; keys: PushKeys },
  db: Db = platformDb(),
) {
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, keys: sub.keys })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, keys: sub.keys } })
}

export async function deletePushSubscription(userId: string, endpoint: string, db: Db = platformDb()) {
  const rows = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .returning({ id: pushSubscriptions.id })
  return rows.length > 0
}
