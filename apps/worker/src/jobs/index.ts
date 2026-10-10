import { pruneAnalytics, rollupAnalytics } from './analytics'
import { backupDatabase } from './backup'
import { finishAllCampaigns } from './campaigns'
import { verifyCustomDomains } from './domains'
import { dailyDigest, documentExpiryReminders, weeklyInsights } from './engage'
import { syncAllGbpReviews } from './gbp'
import { heartbeat } from './heartbeat'
import {
  publishScheduledInstagramPosts,
  refreshInstagramAccessTokens,
  replyToInstagramMessages,
} from './instagram'
import { pruneExpiredAiImages } from './media'
import {
  notifyAiDrafts,
  notifyBilling,
  notifyLowStock,
  notifyPendingBookings,
  pruneAllNotifications,
} from './notifications'
import { autoPurgeTenants, pruneOAuthClients } from './purge'
import { restoreDrill } from './restore-drill'
import { autoAssignOutbox, expireAllPackages, renewAllMemberships, runSlotFiller } from './tenant-jobs'

export type JobDef = {
  name: string
  /** Cron in Asia/Dubai time. */
  cron?: string
  handler: (data: unknown) => Promise<unknown>
}

/** Every background job. Integration jobs no-op until their credentials are configured. */
export const jobs: JobDef[] = [
  // G8: liveness + disk/backup/deploy alerts (console overview turns red after 10 min without a beat).
  { name: 'worker-heartbeat', cron: '*/5 * * * *', handler: () => heartbeat() },
  { name: 'db-backup', cron: '30 3 * * *', handler: () => backupDatabase() },
  // Monthly, the day after the monthly dump (PLAN §3.5).
  { name: 'restore-drill', cron: '0 5 2 * *', handler: () => restoreDrill() },
  { name: 'analytics-rollup', cron: '7 * * * *', handler: () => rollupAnalytics() },
  { name: 'analytics-prune', cron: '20 4 * * *', handler: () => pruneAnalytics() },
  { name: 'packages-expire', cron: '10 4 * * *', handler: () => expireAllPackages() },
  { name: 'memberships-renew', cron: '25 4 * * *', handler: () => renewAllMemberships() },
  { name: 'media-prune-ai', cron: '40 4 * * *', handler: () => pruneExpiredAiImages() },
  { name: 'slot-filler', cron: '30 10,15 * * *', handler: () => runSlotFiller() },
  { name: 'verify-custom-domains', cron: '*/10 * * * *', handler: () => verifyCustomDomains() },
  { name: 'instagram-publish', cron: '*/5 * * * *', handler: () => publishScheduledInstagramPosts() },
  { name: 'instagram-reply', cron: '* * * * *', handler: () => replyToInstagramMessages() },
  { name: 'instagram-token-refresh', cron: '40 3 * * *', handler: () => refreshInstagramAccessTokens() },
  { name: 'gbp-reviews-sync', cron: '15 */2 * * *', handler: () => syncAllGbpReviews() },
  { name: 'campaigns-housekeeping', cron: '15 * * * *', handler: () => finishAllCampaigns() },
  { name: 'outbox-auto-assign', cron: '* * * * *', handler: () => autoAssignOutbox() },
  { name: 'document-reminders', cron: '0 9 * * *', handler: () => documentExpiryReminders() },
  { name: 'weekly-insights', cron: '0 8 * * 1', handler: () => weeklyInsights() },
  { name: 'daily-digest', cron: '30 9 * * *', handler: () => dailyDigest() },
  { name: 'notify-pending-bookings', cron: '*/15 * * * *', handler: () => notifyPendingBookings() },
  { name: 'notify-low-stock', cron: '15 9 * * *', handler: () => notifyLowStock() },
  { name: 'notify-ai-drafts', cron: '0 10 * * *', handler: () => notifyAiDrafts() },
  { name: 'notify-billing', cron: '20 9 * * *', handler: () => notifyBilling() },
  { name: 'notifications-prune', cron: '50 4 * * *', handler: () => pruneAllNotifications() },
  // G12: off until the owner sets the days in console Settings → Data retention.
  { name: 'tenant-auto-purge', cron: '30 4 * * *', handler: () => autoPurgeTenants() },
  // Claude MCP connector: open dynamic client registration; unapproved clients go after a day.
  { name: 'oauth-clients-prune', cron: '35 * * * *', handler: () => pruneOAuthClients() },
]
