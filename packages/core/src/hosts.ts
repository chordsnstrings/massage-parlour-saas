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
