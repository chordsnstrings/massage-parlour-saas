import { siteUrl } from '@spa/core'

/**
 * Routing modes:
 *  - host (default, production with our own domain): app.example.ae, admin.example.ae, {slug}.example.ae
 *  - path (single hostname, e.g. *.ondigitalocean.app): /app/…, /admin/…, /s/{slug}/…
 * NEXT_PUBLIC_ROUTING is inlined at build time so server and client agree.
 */
export const PATH_ROUTING = process.env.NEXT_PUBLIC_ROUTING === 'path'

const join = (prefix: string, path: string) => (path === '/' ? prefix : `${prefix}${path}`)

/** Public path on the tenant-dashboard surface. */
export const appPath = (path = '/') => (PATH_ROUTING ? join('/app', path) : path)
/** Public path on the super-admin surface. */
export const adminPath = (path = '/') => (PATH_ROUTING ? join('/admin', path) : path)

const appOrigin = () => (process.env.APP_URL ?? 'http://app.localhost:3000').replace(/\/$/, '')

/** Absolute URLs (server only — reads runtime env). */
export const appUrl = (path = '/') => `${appOrigin()}${appPath(path)}`
export const adminUrl = (path = '/') =>
  PATH_ROUTING
    ? `${appOrigin()}${adminPath(path)}`
    : `${(process.env.ADMIN_URL ?? 'http://admin.localhost:3000').replace(/\/$/, '')}${path}`
export const tenantSiteUrl = (slug: string) =>
  PATH_ROUTING ? `${appOrigin()}/s/${slug}` : siteUrl(slug, process.env.ROOT_DOMAIN ?? 'localhost:3000')
export const marketingUrl = () =>
  PATH_ROUTING
    ? appOrigin()
    : siteUrl('www', process.env.ROOT_DOMAIN ?? 'localhost:3000').replace('://www.', '://')

/** Base of the surface a public path belongs to ('/admin' or '/app' in path mode, '' in host mode). */
export const surfaceBaseOf = (publicPath: string) =>
  PATH_ROUTING ? (publicPath.startsWith('/admin') ? '/admin' : '/app') : ''
