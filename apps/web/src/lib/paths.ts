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

/**
 * R23 Website Studio in the console: a spa's website page (`rest` = '/editor/{id}', '/preview?…', '#requests' …).
 * Client-safe; absolute URLs (old CRM links forwarding here) come from server/studio.ts `studioUrl`.
 */
export const studioPath = (slug: string, rest = '') => adminPath(`/websites/${slug}${rest}`)

// Absolute URLs (app, admin, tenant site, marketing) come from the request's domain: see server/origin.ts.

/** Base of the surface a public path belongs to ('/admin' or '/app' in path mode, '' in host mode). */
export const surfaceBaseOf = (publicPath: string) =>
  PATH_ROUTING ? (publicPath.startsWith('/admin') ? '/admin' : '/app') : ''
