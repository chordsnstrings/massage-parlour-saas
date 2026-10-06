import { backupDatabase } from './backup'

export type JobDef = {
  name: string
  /** Cron in Asia/Dubai time. */
  cron?: string
  handler: (data: unknown) => Promise<unknown>
}

/** Every background job. Later phases add AI agents, social publishing, review polling, rollups. */
export const jobs: JobDef[] = [{ name: 'db-backup', cron: '30 3 * * *', handler: () => backupDatabase() }]
