import { withTenant } from '@spa/db'
import { createAsset, DomainError, MAX_UPLOAD_BYTES, processImage } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getT } from '@/i18n/server'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'
import { getSession } from '@/server/session'

/**
 * POST /files/upload?tenant={slug} (multipart: file[, tags]) — one image per request so the browser can show
 * per-file progress. Lives under /files (not the dashboard) so proxy.ts doesn't buffer the body (10 MB cap).
 * The session, tenant membership and `site.content` are checked before the body is read, and the body is
 * streamed through a byte counter (Content-Length is optional behind proxies), so nobody can push an unbounded
 * upload into memory.
 */
const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const Tenant = z.string().trim().min(1).max(63)
const Tags = z.string().max(200).optional()
/** Multipart overhead allowed on top of the image itself. */
const BODY_LIMIT = MAX_UPLOAD_BYTES + 64 * 1024

class TooLarge extends Error {}

/** Parses the multipart body, aborting as soon as more than `limit` bytes have arrived. */
function readForm(req: Request, limit: number) {
  if (!req.body) return req.formData()
  let total = 0
  const counted = req.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        total += chunk.byteLength
        if (total > limit) ctrl.error(new TooLarge())
        else ctrl.enqueue(chunk)
      },
    }),
  )
  return new Response(counted, { headers: { 'content-type': req.headers.get('content-type') ?? '' } })
    .formData()
    .catch((e) => {
      throw total > limit ? new TooLarge() : e
    })
}

export async function POST(req: Request) {
  // Same-origin only (the dashboard calls this with fetch/XHR, which always sends Origin on POST).
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origin || !host || new URL(origin).host !== host) return json(403, { ok: false, error: 'Forbidden' })
  const t = await getT()
  const tooLarge = t('errors.file.imageTooLarge', { size: '20 MB' })
  if (Number(req.headers.get('content-length') ?? 0) > BODY_LIMIT)
    return json(413, { ok: false, error: tooLarge })
  if (!(await getSession())) return json(401, { ok: false, error: t('errors.signInAgain') })
  const tenant = Tenant.safeParse(new URL(req.url).searchParams.get('tenant'))
  if (!tenant.success) return json(400, { ok: false, error: t('errors.file.uploadFailed') })
  const { ctx, error } = await guard(tenant.data, 'site.content') // 404s for non-members
  if (error) return json(403, { ok: false, error })

  let form: FormData
  try {
    form = await readForm(req, BODY_LIMIT)
  } catch (e) {
    if (e instanceof TooLarge) return json(413, { ok: false, error: tooLarge })
    return json(400, { ok: false, error: t('errors.file.uploadFailed') })
  }
  const tags = Tags.safeParse(form.get('tags') ?? undefined)
  const file = form.get('file')
  if (!tags.success || !(file instanceof File))
    return json(400, { ok: false, error: t('errors.file.choose') })
  if (file.size > MAX_UPLOAD_BYTES) return json(413, { ok: false, error: tooLarge })

  try {
    // Re-encode before opening the transaction (CPU work shouldn't hold a DB connection).
    const image = await processImage(Buffer.from(await file.arrayBuffer()))
    const asset = await withTenant(ctx.tenant.id, (tx) =>
      createAsset(tx, {
        tenantId: ctx.tenant.id,
        image,
        source: 'upload',
        filename: file.name,
        tags: tags.data?.split(',') ?? [],
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
    if (e instanceof DomainError)
      return json(422, { ok: false, error: t.maybe(e.i18n?.key, e.i18n?.params) ?? e.message })
    console.error('media upload failed', e)
    return json(500, { ok: false, error: t('errors.file.uploadFailed') })
  }
}
