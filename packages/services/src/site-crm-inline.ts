// First-screen pictures inline (contract.inline, owner 2026-10-13 "no delay when I reload"): the bytes of a spa's own
// public picture for the live page's window.CRM_DATA (@spa/core html-crm-inline; the web server caches them).
import { storedFiles, type Tx } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { HTML_DESIGN_DOC_PURPOSE } from './site-html-assets'
import { getFile, IMAGE_TYPES } from './storage'

const IMAGES = new Set<string>(IMAGE_TYPES)

/**
 * The bytes of `tenantId`'s own public image file `id` of at most `maxBytes` (checked before any download), or null:
 * another spa's (RLS + the tenant filter), private, a design document, not an image type, or larger. Callers sniff
 * the bytes themselves (raster only).
 */
export async function crmInlineFile(
  tx: Pick<Tx, 'select'>,
  tenantId: string,
  id: string,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const [row] = await tx
    .select({
      isPublic: storedFiles.isPublic,
      purpose: storedFiles.purpose,
      size: storedFiles.size,
      contentType: storedFiles.contentType,
    })
    .from(storedFiles)
    .where(and(eq(storedFiles.id, id), eq(storedFiles.tenantId, tenantId)))
    .limit(1)
  if (
    !row?.isPublic ||
    row.purpose === HTML_DESIGN_DOC_PURPOSE ||
    !IMAGES.has(row.contentType) ||
    row.size > maxBytes
  )
    return null
  const file = await getFile(tx, id)
  return file && file.bytes.length <= maxBytes ? file.bytes : null
}
