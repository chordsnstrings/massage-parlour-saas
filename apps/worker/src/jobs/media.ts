import { mediaAssets, platformDb, withTenant } from '@spa/db'
import { AI_LINK_TTL_MS, pruneExpiredAiLinks } from '@spa/services'
import { and, eq, isNull, lt, notLike } from 'drizzle-orm'
import { log } from '../log'

/**
 * Daily: AI images that were never copied into the library (the web app persists them when a draft is made or
 * approved; the library offers "Save to library") stop loading once the generator's 7-day link expires —
 * remove those dead rows so the library never shows broken tiles. No image processing happens here.
 */
export async function pruneExpiredAiImages() {
  const cutoff = new Date(Date.now() - AI_LINK_TTL_MS)
  // Platform lookup only to find which tenants have work; the delete runs inside each tenant's RLS scope.
  const affected = await platformDb()
    .selectDistinct({ tenantId: mediaAssets.tenantId })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.source, 'ai'),
        isNull(mediaAssets.fileId),
        notLike(mediaAssets.url, '/files/%'),
        lt(mediaAssets.createdAt, cutoff),
      ),
    )
  let total = 0
  for (const { tenantId } of affected) {
    try {
      const n = await withTenant(tenantId, (tx) => pruneExpiredAiLinks(tx))
      total += n
    } catch (error) {
      log('error', 'media prune failed', { tenantId, error: String(error) })
    }
  }
  if (total) log('info', 'expired AI image links pruned', { tenants: affected.length, rows: total })
  return total
}
