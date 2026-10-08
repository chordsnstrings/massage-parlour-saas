import { INSTAGRAM_REPLY_QUEUE, INSTAGRAM_REPLY_RETRY } from '@spa/services'
import type { Queue } from 'pg-boss'
import { pruneAnalytics, rollupAnalytics } from './analytics'
import { backupDatabase } from './backup'
import { finishAllCampaigns } from './campaigns'
import { verifyCustomDomains } from './domains'
import { dailyDigest, documentExpiryReminders, weeklyInsights } from './engage'
import { syncAllGbpReviews } from './gbp'
import {
  publishScheduledInstagramPosts,
  refreshInstagramAccessTokens,
  replyToInstagramItem,
} from './instagram'
import { pruneExpiredAiImages } from './media'
import { restoreDrill } from './restore-drill'
import { expireAllPackages, runSlotFiller } from './tenant-jobs'

export type JobDef = {
  name: string
  /** Cron in Asia/Dubai time. */
  cron?: string
  handler: (data: unknown) => Promise<unknown>
  /** Queue options (retries/backoff) for jobs other code enqueues. */
  queue?: Omit<Queue, 'name'>
}

/** Every background job. Integration jobs no-op until their credentials are configured. */
export const jobs: JobDef[] = [
  { name: 'db-backup', cron: '30 3 * * *', handler: () => backupDatabase() },
  // Monthly, the day after the monthly dump (PLAN §3.5).
  { name: 'restore-drill', cron: '0 5 2 * *', handler: () => restoreDrill() },
  { name: 'analytics-rollup', cron: '7 * * * *', handler: () => rollupAnalytics() },
  { name: 'analytics-prune', cron: '20 4 * * *', handler: () => pruneAnalytics() },
  { name: 'packages-expire', cron: '10 4 * * *', handler: () => expireAllPackages() },
  { name: 'media-prune-ai', cron: '40 4 * * *', handler: () => pruneExpiredAiImages() },
  { name: 'slot-filler', cron: '30 10,15 * * *', handler: () => runSlotFiller() },
  { name: 'verify-custom-domains', cron: '*/10 * * * *', handler: () => verifyCustomDomains() },
  { name: 'instagram-publish', cron: '*/5 * * * *', handler: () => publishScheduledInstagramPosts() },
  { name: INSTAGRAM_REPLY_QUEUE, handler: replyToInstagramItem, queue: { ...INSTAGRAM_REPLY_RETRY } },
  { name: 'instagram-token-refresh', cron: '40 3 * * *', handler: () => refreshInstagramAccessTokens() },
  { name: 'gbp-reviews-sync', cron: '15 */2 * * *', handler: () => syncAllGbpReviews() },
  { name: 'campaigns-housekeeping', cron: '15 * * * *', handler: () => finishAllCampaigns() },
  { name: 'document-reminders', cron: '0 9 * * *', handler: () => documentExpiryReminders() },
  { name: 'weekly-insights', cron: '0 8 * * 1', handler: () => weeklyInsights() },
  { name: 'daily-digest', cron: '30 9 * * *', handler: () => dailyDigest() },
]
