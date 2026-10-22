// First-screen pictures inline (contract.inline, owner 2026-10-13 "no delay when I reload"): the bytes of a spa's own
// public pictures for the live page's window.CRM_DATA (@spa/core html-crm-inline; the web server caches them).
import { storedFiles, type Tx } from '@spa/db'
import { and, eq, inArray } from 'drizzle-orm'
import { HTML_DESIGN_DOC_PURPOSE } from './site-html-assets'
import { getObjectBytes, IMAGE_TYPES } from './storage'

const IMAGES = new Set<string>(IMAGE_TYPES)

/** One readable file: its bytes (db storage) or its bucket object, downloaded after the transaction. */
export type CrmInlineFileRef = { bytes: Uint8Array } | { objectKey: string }

/**
 * `tenantId`'s own public image files among `ids` of at most `maxBytes` (checked before any byte is read), one
 * transaction for all: id → ref; left out = another spa's (RLS + the tenant filter), private, a design document,
 * not an image type, or larger. Bucket objects are not downloaded here (crmInlineFileBytes, after the transaction
 * returned, so a slow bucket never holds a db connection). Callers sniff the bytes themselves (raster only).
 */
export async function crmInlineFiles(
  tx: Pick<Tx, 'select'>,
  tenantId: string,
  ids: string[],
  maxBytes: number,
): Promise<Map<string, CrmInlineFileRef>> {
  const out = new Map<string, CrmInlineFileRef>()
  if (!ids.length) return out
  const rows = await tx
    .select({
      id: storedFiles.id,
      isPublic: storedFiles.isPublic,
      purpose: storedFiles.purpose,
      size: storedFiles.size,
      contentType: storedFiles.contentType,
      storage: storedFiles.storage,
      objectKey: storedFiles.objectKey,
    })
    .from(storedFiles)
    .where(and(inArray(storedFiles.id, ids), eq(storedFiles.tenantId, tenantId)))
  const ok = rows.filter(
    (r) =>
      r.isPublic && r.purpose !== HTML_DESIGN_DOC_PURPOSE && IMAGES.has(r.contentType) && r.size <= maxBytes,
  )
  for (const r of ok) if (r.storage === 's3' && r.objectKey) out.set(r.id, { objectKey: r.objectKey })
  const inDb = ok.filter((r) => r.storage !== 's3').map((r) => r.id)
  if (!inDb.length) return out
  const bytes = await tx
    .select({ id: storedFiles.id, bytes: storedFiles.bytes })
    .from(storedFiles)
    .where(and(inArray(storedFiles.id, inDb), eq(storedFiles.tenantId, tenantId)))
  for (const r of bytes) if (r.bytes && r.bytes.length <= maxBytes) out.set(r.id, { bytes: r.bytes })
  return out
}

/** A ref's bytes: db bytes as they are, a bucket object downloaded within `timeoutMs` (null = larger than `maxBytes`). */
export async function crmInlineFileBytes(
  ref: CrmInlineFileRef | undefined,
  maxBytes: number,
  timeoutMs = 5000,
): Promise<Uint8Array | null> {
  if (!ref) return null
  if ('bytes' in ref) return ref.bytes.length <= maxBytes ? ref.bytes : null
  return getObjectBytes(ref.objectKey, { timeoutMs, maxBytes })
}
