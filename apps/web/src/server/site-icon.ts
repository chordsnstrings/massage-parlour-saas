import { resolveSurface } from '@spa/core'
import { fileUrl } from '@spa/services'
import { PATH_ROUTING } from '@/lib/paths'
import { platformRoots } from '@/server/origin'
import { pwaTenant } from '@/server/pwa'
import { resolveSiteTenant } from '@/server/sites'

type SiteKey = { slug: string } | { hostname: string }

/** The spa site a Host serves, by proxy.ts's rules (host routing: `{slug}.{root}`; both modes: a custom domain). */
function siteKeyOf(hostHeader: string): SiteKey | null {
  const host = hostHeader.trim().toLowerCase()
  if (!PATH_ROUTING) {
    const s = resolveSurface(host, platformRoots())
    return s.kind === 'site' ? { slug: s.slug } : s.kind === 'custom' ? { hostname: s.hostname } : null
  }
  const bare = host.split(':')[0]!.replace(/\.+$/, '')
  const roots = platformRoots().map((r) => r.split(':')[0]!)
  return bare &&
    !roots.includes(bare) &&
    bare !== 'localhost' &&
    !/^[\d.]+$/.test(bare) &&
    !bare.includes('[')
    ? { hostname: bare }
    : null
}

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' },
  })

/**
 * M11 (QA 2026-10-14): GET /favicon.ico and /apple-touch-icon.png, which browsers and link previews ask a site for
 * without reading its page (the proxy never rewrites them, so they land here on every host). A spa's own host
 * (subdomain or custom domain; block sites and HTML designs alike) → 302 to the spa logo on that host (`/files/{id}`,
 * public, the same file the page's icon links name); the platform's hosts and spas without a logo → 404, as before.
 */
export async function siteIcon(req: Request): Promise<Response> {
  const key = siteKeyOf(req.headers.get('host') ?? '')
  const site = key ? await resolveSiteTenant(key) : null
  // pwaTenant: the cookie-free, cached logo lookup the spa's app icons use.
  const logo = site ? (await pwaTenant(site.slug))?.logoFileId : null
  if (!logo) return notFound()
  return new Response(null, {
    status: 302,
    headers: { location: fileUrl(logo), 'cache-control': 'public, max-age=300' },
  })
}
