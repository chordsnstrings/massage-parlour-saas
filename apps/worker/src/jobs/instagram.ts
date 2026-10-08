import { respondToInstagram } from '@spa/ai'
import {
  type InboundItem,
  inboundAnswered,
  publishDueInstagramPosts,
  refreshInstagramTokens,
} from '@spa/services'

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function parseItem(data: unknown): InboundItem {
  const d = (data ?? {}) as Record<string, unknown>
  const ok =
    [d.tenantId, d.conversationId, d.messageId].every((v) => typeof v === 'string' && UUID.test(v)) &&
    (d.channel === 'instagram_dm' || d.channel === 'instagram_comment') &&
    typeof d.text === 'string'
  if (!ok) throw new Error('instagram-reply: bad job data')
  return d as unknown as InboundItem
}

/**
 * One AI turn for a new inbound Instagram DM/comment, enqueued by the Meta webhook (job id = message id, so duplicates
 * are dropped). Idempotent: a thread that already has a reply/draft after the message is skipped. Errors throw so
 * pg-boss retries with backoff; after the last retry the message simply stays unread for staff.
 */
export async function replyToInstagramItem(data: unknown) {
  const item = parseItem(data)
  if (await inboundAnswered(item)) return 'answered'
  return respondToInstagram(item)
}
