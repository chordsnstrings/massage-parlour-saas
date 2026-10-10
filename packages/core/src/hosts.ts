export type Surface =
  | { kind: 'marketing' }
  | { kind: 'app' }
  | { kind: 'admin' }
  | { kind: 'site'; slug: string }
  | { kind: 'custom'; hostname: string }

const stripPort = (host: string) => host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')

/**
 * Platform root domains from config: the canonical one first (ROOT_DOMAIN), then any extras (EXTRA_ROOT_DOMAINS), each a
 * comma- or space-separated list. Lower-cased, de-duplicated; a dev port is kept.
 */
export function parseRoots(...lists: (string | undefined)[]): string[] {
  const roots: string[] = []
  for (const list of lists)
    for (const raw of (list ?? '').split(/[\s,]+/)) {
      const root = raw.trim().toLowerCase().replace(/\.$/, '')
      if (root && !roots.includes(root)) roots.push(root)
    }
  return roots
}

/** The platform root a Host belongs to (the root itself or a subdomain of it), most specific first; null if none. */
export function matchRoot(hostHeader: string, roots: readonly string[]): string | null {
  const host = stripPort(hostHeader)
  let best: string | null = null
  for (const root of roots) {
    const bare = stripPort(root)
    if ((host === bare || host.endsWith(`.${bare}`)) && (!best || bare.length > stripPort(best).length))
      best = root
  }
  return best
}

/** Maps a request Host to the surface that serves it. `rootDomain` may include a dev port, or be a list of roots. */
export function resolveSurface(hostHeader: string, rootDomain: string | readonly string[]): Surface {
  const host = stripPort(hostHeader)
  const matched = matchRoot(hostHeader, typeof rootDomain === 'string' ? [rootDomain] : rootDomain)
  if (!matched) return { kind: 'custom', hostname: host }
  const root = stripPort(matched)
  if (host === root || host === `www.${root}`) return { kind: 'marketing' }
  if (host === `app.${root}`) return { kind: 'app' }
  if (host === `admin.${root}`) return { kind: 'admin' }
  const label = host.slice(0, -(root.length + 1))
  if (!label.includes('.')) return { kind: 'site', slug: label }
  return { kind: 'custom', hostname: host }
}

/** Public URL of a tenant site, e.g. https://pilot.spamanagement.co (http for localhost dev). */
export function siteUrl(slug: string, rootDomain: string): string {
  const protocol = rootDomain.startsWith('localhost') ? 'http' : 'https'
  return `${protocol}://${slug}.${rootDomain}`
}

/**
 * A spa's free site address without a request (worker jobs), matching web `canonicalUrls().site()`: `/s/{slug}` on
 * the platform domain when the dashboard lives on the root host itself (path routing: APP_URL = https://{root}),
 * else `{slug}.{root}` (host routing: APP_URL = https://app.{root}).
 */
export function freeSiteUrl(slug: string, env: { ROOT_DOMAIN?: string; APP_URL?: string }): string {
  const root = parseRoots(env.ROOT_DOMAIN ?? 'localhost:3000')[0]!
  let app: URL | null = null
  try {
    app = env.APP_URL ? new URL(env.APP_URL) : null
  } catch {
    app = null
  }
  const scheme = app?.protocol === 'http:' || (!app && root.startsWith('localhost')) ? 'http' : 'https'
  const pathRouting = app ? app.host.toLowerCase() === root : false
  return pathRouting ? `${scheme}://${root}/s/${slug}` : `${scheme}://${slug}.${root}`
}

/** `s` without trailing `/`s (a loop: `/\/+$/` rescans a long `/` run that doesn't end the string, quadratic). */
export function trimTrailingSlashes(s: string): string {
  let n = s.length
  while (n > 0 && s[n - 1] === '/') n--
  return s.slice(0, n)
}
