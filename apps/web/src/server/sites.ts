import { branches, domains, platformDb, tenants, withTenant } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'

type SiteTenant = { id: string; slug: string; name: string; status: string }
const cache = new LRUCache<string, SiteTenant | 'missing'>({ max: 5000, ttl: 60_000 })

/** Resolves a tenant for a public site request (subdomain slug or verified custom domain), cached 60 s. */
export async function resolveSiteTenant(
  key: { slug: string } | { hostname: string },
): Promise<SiteTenant | null> {
  const cacheKey = 'slug' in key ? `s:${key.slug}` : `h:${key.hostname}`
  const hit = cache.get(cacheKey)
  if (hit) return hit === 'missing' ? null : hit
  const db = platformDb()
  const cols = { id: tenants.id, slug: tenants.slug, name: tenants.name, status: tenants.status }
  const [row] =
    'slug' in key
      ? await db.select(cols).from(tenants).where(eq(tenants.slug, key.slug.toLowerCase())).limit(1)
      : await db
          .select(cols)
          .from(domains)
          .innerJoin(tenants, eq(tenants.id, domains.tenantId))
          .where(
            and(
              eq(domains.hostname, key.hostname.toLowerCase()),
              eq(domains.kind, 'custom'),
              eq(domains.status, 'active'),
            ),
          )
          .limit(1)
  const value = row && row.status !== 'cancelled' ? row : null
  cache.set(cacheKey, value ?? 'missing')
  return value
}

export async function siteData(tenant: SiteTenant) {
  const [branch] = await withTenant(tenant.id, (tx) =>
    tx.select().from(branches).where(eq(branches.isDefault, true)).limit(1),
  )
  return { tenant, branch }
}
