import { respondToInstagram } from '@spa/ai'
import {
  claimDueReplies,
  failReply,
  finishReply,
  inboundAnswered,
  publishDueInstagramPosts,
  refreshInstagramTokens,
  tenantsWithDueReplies,
} from '@spa/services'
import { log } from '../log'
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

/**
 * Every minute (`instagram-reply`): AI turns for new inbound Instagram DMs/comments. The Meta webhook only stores the
 * message and its `instagram_reply_queue` row (same transaction); this job claims due rows per spa, skips threads
 * that already have a reply/draft after the message (idempotent), answers, and deletes the row. A failure backs off
 * (30 s → 30 min) and gives up after 5 tries — the message then simply stays unread for staff.
 */
export async function replyToInstagramMessages(now = new Date()) {
  let answered = 0
  let failed = 0
  for (const tenantId of await tenantsWithDueReplies(now)) {
    for (const { item, attempts } of await claimDueReplies(tenantId, now)) {
      try {
        if (!(await inboundAnswered(item))) await respondToInstagram(item)
        await finishReply(item)
        answered++
      } catch (e) {
        failed++
        // No tokens are ever part of these errors.
        const error = e instanceof Error ? e.message : 'unknown error'
        const r = await failReply(item, attempts, error, now)
        log('error', 'instagram-reply failed', { tenantId, attempts: r.attempts, gaveUp: r.failed, error: error.slice(0, 200) })
      }
    }
  }
  return { answered, failed }
}
