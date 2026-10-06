import { domains, platformDb } from '@spa/db'
import { and, eq, inArray } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

/**
 * Caddy on-demand TLS "ask" endpoint: a certificate may only be issued for hostnames a spa has added as a
 * custom domain (not yet removed). Called by Caddy over the internal network: GET ?domain=<hostname>.
 */
export async function GET(req: Request) {
  const hostname = new URL(req.url).searchParams.get('domain')?.trim().toLowerCase().replace(/\.$/, '')
  if (!hostname || hostname.length > 253) return new Response(null, { status: 400 })
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
