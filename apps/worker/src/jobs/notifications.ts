// Notification producers (PLAN §14.7 B2): scan every active spa, store bell rows (deduped) and web-push them in each
// recipient's locale. Rows are stored even when VAPID keys are missing (the bell still works).
import { platformDb, type Tx, tenants, withTenant } from '@spa/db'
import {
  aiDraftNotices,
  billingNotices,
  documentExpiryNotices,
  lowStockNotices,
  type NewNotification,
  notify,
  pendingBookingNotices,
  pruneNotifications,
} from '@spa/services'
import { inArray } from 'drizzle-orm'
import { log } from '../log'

type Scan = (tx: Tx, s: { tenantId: string; slug: string; now?: Date }) => Promise<NewNotification[]>

export const activeTenants = () =>
  platformDb()
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(inArray(tenants.status, ['trial', 'active', 'past_due']))

/** Runs one producer for every active spa; one spa failing never stops the others. */
export async function runNotificationScan(name: string, scan: Scan, now = new Date()) {
  let created = 0
  let sent = 0
  for (const t of await activeTenants()) {
    try {
      const items = await withTenant(t.id, (tx) => scan(tx, { tenantId: t.id, slug: t.slug, now }))
      for (const n of items) {
        const res = await notify(n)
        if (res.created) {
          created++
          sent += res.push.sent
        }
      }
    } catch (error) {
      log('error', `${name} failed`, { tenant: t.slug, error: String(error) })
    }
  }
  if (created) log('info', name, { created, sent })
  return { created, sent }
}

export const notifyPendingBookings = (now?: Date) =>
  runNotificationScan('pending-booking notifications', pendingBookingNotices, now)
export const notifyLowStock = (now?: Date) =>
  runNotificationScan('low-stock notifications', lowStockNotices, now)
export const notifyDocumentExpiry = (now?: Date) =>
  runNotificationScan('document reminders', documentExpiryNotices, now)
export const notifyAiDrafts = (now?: Date) =>
  runNotificationScan('AI draft notifications', aiDraftNotices, now)
export const notifyBilling = (now?: Date) => runNotificationScan('billing notifications', billingNotices, now)

/** Keeps 90 days of notifications per spa. */
export async function pruneAllNotifications(now = new Date()) {
  const before = new Date(now.getTime() - 90 * 86_400_000)
  let pruned = 0
  for (const t of await activeTenants())
    pruned += await withTenant(t.id, (tx) => pruneNotifications(tx, before))
  return { pruned }
}
