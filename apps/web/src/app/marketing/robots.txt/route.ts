import { robotsTxt } from '@spa/core'
import { domains, platformDb, tenants } from '@spa/db'
import { and, asc, eq, isNull, notExists, notInArray } from 'drizzle-orm'
import { PATH_ROUTING } from '@/lib/paths'
import { canonicalUrls } from '@/server/origin'

export const dynamic = 'force-dynamic'

/**
 * Spas served at /s/{slug} on the platform domain (path routing) that may be in search: not suspended or
 * cancelled, and no primary custom domain (that one is their canonical address and has its own robots.txt).
 */
async function pathSites(): Promise<string[]> {
  try {
    const rows = await platformDb()
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(
        and(
          notInArray(tenants.status, ['suspended', 'cancelled']),
          isNull(tenants.deletedAt),
          notExists(
            platformDb()
              .select({ id: domains.id })
              .from(domains)
              .where(
                and(
                  eq(domains.tenantId, tenants.id),
                  eq(domains.kind, 'custom'),
                  eq(domains.status, 'active'),
                  eq(domains.isPrimary, true),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(tenants.slug))
    return rows.map((r) => r.slug)
  } catch {
    return []
  }
}

/**
 * The platform domain's robots.txt (every platform domain; links point at the canonical one). Host routing: the
 * marketing site only. Path routing: the same host also carries /app, /admin and the spa sites at /s/{slug}.
 */
export async function GET() {
  const urls = canonicalUrls()
  const root = urls.marketing()
  const disallow = PATH_ROUTING ? ['/api/', '/app/', '/admin/', '/s/*/book/embed'] : ['/api/']
  const sitemaps = [`${root}/sitemap.xml`]
  if (PATH_ROUTING) for (const slug of await pathSites()) sitemaps.push(`${urls.site(slug)}/sitemap.xml`)
  return new Response(robotsTxt({ disallow, sitemaps }), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  })
}
