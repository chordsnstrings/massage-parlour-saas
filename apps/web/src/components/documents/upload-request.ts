import type { Permission } from '@spa/core'
import { isScanType, MAX_FILE_BYTES } from '@spa/services'
import { guard, type MemberContext } from '@/server/access'
import { getSession } from '@/server/session'

export const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

export type ScanUpload = { ctx: MemberContext; bytes: Buffer; contentType: string; filename: string }

/**
 * Shared checks for private scan uploads (documents, receipts) posted with fetch from the dashboard:
 * same-origin, signed in, member of `slug` with `permission`, image or PDF up to 8 MB.
 * Returns the parsed upload or an error Response.
 */
export async function readScanUpload(
  req: Request,
  slug: string,
  permission: Permission,
): Promise<ScanUpload | Response> {
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origin || !host || new URL(origin).host !== host) return json(403, { ok: false, error: 'Forbidden' })
  if (Number(req.headers.get('content-length') ?? 0) > MAX_FILE_BYTES + 64 * 1024)
    return json(413, { ok: false, error: 'Files can be up to 8 MB.' })
  if (!(await getSession())) return json(401, { ok: false, error: 'Please sign in again.' })
  const { ctx, error } = await guard(slug, permission) // 404s for non-members
  if (error) return json(403, { ok: false, error })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json(400, { ok: false, error: 'Upload failed — please try again.' })
  }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return json(400, { ok: false, error: 'Choose a file.' })
  if (file.size > MAX_FILE_BYTES) return json(413, { ok: false, error: 'Files can be up to 8 MB.' })
  if (!isScanType(file.type))
    return json(415, { ok: false, error: 'Upload a photo (JPG, PNG, WebP) or a PDF.' })
  return {
    ctx,
    bytes: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
    filename: file.name.slice(0, 200),
  }
}
