import { matchRoot } from '@spa/core'
import { domains, platformDb, tenants } from '@spa/db'
import { and, eq, inArray } from 'drizzle-orm'
import { PATH_ROUTING } from '@/lib/paths'
import { platformRoots } from '@/server/origin'

export const dynamic = 'force-dynamic'

/** Hosts on a platform domain that serve something: the domain itself, and with host routing www/app/admin + spas. */
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
  return Boolean(tenant)
}

/**
 * Caddy on-demand TLS "ask" endpoint: a certificate may only be issued for hostnames that serve something — a spa's
 * custom domain (not yet removed), or a host on one of the platform domains (ROOT_DOMAIN + EXTRA_ROOT_DOMAINS), so a
 * new platform domain needs only DNS and config. Called by Caddy over the internal network: GET ?domain=<hostname>.
 */
export async function GET(req: Request) {
  const hostname = new URL(req.url).searchParams.get('domain')?.trim().toLowerCase().replace(/\.$/, '')
  if (!hostname || hostname.length > 253) return new Response(null, { status: 400 })
  if (await isPlatformHost(hostname)) return new Response(null, { status: 200 })
  const [row] = await platformDb()
    .select({ id: domains.id })
    .from(domains)
    .where(
      and(
        eq(domains.hostname, hostname),
        eq(domains.kind, 'custom'),
        inArray(domains.status, ['pending', 'verifying', 'active']),
      ),
    )
    .limit(1)
  return new Response(null, { status: row ? 200 : 404 })
}
