import { publishDueInstagramPosts, refreshInstagramTokens } from '@spa/services'
import { recordRun } from './runs'

/**
 * Every 5 minutes: publish approved Instagram posts whose scheduled time has come.
 * Spas with the Instagram automation off are skipped (B3). No-op until META_APP_ID / META_APP_SECRET / META_WEBHOOK_VERIFY_TOKEN are set.
 */
export async function publishScheduledInstagramPosts() {
  const r = await publishDueInstagramPosts()
  if (r.attempted) console.info('instagram-publish', r)
  // Logged only when the run published (or failed) something for the spa — this job runs every 5 minutes.
  for (const [tenantId, n] of Object.entries(r.byTenant))
    await recordRun(tenantId, 'instagram-publish', n.failed ? 'failed' : 'ok', {
      count: n.published,
      failed: n.failed,
    })
  return r
}

/** Daily: refresh long-lived Instagram tokens older than 7 days; expired ones ask the spa to reconnect. */
export async function refreshInstagramAccessTokens() {
  const r = await refreshInstagramTokens()
  if (r.refreshed || r.expired || r.failed) console.info('instagram-token-refresh', r)
  return r
}
