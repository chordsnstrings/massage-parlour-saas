import { members, platformDb, storedFiles, withTenant } from '@spa/db'
import { getFile, IMAGE_TYPES, jpegVariant, resizeVariant, VARIANT_WIDTHS } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { isPlatformAdmin } from '@/server/access'
import { getSession } from '@/server/session'

/**
 * GET /files/{id}[/{name}][?w=480][&f=jpg] on every host (app, tenant subdomain, /s/{slug} path routing, custom domains;
 * proxy.ts lets /files/* through untouched).
 *  - public files (site images): anyone, `public, max-age=1y, immutable` + ETag — a file id never changes content.
 *  - private files (receipts, documents): a signed-in active member of the file's tenant (or a super-admin),
 *    `Cache-Control: private, no-cache` so every reuse re-checks access (cheap 304s via ETag).
 * `?f=jpg` renders a JPEG copy of an image (Instagram's publishing API only accepts JPEG).
 * The platform lookup only decides access; the bytes are then read inside the file's tenant RLS scope.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IMAGES = new Set<string>(IMAGE_TYPES)
const INLINE = new Set<string>([...IMAGE_TYPES, 'application/pdf'])

// Rendered thumbnails, so a busy library page doesn't re-run sharp per tile (browsers and the edge cache them too).
const g = globalThis as unknown as { __spaVariants?: LRUCache<string, Buffer> }
if (!g.__spaVariants)
  g.__spaVariants = new LRUCache<string, Buffer>({
    maxSize: 48 * 1024 * 1024,
    sizeCalculation: (b) => b.length || 1,
  })
const variants = g.__spaVariants

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' },
  })

async function canRead(tenantId: string) {
  const session = await getSession()
  if (!session) return false
  const userId = session.user.id
  const [m] = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.userId, userId), eq(members.status, 'active')))
      .limit(1),
  )
  return Boolean(m) || (await isPlatformAdmin(userId))
}

const asciiName = (name: string) => name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file'

export async function serveFile(req: Request, id: string) {
  if (!UUID.test(id)) return notFound()
  const [meta] = await platformDb()
    .select({
      tenantId: storedFiles.tenantId,
      isPublic: storedFiles.isPublic,
      contentType: storedFiles.contentType,
      filename: storedFiles.filename,
    })
    .from(storedFiles)
    .where(eq(storedFiles.id, id))
    .limit(1)
  if (!meta) return notFound()
  if (!meta.isPublic && !(await canRead(meta.tenantId))) return notFound()

  const params = new URL(req.url).searchParams
  const isImage = IMAGES.has(meta.contentType)
  const wParam = Number(params.get('w'))
  const width = isImage ? (VARIANT_WIDTHS as readonly number[]).find((w) => w === wParam) : undefined
  const jpeg = isImage && params.get('f') === 'jpg' && (meta.contentType !== 'image/jpeg' || Boolean(width))
  const etag = `"${id}${width ? `-w${width}` : ''}${jpeg ? '-jpg' : ''}"`
  const cacheControl = meta.isPublic ? 'public, max-age=31536000, immutable' : 'private, no-cache'
  const headers: Record<string, string> = {
    etag,
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
    // Even if a stored file were HTML/SVG, it can't run script on our origin.
    'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    'cross-origin-resource-policy': 'cross-origin',
  }
  if (!meta.isPublic) headers.vary = 'Cookie'
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })

  const file = await withTenant(meta.tenantId, (tx) => getFile(tx, id))
  if (!file) return notFound()

  let body = file.bytes
  let type = file.contentType
  if (width || jpeg) {
    const key = `${id}:${width ?? 0}:${jpeg ? 'jpg' : 'webp'}`
    let hit = variants.get(key)
    if (!hit) {
      try {
        hit = jpeg ? await jpegVariant(file.bytes, width) : await resizeVariant(file.bytes, width!)
        variants.set(key, hit)
      } catch {
        hit = undefined // undecodable → fall back to the original
      }
    }
    if (hit) {
      body = hit
      type = jpeg ? 'image/jpeg' : 'image/webp'
    }
  }
  let name = file.filename ? asciiName(file.filename) : null
  if (name && jpeg && type === 'image/jpeg') name = `${name.replace(/\.[a-z0-9]{2,5}$/i, '')}.jpg`
  headers['content-type'] = type
  headers['content-length'] = String(body.length)
  headers['content-disposition'] =
    `${INLINE.has(type) ? 'inline' : 'attachment'}${name ? `; filename="${name}"` : ''}`
  return new Response(req.method === 'HEAD' ? null : new Uint8Array(body), { status: 200, headers })
}
