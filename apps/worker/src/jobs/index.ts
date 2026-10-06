import { pruneAnalytics, rollupAnalytics } from './analytics'
import { backupDatabase } from './backup'
import { finishAllCampaigns } from './campaigns'
import { verifyCustomDomains } from './domains'
import { syncAllGbpReviews } from './gbp'
import { publishScheduledInstagramPosts, refreshInstagramAccessTokens } from './instagram'
import { expireAllPackages, runSlotFiller } from './tenant-jobs'

export type JobDef = {
  name: string
  /** Cron in Asia/Dubai time. */
  cron?: string
  handler: (data: unknown) => Promise<unknown>
}

/** Every background job. Integration jobs no-op until their credentials are configured. */
export const jobs: JobDef[] = [
  { name: 'db-backup', cron: '30 3 * * *', handler: () => backupDatabase() },
  { name: 'analytics-rollup', cron: '7 * * * *', handler: () => rollupAnalytics() },
  { name: 'analytics-prune', cron: '20 4 * * *', handler: () => pruneAnalytics() },
  { name: 'packages-expire', cron: '10 4 * * *', handler: () => expireAllPackages() },
  { name: 'slot-filler', cron: '30 10,15 * * *', handler: () => runSlotFiller() },
  { name: 'verify-custom-domains', cron: '*/10 * * * *', handler: () => verifyCustomDomains() },
  { name: 'instagram-publish', cron: '*/5 * * * *', handler: () => publishScheduledInstagramPosts() },
  { name: 'instagram-token-refresh', cron: '40 3 * * *', handler: () => refreshInstagramAccessTokens() },
  { name: 'gbp-reviews-sync', cron: '15 */2 * * *', handler: () => syncAllGbpReviews() },
  { name: 'campaigns-finish', cron: '15 * * * *', handler: () => finishAllCampaigns() },
]
