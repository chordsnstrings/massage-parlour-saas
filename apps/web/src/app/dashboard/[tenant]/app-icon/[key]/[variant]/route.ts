import { isIconVariant, pwaFor, pwaTenant } from '@/server/pwa'
import { appIcon } from '@/server/pwa-icons'

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' },
  })

/**
 * GET {dashboard}/app-icon/{key}/{192|512|maskable-512|apple-180} — PNG app icon from the spa's logo (or initials),
 * docs/PLAN.md §18.6. Public and cookie-free like the manifest; exposes only the logo-derived image. The key changes
 * with the logo file (and ICON_VERSION), so a current key is cached for a year; an old key gets today's icon, briefly.
 * When the logo can't be read right now, the initials stand in uncached (no-store, no ETag), so the next fetch heals.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ tenant: string; key: string; variant: string }> },
) {
  const { tenant: slug, key, variant } = await params
  if (!isIconVariant(variant) || !/^[\w-]{16}$/.test(key)) return notFound()
  let tenant = await pwaTenant(slug)
  // A key we don't know yet may be a logo changed in the last few seconds: read the spa again (at most every few
  // seconds per spa, so made-up keys can't bypass the cache).
  if (tenant && pwaFor(tenant).key !== key) tenant = await pwaTenant(slug, { fresh: true })
  if (!tenant) return notFound()
  const currentKey = pwaFor(tenant).key
  const etag = `"${currentKey}-${variant}"`
  const nosniff = { 'x-content-type-options': 'nosniff' }
  const cached = {
    ...nosniff,
    etag,
    'cache-control': currentKey === key ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
  }
  // Only the real icon ever carries this ETag, so a match means the client holds it.
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: cached })
  const { png, fallback } = await appIcon(tenant, variant)
  const headers = fallback ? { ...nosniff, 'cache-control': 'no-store' } : cached
  return new Response(new Uint8Array(png), {
    headers: { ...headers, 'content-type': 'image/png', 'content-length': String(png.length) },
  })
}
