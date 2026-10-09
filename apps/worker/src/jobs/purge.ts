import { platformDb } from '@spa/db'
import { autoPurgeDeletedTenants } from '@spa/services'
import { log } from '../log'
import { recordPlatformRun } from './backup'

/**
 * G12, daily: permanently purges spas soft-deleted longer ago than the console's "Auto-purge deleted spas after"
 * days. Off by default (setting blank) → recorded as skipped. Each purge also writes a `tenant_purges` row.
 */
export async function autoPurgeTenants(env: Record<string, string | undefined> = process.env) {
  const startedAt = new Date()
  const res = await autoPurgeDeletedTenants(platformDb())
  if (!res.enabled) {
    await recordPlatformRun(env, 'tenant-auto-purge', startedAt, 'skipped', { reason: 'off' })
    return res
  }
  if (res.purged.length || res.failed.length) log('info', 'tenants auto-purged', res)
  await recordPlatformRun(env, 'tenant-auto-purge', startedAt, res.failed.length ? 'failed' : 'ok', res)
  return res
}
