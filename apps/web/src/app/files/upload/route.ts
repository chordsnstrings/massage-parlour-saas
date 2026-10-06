import { withTenant } from '@spa/db'
import { createAsset, DomainError, MAX_UPLOAD_BYTES, processImage } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'
import { getSession } from '@/server/session'

/**
 * POST /files/upload (multipart: tenant, file[, tags]) — one image per request so the browser can show
 * per-file progress. Lives under /files (not the dashboard) so proxy.ts doesn't buffer the body (10 MB cap);
 * the session, tenant membership and `site.content` are re-checked here.
 */
const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const Fields = z.object({
  tenant: z.string().trim().min(1).max(63),
  tags: z.string().max(200).optional(),
})

export async function POST(req: Request) {
  // Same-origin only (the dashboard calls this with fetch/XHR, which always sends Origin on POST).
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origin || !host || new URL(origin).host !== host) return json(403, { ok: false, error: 'Forbidden' })
  if (Number(req.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024)
    return json(413, { ok: false, error: 'Images can be up to 20 MB' })
  if (!(await getSession())) return json(401, { ok: false, error: 'Please sign in again.' })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json(400, { ok: false, error: 'Upload failed — please try again.' })
  }
  const fields = Fields.safeParse({
    tenant: form.get('tenant'),
    tags: form.get('tags') ?? undefined,
  })
  const file = form.get('file')
  if (!fields.success || !(file instanceof File))
    return json(400, { ok: false, error: 'Choose an image to upload.' })

  const { ctx, error } = await guard(fields.data.tenant, 'site.content') // 404s for non-members
  if (error) return json(403, { ok: false, error })
  if (file.size > MAX_UPLOAD_BYTES) return json(413, { ok: false, error: 'Images can be up to 20 MB' })

  try {
    // Re-encode before opening the transaction (CPU work shouldn't hold a DB connection).
    const image = await processImage(Buffer.from(await file.arrayBuffer()))
    const asset = await withTenant(ctx.tenant.id, (tx) =>
      createAsset(tx, {
        tenantId: ctx.tenant.id,
        image,
        source: 'upload',
        filename: file.name,
        tags: fields.data.tags?.split(',') ?? [],
        createdBy: ctx.user.id,
      }),
    )
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'media.uploaded',
      entity: 'media_asset',
      entityId: asset.id,
      data: { filename: asset.filename, bytes: asset.bytes, width: asset.width, height: asset.height },
    })
    revalidatePath(`/dashboard/${ctx.tenant.slug}/media`)
    return json(200, {
      ok: true,
      asset: {
        id: asset.id,
        url: asset.url,
        width: asset.width,
        height: asset.height,
        bytes: asset.bytes,
        alt: asset.alt,
        source: asset.source,
        tags: asset.tags,
        filename: asset.filename,
        createdAt: asset.createdAt,
      },
    })
  } catch (e) {
    if (e instanceof DomainError) return json(422, { ok: false, error: e.message })
    console.error('media upload failed', e)
    return json(500, { ok: false, error: 'Upload failed — please try again.' })
  }
}
