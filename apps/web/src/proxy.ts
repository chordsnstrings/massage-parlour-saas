import {
  canonicalScheme,
  hostRoutedUrl,
  newNonce,
  pageSecurityHeaders,
  parseRoots,
  pathRoutedAddress,
  platformOnlyPath,
  resolveSurface,
} from '@spa/core'
import { type NextRequest, NextResponse } from 'next/server'
import { ownDomainTarget } from '@/server/own-domain'
import { currentSlugFor, movedSlugTarget } from '@/server/slug-redirect'

const PATH_ROUTING = process.env.NEXT_PUBLIC_ROUTING === 'path'
/** Platform domains: ROOT_DOMAIN (canonical) plus EXTRA_ROOT_DOMAINS — every one serves the whole platform. */
const ROOTS = parseRoots(process.env.ROOT_DOMAIN ?? 'localhost:3000', process.env.EXTRA_ROOT_DOMAINS)
const BARE_ROOTS = ROOTS.map((r) => r.split(':')[0]!)

/** A spa's custom domain (only ever serves that spa's public site): its bare hostname, else null (a platform host). */
function customHost(host: string): string | null {
  if (!PATH_ROUTING) {
    const surface = resolveSurface(host, ROOTS)
    return surface.kind === 'custom' ? surface.hostname : null
  }
  // Single-host mode: the platform lives on its domains (or a bare IP / localhost); any other host is a custom domain.
  const bare = host.split(':')[0]!.toLowerCase().replace(/\.+$/, '')
  return bare &&
    !BARE_ROOTS.includes(bare) &&
    bare !== 'localhost' &&
    !/^[\d.]+$/.test(bare) &&
    !bare.includes('[')
    ? bare
    : null
}

/** Maps a public request to an internal route prefix. See lib/paths.ts for the two routing modes. */
function internalPath(host: string, pathname: string): string {
  const tail = (p: string) => (p === '/' ? '' : p)
  if (PATH_ROUTING) {
    const custom = customHost(host)
    if (custom) return `/domain/${custom}${tail(pathname)}`
    const m = pathname.match(/^\/(app|admin|s)(?=\/|$)(\/[^/]+)?(.*)$/)
    if (m?.[1] === 'app') return `/dashboard${tail(`${m[2] ?? ''}${m[3] ?? ''}` || '/')}`
    if (m?.[1] === 'admin') return `/platform${tail(`${m[2] ?? ''}${m[3] ?? ''}` || '/')}`
    if (m?.[1] === 's' && m[2]) return `/site${m[2]}${m[3] ?? ''}`
    return `/marketing${tail(pathname)}`
  }
  const surface = resolveSurface(host, ROOTS)
  const prefix =
    surface.kind === 'marketing'
      ? '/marketing'
      : surface.kind === 'app'
        ? '/dashboard'
        : surface.kind === 'admin'
          ? '/platform'
          : surface.kind === 'site'
            ? `/site/${surface.slug}`
            : `/domain/${surface.hostname}`
  return `${prefix}${tail(pathname)}`
}

const DEV = process.env.NODE_ENV === 'development'

/**
 * One Next.js app serves every surface; this rewrites paths and sets the page security headers (F10): a fresh CSP nonce
 * per request, passed to the render in the request's own `Content-Security-Policy` (Next reads the nonce from it and
 * stamps its scripts) and `x-nonce` (our inline scripts, server/nonce.ts). Pages re-check tenant and permissions.
 */
export async function proxy(req: NextRequest) {
  const host = req.headers.get('host') ?? ''
  // R20: the matcher's platform-only entries (sign-in API, OAuth discovery, MCP, integrations) — a 404 on a spa's custom
  // domain, which serves only that spa's public site; passed through untouched (no rewrite, no page headers) elsewhere.
  if (platformOnlyPath(req.nextUrl.pathname))
    return customHost(host) ? new NextResponse('Not found', { status: 404 }) : NextResponse.next()
  // `example.ae.` is the same host as `example.ae`: send it to the canonical spelling so sign-in, cookies and links all
  // see one host (otherwise the dotted host would show pages it can't sign in on).
  if (/\.(:\d+)?$/.test(host)) {
    const proto =
      req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || req.nextUrl.protocol.replace(':', '')
    const fixed = host.replace(/\.+(?=:\d+$|$)/, '')
    return NextResponse.redirect(`${proto}://${fixed}${req.nextUrl.pathname}${req.nextUrl.search}`, 308)
  }
  // Host routing only (null under path routing, which still serves them): an address from the path-routing days
  // (`/app/…`, `/admin/…`, `/s/{slug}/…` on any platform domain or its www.: shared links, invites, QR posters, widget
  // snippets, installed apps) → the same rest of the path + query on `app.` / `admin.` / `{slug}.` of the canonical
  // domain, one hop (a renamed spa's slug resolves to the current one, F23). GET/HEAD 301 (like F23); any other method
  // 308, which keeps the method and body (a 301 may turn a POST into a GET). Short browser cache: a later rename or a
  // switch back to path routing takes effect within minutes.
  const safe = req.method === 'GET' || req.method === 'HEAD'
  const old = pathRoutedAddress(host, req.nextUrl.pathname, ROOTS, { pathRouting: PATH_ROUTING })
  if (old) {
    // R20: a spa site with its own domain primary goes straight there (one hop), as below.
    const own =
      safe && old.surface === 'site'
        ? await ownDomainTarget(`/site/${old.slug}${old.rest}`, req.nextUrl.search)
        : null
    const current = old.slug ? await currentSlugFor(old.slug) : null
    const target =
      own ??
      `${hostRoutedUrl(old, ROOTS[0]!, canonicalScheme(ROOTS[0]!, process.env.APP_URL), current)}${req.nextUrl.search}`
    const res = NextResponse.redirect(target, safe ? 301 : 308)
    res.headers.set('cache-control', 'private, max-age=300')
    return res
  }
  const url = req.nextUrl.clone()
  const originalPath = url.pathname
  url.pathname = internalPath(host, originalPath)
  const proto =
    req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || req.nextUrl.protocol.replace(':', '')
  if (safe) {
    // R20: the spa's own domain is active + primary → its temporary address ({slug}.{any platform root}, /s/{slug}) 301s
    // there, path + query kept, one hop (a renamed slug too). Not: other methods (forms/server actions started here),
    // the widget iframe /book/embed, robots.txt; /api, /files, _next and static files never reach the proxy. Short
    // browser cache, like F23: a domain change applies within minutes.
    const own = await ownDomainTarget(url.pathname, req.nextUrl.search)
    if (own) {
      const res = NextResponse.redirect(own, 301)
      res.headers.set('cache-control', 'private, max-age=300')
      return res
    }
    // F23: a renamed spa's previous address (site or dashboard) → the same path + query under its new slug.
    const moved = await movedSlugTarget(host, originalPath, url.pathname)
    if (moved) {
      const res = NextResponse.redirect(`${proto}://${moved.host}${moved.pathname}${req.nextUrl.search}`, 301)
      // Short browser cache: the address may be taken back (or, after the cooling period, by another spa).
      res.headers.set('cache-control', 'private, max-age=300')
      return res
    }
  }
  const https = proto === 'https'
  const nonce = newNonce()
  const security = pageSecurityHeaders({ nonce, internalPath: url.pathname, https, dev: DEV })
  const headers = new Headers(req.headers)
  headers.set('x-original-path', `${originalPath}${url.search}`)
  // F24: the surface (route prefix) for <html lang/dir> and the surface-aware 404 (server/surface.ts).
  headers.set('x-internal-path', url.pathname)
  headers.set('x-nonce', nonce)
  headers.set('content-security-policy', security['content-security-policy']!)
  const res = NextResponse.rewrite(url, { request: { headers } })
  for (const [k, v] of Object.entries(security)) res.headers.set(k, v)
  return res
}

// /files/* (stored files + uploads) is served by app/files on every host and routing mode, never rewritten; so is
// /.well-known/* (OAuth discovery for the Claude MCP connector, app/.well-known). /robots.txt and /sitemap.xml ARE
// rewritten, so each surface answers its own (marketing, app/admin = disallow all, spa site, custom domain).
// Paths left out here get their security headers from next.config.ts instead (keep the two lists in step).
// The last entries (platformOnlyPath) only reach the custom-domain 404 above, never the rewrite or the page headers.
export const config = {
  matcher: [
    '/((?!api/|_next/|files/|\\.well-known/|favicon\\.ico|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|webp|avif|ico|css|js|woff2?)$).*)',
    '/api/auth/:path*',
    '/api/mcp/:path*',
    '/api/integrations/:path*',
    '/.well-known/:path*',
  ],
}
