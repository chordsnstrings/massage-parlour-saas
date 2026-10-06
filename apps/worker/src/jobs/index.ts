import { pruneAnalytics, rollupAnalytics } from './analytics'
import { backupDatabase } from './backup'
import { pruneExpiredAiImages } from './media'
import { expireAllPackages, runSlotFiller } from './tenant-jobs'

export type JobDef = {
  name: string
  /** Cron in Asia/Dubai time. */
  cron?: string
  handler: (data: unknown) => Promise<unknown>
}

/** Every background job. Social publishing and review polling join once Meta/Google access is approved. */
export const jobs: JobDef[] = [
  { name: 'db-backup', cron: '30 3 * * *', handler: () => backupDatabase() },
  { name: 'analytics-rollup', cron: '7 * * * *', handler: () => rollupAnalytics() },
  { name: 'analytics-prune', cron: '20 4 * * *', handler: () => pruneAnalytics() },
  { name: 'packages-expire', cron: '10 4 * * *', handler: () => expireAllPackages() },
  { name: 'media-prune-ai', cron: '40 4 * * *', handler: () => pruneExpiredAiImages() },
  { name: 'slot-filler', cron: '30 10,15 * * *', handler: () => runSlotFiller() },
]
