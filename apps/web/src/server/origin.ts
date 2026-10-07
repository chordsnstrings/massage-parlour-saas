import { matchRoot, parseRoots } from '@spa/core'
import { headers } from 'next/headers'
import { adminPath, appPath, PATH_ROUTING } from '@/lib/paths'

/**
 * Domain-agnostic absolute URLs. Every link is built from the platform domain the visitor is on, so the platform can
 * move to (or also answer on) another domain by config alone — ROOT_DOMAIN (canonical) plus EXTRA_ROOT_DOMAINS.
 * A Host that isn't one of ours (forged, or a spa's custom domain) falls back to the canonical domain.
 * Request-scoped (reads headers()), so pages using these render per request and never bake a domain in at build time.
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

/** All URL builders for the current request at once (sync after one await) — handy inside JSX and loops. */
export async function requestUrls() {
  const origin = await requestDomain()
  return {
    /** Absolute URL on the tenant-dashboard surface. */
    app: (path = '/') => (PATH_ROUTING ? `${origin()}${appPath(path)}` : `${origin('app')}${path}`),
    /** Absolute URL on the super-admin surface. */
    admin: (path = '/') => (PATH_ROUTING ? `${origin()}${adminPath(path)}` : `${origin('admin')}${path}`),
    /** A spa's free site address: /s/{slug} on the platform domain, or {slug}.{domain} with host routing. */
    site: (slug: string) => (PATH_ROUTING ? `${origin()}/s/${slug}` : origin(slug)),
    /** The marketing site. */
    marketing: () => origin(),
  }
}

export const appUrl = async (path = '/') => (await requestUrls()).app(path)
export const adminUrl = async (path = '/') => (await requestUrls()).admin(path)
export const tenantSiteUrl = async (slug: string) => (await requestUrls()).site(slug)
export const marketingUrl = async () => (await requestUrls()).marketing()
