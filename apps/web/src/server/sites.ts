import { branches, domains, platformDb, tenants, withTenant } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { canonicalUrls } from '@/server/origin'

type SiteTenant = { id: string; slug: string; name: string; status: string }
// globalThis: the console's rename / domain actions must clear the same cache the site pages read (F23).
const g = globalThis as unknown as { __spaSiteHosts?: LRUCache<string, SiteTenant | 'missing'> }
if (!g.__spaSiteHosts) g.__spaSiteHosts = new LRUCache({ max: 5000, ttl: 60_000 })
const cache = g.__spaSiteHosts

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

/** Drops a custom hostname from the host cache after its domain changes (activate, deactivate, remove). */
export function invalidateSiteHost(hostname: string) {
  cache.delete(`h:${hostname.toLowerCase()}`)
}

/** After a slug rename (F23, rare): every cached entry may carry the old slug (custom domains too). */
export function forgetSiteTenants() {
  cache.clear()
}

/** The spa's public address: its primary active custom domain, else the free subdomain (or /s/{slug}). */
export async function publicSiteUrl(tenant: { id: string; slug: string }): Promise<string> {
  const [primary] = await withTenant(tenant.id, (tx) =>
    tx
      .select({ hostname: domains.hostname })
      .from(domains)
      .where(and(eq(domains.kind, 'custom'), eq(domains.status, 'active'), eq(domains.isPrimary, true)))
      .limit(1),
  )
  return primary ? `https://${primary.hostname}` : canonicalUrls().site(tenant.slug)
}

export async function siteData(tenant: SiteTenant) {
  const [branch] = await withTenant(tenant.id, (tx) =>
    tx.select().from(branches).where(eq(branches.isDefault, true)).limit(1),
  )
  return { tenant, branch }
}
