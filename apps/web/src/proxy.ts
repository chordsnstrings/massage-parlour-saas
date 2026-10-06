import { resolveSurface } from '@spa/core'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * Host-based routing: one Next.js app serves every surface.
 *   example.ae / www → /marketing · app. → /dashboard · admin. → /platform
 *   {slug}.example.ae → /site/{slug} · custom domains → /domain/{hostname}
 * Pages re-check tenant and permissions themselves; this only rewrites paths.
 */
export function proxy(req: NextRequest) {
  const surface = resolveSurface(req.headers.get('host') ?? '', process.env.ROOT_DOMAIN ?? 'localhost:3000')
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
  const url = req.nextUrl.clone()
  const originalPath = url.pathname
  url.pathname = `${prefix}${originalPath === '/' ? '' : originalPath}`
  const headers = new Headers(req.headers)
  headers.set('x-original-path', `${originalPath}${url.search}`)
  return NextResponse.rewrite(url, { request: { headers } })
}

export const config = {
  matcher: [
    '/((?!api/|_next/|favicon\\.ico|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|webp|avif|ico|css|js|woff2?)$).*)',
  ],
}
