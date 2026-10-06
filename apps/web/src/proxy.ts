import { resolveSurface } from '@spa/core'
import { type NextRequest, NextResponse } from 'next/server'

const PATH_ROUTING = process.env.NEXT_PUBLIC_ROUTING === 'path'

/** Maps a public request to an internal route prefix. See lib/paths.ts for the two routing modes. */
function internalPath(host: string, pathname: string): string {
  const tail = (p: string) => (p === '/' ? '' : p)
  if (PATH_ROUTING) {
    // Single-host mode: the platform lives on ROOT_DOMAIN (or a bare IP / localhost); any other host is a spa's
    // custom domain and only ever serves that spa's public site.
    const bare = host.split(':')[0]!.toLowerCase()
    const root = (process.env.ROOT_DOMAIN ?? 'localhost').split(':')[0]!.toLowerCase()
    if (bare && bare !== root && bare !== 'localhost' && !/^[\d.]+$/.test(bare) && !bare.includes('['))
      return `/domain/${bare}${tail(pathname)}`
    const m = pathname.match(/^\/(app|admin|s)(?=\/|$)(\/[^/]+)?(.*)$/)
    if (m?.[1] === 'app') return `/dashboard${tail(`${m[2] ?? ''}${m[3] ?? ''}` || '/')}`
    if (m?.[1] === 'admin') return `/platform${tail(`${m[2] ?? ''}${m[3] ?? ''}` || '/')}`
    if (m?.[1] === 's' && m[2]) return `/site${m[2]}${m[3] ?? ''}`
    return `/marketing${tail(pathname)}`
  }
  const surface = resolveSurface(host, process.env.ROOT_DOMAIN ?? 'localhost:3000')
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

/**
 * One Next.js app serves every surface; this only rewrites paths.
 * Pages re-check tenant and permissions themselves.
 */
export function proxy(req: NextRequest) {
  const url = req.nextUrl.clone()
  const originalPath = url.pathname
  url.pathname = internalPath(req.headers.get('host') ?? '', originalPath)
  const headers = new Headers(req.headers)
  headers.set('x-original-path', `${originalPath}${url.search}`)
  return NextResponse.rewrite(url, { request: { headers } })
}

// /files/* (stored files + uploads) is served by app/files on every host and routing mode, never rewritten.
export const config = {
  matcher: [
    '/((?!api/|_next/|files/|favicon\\.ico|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|webp|avif|ico|css|js|woff2?)$).*)',
  ],
}
