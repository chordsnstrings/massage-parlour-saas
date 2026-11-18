// Notification producers (PLAN §14.7 B2): scan every active spa, store bell rows (deduped) and web-push them in each
// recipient's locale. Rows are stored even when VAPID keys are missing (the bell still works).
import type { AutomationKey } from '@spa/core'
import { type Tx, withTenant } from '@spa/db'
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
import { log } from '../log'
import { activeTenants, recordRun } from './runs'

type Scan = (tx: Tx, s: { tenantId: string; slug: string; now?: Date }) => Promise<NewNotification[]>

/** An automation-backed producer (B3): skipped for spas that switched it off, and logged to `job_runs`. */
type AutomationScan = { key: AutomationKey; job: string }

/** Runs one producer for every active spa; one spa failing never stops the others. Core alerts (new booking, low
 *  stock, billing, AI drafts waiting for review) always run; `automation` producers respect the spa's switch. */
export async function runNotificationScan(
  name: string,
  scan: Scan,
  now = new Date(),
  automation?: AutomationScan,
) {
  let created = 0
  let sent = 0
  for (const t of await activeTenants(automation?.key)) {
    try {
      const items = await withTenant(t.id, (tx) => scan(tx, { tenantId: t.id, slug: t.slug, now }))
      let mine = 0
      for (const n of items) {
        const res = await notify(n)
        if (res.created) {
          created++
          mine++
          sent += res.push.sent
        }
      }
      if (automation) await recordRun(t.id, automation.job, 'ok', { count: items.length, created: mine })
    } catch (error) {
      log('error', `${name} failed`, { tenant: t.slug, error: String(error) })
      if (automation) await recordRun(t.id, automation.job, 'failed')
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
  runNotificationScan('document reminders', documentExpiryNotices, now, {
    key: 'documentAlerts',
    job: 'document-reminders',
  })
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
