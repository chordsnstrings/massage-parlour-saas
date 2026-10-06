export type Surface =
  | { kind: 'marketing' }
  | { kind: 'app' }
  | { kind: 'admin' }
  | { kind: 'site'; slug: string }
  | { kind: 'custom'; hostname: string }

const stripPort = (host: string) => host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')

/** Maps a request Host to the surface that serves it. `rootDomain` may include a dev port. */
export function resolveSurface(hostHeader: string, rootDomain: string): Surface {
  const host = stripPort(hostHeader)
  const root = stripPort(rootDomain)
  if (host === root || host === `www.${root}`) return { kind: 'marketing' }
  if (host === `app.${root}`) return { kind: 'app' }
  if (host === `admin.${root}`) return { kind: 'admin' }
  if (host.endsWith(`.${root}`)) {
    const label = host.slice(0, -(root.length + 1))
    if (!label.includes('.')) return { kind: 'site', slug: label }
  }
  return { kind: 'custom', hostname: host }
}

/** Public URL of a tenant site, e.g. https://pilot.spamanagement.ae (http for localhost dev). */
export function siteUrl(slug: string, rootDomain: string): string {
  const protocol = rootDomain.startsWith('localhost') ? 'http' : 'https'
  return `${protocol}://${slug}.${rootDomain}`
}
