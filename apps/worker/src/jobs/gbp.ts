import { draftReviewReply } from '@spa/ai'
import { platformDb, socialAccounts, tenants } from '@spa/db'
import {
  automationOnSql,
  GBP_PENDING_ID,
  googleConfig,
  submitDueSitemaps,
  syncGbpBookActions,
  syncGbpReviews,
} from '@spa/services'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { log } from '../log'
import { LIVE_STATUSES, recordRun } from './runs'

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
        inArray(tenants.status, [...LIVE_STATUSES]),
        automationOnSql('googleReviews'),
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
        await recordRun(tenantId, 'gbp-reviews-sync', 'ok', { count: res.created, posted: res.posted })
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
        await recordRun(tenantId, 'gbp-reviews-sync', 'failed')
      }
    } catch (error) {
      log('error', 'gbp review sync crashed', {
        tenant: slug,
        error: error instanceof Error ? error.message : 'unexpected error',
      })
      await recordRun(tenantId, 'gbp-reviews-sync', 'failed')
    }
  }
  return { tenants: connected.length, synced }
}

/**
 * Every 10 minutes (F17): re-points Google "Book" buttons whose booking address changed (custom domain added, made
 * primary or removed) and retries failed ones every 6 h; sends Search Console sitemaps queued by a publish (a couple
 * of minutes after the last one). Premium spas only; DB reads only unless something changed.
 */
export async function syncGbpSite() {
  if (!googleConfig()) return { skipped: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set' }
  const book = await syncGbpBookActions()
  const sitemaps = await submitDueSitemaps()
  if (book.updated || book.failed || sitemaps.submitted || sitemaps.notSubmitted)
    log('info', 'gbp site sync', { ...book, ...sitemaps })
  return { book, sitemaps }
}
