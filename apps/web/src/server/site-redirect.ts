// R33: a spa's own redirects (console Websites → spa → Redirects) — an old website address → a page of the site, 301
// (proxy.ts), on every public address of the spa. Runs in the proxy, so it stays light (@spa/db, core and the
// services site-redirects module only, never the services barrel). Per site key (slug / custom hostname) the rules
// are cached 30 s, empty sets too; the console's redirect, page and domain writes clear it at once (revalidateStudio,
// sites.ts), the TTL covers the worker. A DB error serves the page as if there were no redirects.
import {
  matchRedirect,
  type RedirectRule,
  redirectPathProblem,
  redirectRequestKey,
  trimTrailingSlashes,
} from '@spa/core'
import { platformDb } from '@spa/db'
import { siteRedirectRules } from '@spa/services/site-redirects'
import { LRUCache } from 'lru-cache'

type Rules = Map<string, RedirectRule[]>
// globalThis: the proxy and the server actions are separate bundles in one process. The value is the load itself,
// so concurrent misses share one query.
const g = globalThis as unknown as { __spaSiteRedirects?: LRUCache<string, Promise<Rules>> }
g.__spaSiteRedirects ??= new LRUCache<string, Promise<Rules>>({ max: 5000, ttl: 30_000 })
const cache = g.__spaSiteRedirects

/** After a redirect, page (publish, rename, visibility), post, domain or slug change. */
export function forgetSiteRedirects() {
  cache.clear()
}

function rulesOf(kind: 'slug' | 'hostname', key: string): Promise<Rules> {
  const cacheKey = `${kind === 'slug' ? 's' : 'h'}:${key}`
  const hit = cache.get(cacheKey)
  if (hit) return hit
  const loading: Promise<Rules> = siteRedirectRules(
    platformDb(),
    kind === 'slug' ? { slug: key } : { hostname: key },
  )
    .then((rows) => {
      const byPath: Rules = new Map()
      for (const r of rows) byPath.set(r.from, [...(byPath.get(r.from) ?? []), r])
      return byPath
    })
    .catch(() => {
      // Never fail a page on this lookup; retried on a later request.
      if (cache.get(cacheKey) === loading) cache.delete(cacheKey)
      return new Map()
    })
  cache.set(cacheKey, loading)
  return loading
}

/**
 * The spa's redirect for a GET/HEAD of `internalPath` (proxy.ts's rewrite: `/site/{slug}…` or `/domain/{host}…`):
 * `rest` = the site path as requested, `to` = the on-site path + query to send the visitor to. Null for no redirect —
 * also for the site's own routes (booking, vouchers, robots.txt, sitemap.xml, the design feed) and the home page
 * without a query. Never throws.
 */
export async function siteRedirectTarget(
  internalPath: string,
  search: string,
): Promise<{ rest: string; to: string } | null> {
  const m = /^\/(site|domain)\/([^/]+)(\/.*)?$/.exec(internalPath)
  if (!m) return null
  const rest = m[3] ?? ''
  const key = redirectRequestKey(rest || '/')
  if (!key || (key === '/' ? search.length < 2 : redirectPathProblem(key))) return null
  try {
    const rules = await rulesOf(m[1] === 'site' ? 'slug' : 'hostname', m[2]!.toLowerCase())
    const hit = matchRedirect(rules.get(key) ?? [], key, search)
    return hit ? { rest, to: hit.to } : null
  } catch {
    return null
  }
}

/** The redirect's path on the address the visitor used: path routing keeps its `/s/{slug}` prefix. */
export function siteRedirectPath(originalPath: string, hit: { rest: string; to: string }): string {
  const prefix = trimTrailingSlashes(originalPath.slice(0, originalPath.length - hit.rest.length))
  if (!prefix) return hit.to
  return /^\/(?=[?#]|$)/.test(hit.to) ? `${prefix}${hit.to.slice(1)}` : `${prefix}${hit.to}`
}

/**
 * One hop: an absolute URL on a spa's own domain (the R20 temporary-address and www-twin redirects) with that
 * domain's redirect applied (`https://theirspa.ae/old` → `https://theirspa.ae/new`), else unchanged.
 */
export async function withSiteRedirect<T extends string | null>(url: T): Promise<T> {
  if (!url) return url
  try {
    const u = new URL(url)
    const hit = await siteRedirectTarget(
      `/domain/${u.hostname}${u.pathname === '/' ? '' : u.pathname}`,
      u.search,
    )
    return (hit ? `${u.origin}${hit.to}` : url) as T
  } catch {
    return url
  }
}
