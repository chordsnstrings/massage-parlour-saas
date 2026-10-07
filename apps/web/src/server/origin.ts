import { matchRoot, parseRoots } from '@spa/core'
import { headers } from 'next/headers'
import { adminPath, appPath, PATH_ROUTING } from '@/lib/paths'

/**
 * Domain-agnostic absolute URLs; the platform moves to (or also answers on) another domain by config alone —
 * ROOT_DOMAIN (canonical) plus EXTRA_ROOT_DOMAINS.
 * - requestUrls(): getting around the platform — built from the platform domain the visitor is on (keeps their session).
 *   A Host that isn't one of ours (forged, or a spa's custom domain) falls back to the canonical domain. Request-scoped
 *   (reads headers()), so pages using it render per request and never bake a domain in at build time.
 * - canonicalUrls(): addresses that are shared, stored or sent to others (a spa's site address, invites, campaign and
 *   booking links, public file URLs) — always the canonical domain, so they outlive whichever domain staff used.
 */

/** Configured platform domains, canonical first. A dev port may be included. */
export const platformRoots = () =>
  parseRoots(process.env.ROOT_DOMAIN ?? 'localhost:3000', process.env.EXTRA_ROOT_DOMAINS)

const stripPort = (host: string) => host.replace(/:\d+$/, '')
const isLocal = (host: string) => {
  const bare = stripPort(host)
  return bare === 'localhost' || bare.endsWith('.localhost') || /^[\d.]+$/.test(bare)
}

/** Origin builder for the request's platform domain: `origin()` is the bare domain, `origin('app')` a subdomain. */
async function requestDomain() {
  const h = await headers()
  const host = (h.get('host') ?? '').toLowerCase()
  const roots = platformRoots()
  const matched = matchRoot(host, roots)
  // Keep the request's port on our own domain (dev servers); the canonical fallback keeps its configured one.
  const port = matched ? (host.match(/:\d+$/)?.[0] ?? '') : ''
  const root = matched ? `${stripPort(matched)}${port}` : roots[0]!
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const scheme = proto === 'http' || proto === 'https' ? proto : isLocal(root) ? 'http' : 'https'
  return (sub?: string) => `${scheme}://${sub ? `${sub}.` : ''}${root}`
}

/** The canonical platform domain (no request needed). Throws during `next build`, which has no runtime env. */
function canonicalDomain() {
  if (!process.env.ROOT_DOMAIN && process.env.NEXT_PHASE === 'phase-production-build')
    throw new Error('ROOT_DOMAIN was read while prerendering a static page; make the route dynamic.')
  const root = platformRoots()[0]!
  const app = process.env.APP_URL ?? ''
  const scheme = app.startsWith('https:')
    ? 'https'
    : app.startsWith('http:')
      ? 'http'
      : isLocal(root)
        ? 'http'
        : 'https'
  return (sub?: string) => `${scheme}://${sub ? `${sub}.` : ''}${root}`
}

type Origin = (sub?: string) => string

const builders = (origin: Origin) => ({
  /** Absolute URL on the tenant-dashboard surface. */
  app: (path = '/') => (PATH_ROUTING ? `${origin()}${appPath(path)}` : `${origin('app')}${path}`),
  /** Absolute URL on the super-admin surface. */
  admin: (path = '/') => (PATH_ROUTING ? `${origin()}${adminPath(path)}` : `${origin('admin')}${path}`),
  /** A spa's free site address: /s/{slug} on the platform domain, or {slug}.{domain} with host routing. */
  site: (slug: string) => (PATH_ROUTING ? `${origin()}/s/${slug}` : origin(slug)),
  /** The marketing site. */
  marketing: () => origin(),
  /** API routes live on the app origin in both routing modes (e.g. OAuth callbacks). */
  api: (path: string) => (PATH_ROUTING ? `${origin()}${path}` : `${origin('app')}${path}`),
})

/** URL builders for the visitor's platform domain (sync after one await) — handy inside JSX and loops. */
export const requestUrls = async () => builders(await requestDomain())

/** URL builders for the canonical domain: for addresses that are shared, stored or sent to others. */
export const canonicalUrls = () => builders(canonicalDomain())

export const appUrl = async (path = '/') => (await requestUrls()).app(path)
export const adminUrl = async (path = '/') => (await requestUrls()).admin(path)
export const tenantSiteUrl = async (slug: string) => (await requestUrls()).site(slug)
export const marketingUrl = async () => (await requestUrls()).marketing()
