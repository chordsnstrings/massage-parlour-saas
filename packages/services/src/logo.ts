// Spa logo (docs/PLAN.md §14.6): a public stored file referenced by `tenants.logo_file_id`, shown in the dashboard
// sidebar. Uploaded at sign-up (optional) or in Settings › Business.
import { type Tx, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import { fileUrl, type ProcessedImage, processImage } from './media'
import { putFile } from './storage'

/** Logos show small (sidebar tile, later receipts / site header): 512 px keeps them crisp and light. */
export const LOGO_MAX_EDGE = 512

/** Validates and re-encodes an uploaded logo (sniffed type, metadata stripped, WebP). Run before opening a tx. */
export const processLogo = (input: Buffer) => processImage(input, { maxEdge: LOGO_MAX_EDGE, quality: 90 })

export const logoUrl = (fileId: string | null | undefined) => (fileId ? fileUrl(fileId) : null)

/**
 * Stores the logo as a public file and points the tenant at it (inside the caller's tenant tx). A replaced logo's
 * file is kept: its public URL may already be used elsewhere (e.g. copied into the site by the studio).
 */
export async function setTenantLogo(
  tx: Tx,
  a: { tenantId: string; image: Pick<ProcessedImage, 'bytes' | 'contentType'>; createdBy?: string | null },
) {
  const file = await putFile(tx, {
    tenantId: a.tenantId,
    bytes: a.image.bytes,
    contentType: a.image.contentType,
    filename: 'logo.webp',
    isPublic: true,
    purpose: 'logo',
    createdBy: a.createdBy ?? null,
  })
  await tx.update(tenants).set({ logoFileId: file.id }).where(eq(tenants.id, a.tenantId))
  return { fileId: file.id, url: fileUrl(file.id) }
}

export async function clearTenantLogo(tx: Tx, tenantId: string) {
  await tx.update(tenants).set({ logoFileId: null }).where(eq(tenants.id, tenantId))
}
