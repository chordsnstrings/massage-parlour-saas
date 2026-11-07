import { mediaAssets, platformDb, storedFiles, withTenant } from '@spa/db'
import {
  AI_LINK_TTL_MS,
  HTML_DESIGN_DOC_KEEP_MS,
  HTML_DESIGN_DOC_PURPOSE,
  pruneExpiredAiLinks,
  pruneUnusedHtmlDesignDocs,
} from '@spa/services'
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

/**
 * R24 review, daily: a spa's HTML design documents that no page version, template-switch undo or saved section
 * references any more (every changed design is a new file) are deleted after the keep period. Platform lookup only
 * to find the spas; the check and the delete run inside each spa's RLS scope (services pruneUnusedHtmlDesignDocs).
 */
export async function pruneUnusedHtmlDesigns(now = new Date()) {
  const affected = await platformDb()
    .selectDistinct({ tenantId: storedFiles.tenantId })
    .from(storedFiles)
    .where(
      and(
        eq(storedFiles.purpose, HTML_DESIGN_DOC_PURPOSE),
        lt(storedFiles.createdAt, new Date(now.getTime() - HTML_DESIGN_DOC_KEEP_MS)),
      ),
    )
  let total = 0
  for (const { tenantId } of affected) {
    try {
      total += await withTenant(tenantId, (tx) => pruneUnusedHtmlDesignDocs(tx, tenantId, now))
    } catch (error) {
      log('error', 'html design prune failed', { tenantId, error: String(error) })
    }
  }
  if (total) log('info', 'unused html design documents deleted', { tenants: affected.length, files: total })
  return total
}
