// R20: once a spa's own domain is active and primary, its site lives only there — the temporary address
// ({slug}.{platform root} / /s/{slug}) 301s to it (proxy.ts). Runs in the proxy, so it stays light (@spa/db + core).
import { ownDomainUrl, temporarySitePath } from '@spa/core'
import { domains, platformDb, tenants } from '@spa/db'
import { and, eq, ne } from 'drizzle-orm'
import { currentSlugFor } from '@/server/slug-redirect'

// One map (slug → active primary custom hostname) per process, refreshed at most every 30 s (the worker's domain checks
// run in another process); domain changes in the web app clear it at once (sites.ts invalidateSiteHost/forgetSiteTenants;
// globalThis: the proxy and the server actions are separate bundles in one process).
const TTL = 30_000
type State = { map: Map<string, string>; at: number; gen: number; loading?: Promise<Map<string, string>> }
const g = globalThis as unknown as { __spaOwnDomains?: State }
if (!g.__spaOwnDomains) g.__spaOwnDomains = { map: new Map(), at: 0, gen: 0 }
const state = g.__spaOwnDomains

function load(): Promise<Map<string, string>> {
  const gen = state.gen
  const loading: Promise<Map<string, string>> = platformDb()
    .select({ slug: tenants.slug, hostname: domains.hostname })
    .from(domains)
    .innerJoin(tenants, eq(tenants.id, domains.tenantId))
    .where(
      and(
        eq(domains.kind, 'custom'),
        eq(domains.status, 'active'),
        eq(domains.isPrimary, true),
        ne(tenants.status, 'cancelled'),
      ),
    )
    .then((rows) => {
      const map = new Map(rows.map((r) => [r.slug, r.hostname]))
      // A change while this query ran: don't keep its (maybe older) answer for the next 30 s.
      if (gen === state.gen) {
        state.map = map
        state.at = Date.now()
      }
      return map
    })
    // Never fail a page on this lookup: keep the last map, retry on a later request.
    .catch(() => state.map)
    .finally(() => {
      if (state.loading === loading) state.loading = undefined
    })
  return loading
}

async function ownDomains(): Promise<Map<string, string>> {
  if (Date.now() - state.at < TTL) return state.map
  state.loading ??= load()
  return state.loading
}

/** After a domain change (activate, deactivate, primary, remove) or a slug rename: the next request reloads the map. */
export function forgetOwnDomains() {
  state.gen++
  state.at = 0
  state.loading = undefined
}

/**
 * Where a GET/HEAD for a spa's public site on its temporary address goes: the same path + query on its active primary
 * custom domain, one hop (a renamed spa's previous slug too, F23); null to serve it here (no such domain, or a path the
 * temporary address keeps: the widget iframe, robots.txt). `internalPath` = proxy.ts's rewrite (`/site/{slug}/…`).
 */
export async function ownDomainTarget(internalPath: string, search: string): Promise<string | null> {
  const site = temporarySitePath(internalPath)
  if (!site) return null
  const map = await ownDomains()
  if (map.size === 0) return null
  const hostname = map.get((await currentSlugFor(site.slug)) ?? site.slug)
  return hostname ? ownDomainUrl(hostname, site.path, search) : null
}
