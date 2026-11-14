import { matchRoot, wwwPair } from '@spa/core'
import { domains, platformDb, tenants } from '@spa/db'
import { hostnameReachesUs } from '@spa/services'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { PATH_ROUTING } from '@/lib/paths'
import { platformRoots } from '@/server/origin'
import { currentSlugFor } from '@/server/slug-redirect'

export const dynamic = 'force-dynamic'

/**
 * Hosts on a platform domain that serve something: the domain itself, and with host routing www/app/admin + spas
 * (their current and previous addresses).
 */
async function isPlatformHost(hostname: string) {
  const matched = matchRoot(hostname, platformRoots())
  if (!matched) return false
  const root = matched.replace(/:\d+$/, '')
  if (hostname === root) return true
  if (PATH_ROUTING) return false
  const label = hostname.slice(0, -(root.length + 1))
  if (label === 'www' || label === 'app' || label === 'admin') return true
  if (label.includes('.')) return false
  const [tenant] = await platformDb()
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, label))
    .limit(1)
  // F23: a renamed spa's previous address needs its certificate too, to answer with the 301.
  return Boolean(tenant) || Boolean(await currentSlugFor(label))
}

/**
 * Caddy on-demand TLS "ask" endpoint: a certificate may only be issued for hostnames that serve something — a spa's
 * custom domain (not yet removed, spa not cancelled), the www twin of an active one while it points at us (it
 * redirects to it, proxy.ts; checked first so no certificate order starts for a name parked elsewhere), or a host on
 * one of the platform domains (ROOT_DOMAIN + EXTRA_ROOT_DOMAINS), so a new platform domain needs only DNS and config.
 * Called by Caddy over the internal network: GET ?domain=<hostname>.
 */
export async function GET(req: Request) {
  const hostname = new URL(req.url).searchParams.get('domain')?.trim().toLowerCase().replace(/\.$/, '')
  if (!hostname || hostname.length > 253) return new Response(null, { status: 400 })
  if (await isPlatformHost(hostname)) return new Response(null, { status: 200 })
  const pair = wwwPair(hostname)
  // Only the real pair (x ↔ www.x): www.www.x is no twin of www.x.
  const twin = pair && wwwPair(pair) === hostname ? pair : null
  const rows = await platformDb()
    .select({ hostname: domains.hostname, status: domains.status })
    .from(domains)
    .innerJoin(tenants, eq(tenants.id, domains.tenantId))
    .where(
      and(
        inArray(domains.hostname, twin ? [hostname, twin] : [hostname]),
        eq(domains.kind, 'custom'),
        inArray(domains.status, ['pending', 'verifying', 'active']),
        ne(tenants.status, 'cancelled'),
      ),
    )
  if (rows.some((r) => r.hostname === hostname)) return new Response(null, { status: 200 })
  const allowed = rows.some((r) => r.status === 'active') && (await hostnameReachesUs(hostname))
  return new Response(null, { status: allowed ? 200 : 404 })
}
