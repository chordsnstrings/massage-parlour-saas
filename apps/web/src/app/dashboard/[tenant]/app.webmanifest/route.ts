import { createHash } from 'node:crypto'
import { pwaManifest, pwaTenant } from '@/server/pwa'

/**
 * GET {dashboard}/app.webmanifest — the spa's installable-app manifest (docs/PLAN.md §18.6). Public: browsers fetch
 * manifests without cookies, and it only carries the spa's name and icon links (both shown on its public site).
 */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const tenant = await pwaTenant((await params).tenant)
  if (!tenant)
    return new Response('Not found', {
      status: 404,
      headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' },
    })
  const body = JSON.stringify(pwaManifest(tenant))
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 22)}"`
  // Short cache: a renamed spa or a new logo reaches installed apps within minutes (icons themselves are immutable).
  const headers = { etag, 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' }
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
  return new Response(body, {
    headers: { ...headers, 'content-type': 'application/manifest+json; charset=utf-8' },
  })
}
