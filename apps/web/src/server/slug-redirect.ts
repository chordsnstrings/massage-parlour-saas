// F23: a renamed spa's previous address 301s to the new one (proxy.ts; Caddy's TLS "ask" allows the old host too).
// Runs in the proxy, so it stays light: @spa/db + the services tenant-slug module only (not the services barrel).
import { platformDb } from '@spa/db'
import { slugRedirects } from '@spa/services/tenant-slug'
import { PATH_ROUTING } from '@/lib/paths'

// One map (old slug → current slug) per process, refreshed at most every 30 s; the console rename clears it at once
// (globalThis: the proxy and the server actions are separate bundles in one process).
const TTL = 30_000
type State = { map: Map<string, string>; at: number; loading?: Promise<Map<string, string>> }
const g = globalThis as unknown as { __spaSlugRedirects?: State }
if (!g.__spaSlugRedirects) g.__spaSlugRedirects = { map: new Map(), at: 0 }
const state = g.__spaSlugRedirects

async function redirectMap(): Promise<Map<string, string>> {
  if (Date.now() - state.at < TTL) return state.map
  state.loading ??= slugRedirects(platformDb())
    .then((map) => {
      state.map = map
      state.at = Date.now()
      return map
    })
    // Never fail a page on this lookup: keep the last map, retry on a later request.
    .catch(() => state.map)
    .finally(() => {
      state.loading = undefined
    })
  return state.loading
}

/** The spa's current slug when `slug` is one of its previous addresses, else null. */
export async function currentSlugFor(slug: string): Promise<string | null> {
  const map = await redirectMap()
  return map.get(slug.toLowerCase()) ?? null
}

/** After a rename: the next request reloads the map. */
export function forgetSlugRedirects() {
  state.at = 0
}

/**
 * Where a request for a previous address goes: the same path + query on `{new}.{root}` (host routing, any platform
 * domain), or with the slug segment swapped (`/s/{old}/…`, `/app/{old}/…`, app host `/{old}/…`). `internalPath` is
 * proxy.ts's rewrite of the request; null when it isn't a spa site or dashboard path under a previous slug.
 */
export async function movedSlugTarget(
  host: string,
  pathname: string,
  internalPath: string,
): Promise<{ host: string; pathname: string } | null> {
  const m = internalPath.match(/^\/(site|dashboard)\/([a-z0-9-]+)(?=\/|$)/i)
  if (!m) return null
  const surface = m[1]!
  const old = m[2]!
  const next = await currentSlugFor(old)
  if (!next) return null
  if (surface === 'site' && !PATH_ROUTING) {
    if (host.slice(0, old.length + 1).toLowerCase() !== `${old.toLowerCase()}.`) return null
    return { host: `${next}${host.slice(old.length)}`, pathname }
  }
  const prefix = PATH_ROUTING ? (surface === 'site' ? '/s/' : '/app/') : '/'
  if (pathname.slice(0, prefix.length + old.length).toLowerCase() !== `${prefix}${old.toLowerCase()}`)
    return null
  return { host, pathname: `${prefix}${next}${pathname.slice(prefix.length + old.length)}` }
}
