import { publishDueInstagramPosts, refreshInstagramTokens } from '@spa/services'

/**
 * Every 5 minutes: publish approved Instagram posts whose scheduled time has come.
 * No-op until META_APP_ID / META_APP_SECRET / META_WEBHOOK_VERIFY_TOKEN are set.
 */
export async function publishScheduledInstagramPosts() {
  const r = await publishDueInstagramPosts()
  if (r.attempted) console.info('instagram-publish', r)
  return r
}

/** Daily: refresh long-lived Instagram tokens older than 7 days; expired ones ask the spa to reconnect. */
export async function refreshInstagramAccessTokens() {
  const r = await refreshInstagramTokens()
  if (r.refreshed || r.expired || r.failed) console.info('instagram-token-refresh', r)
  return r
}
