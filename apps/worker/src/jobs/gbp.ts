import { draftReviewReply } from '@spa/ai'
import { platformDb, socialAccounts, tenants } from '@spa/db'
import { GBP_PENDING_ID, googleConfig, syncGbpReviews } from '@spa/services'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { log } from '../log'

/**
 * Every 2 hours: pull Google reviews for each spa with a connected Business Profile location. New reviews get an AI
 * draft when the review agent is on; autopilot posts 4–5★ replies, 1–3★ wait for approval in the dashboard.
 */
export async function syncAllGbpReviews() {
  if (!googleConfig()) return { skipped: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set' }
  const connected = await platformDb()
    .select({ tenantId: socialAccounts.tenantId, slug: tenants.slug })
    .from(socialAccounts)
    .innerJoin(tenants, eq(tenants.id, socialAccounts.tenantId))
    .where(
      and(
        eq(socialAccounts.platform, 'gbp'),
        eq(socialAccounts.status, 'connected'),
        ne(socialAccounts.externalId, GBP_PENDING_ID),
        inArray(tenants.status, ['trial', 'active', 'past_due']),
      ),
    )
  let synced = 0
  for (const { tenantId, slug } of connected) {
    try {
      const res = await syncGbpReviews({
        tenantId,
        draft: (reviewId) => draftReviewReply({ tenantId, reviewId }),
      })
      if (res.ok) {
        synced++
        if (res.created || res.posted || res.failed)
          log('info', 'gbp reviews synced', {
            tenant: slug,
            created: res.created,
            drafted: res.drafted,
            posted: res.posted,
            failed: res.failed,
          })
      } else {
        log('warn', 'gbp review sync failed', { tenant: slug, error: res.error })
      }
    } catch (error) {
      log('error', 'gbp review sync crashed', {
        tenant: slug,
        error: error instanceof Error ? error.message : 'unexpected error',
      })
    }
  }
  return { tenants: connected.length, synced }
}
