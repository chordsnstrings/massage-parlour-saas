// R24: a spa site page whose published content is an exact HTML design (Phone fixes off) is served as the design
// document itself (app/site-html) instead of a platform page with the design in a frame: one scrollbar, the phone
// toolbar collapses, 100vh/dvh, the design's own viewport/title/favicon, #anchors, history — exactly like the file
// opened directly. Runs in the proxy, so it stays light (@spa/db only). The answer is approximate on purpose (cached
// 30 s; the web actions that publish or move pages clear it at once, the TTL covers the worker): app/site-html
// re-checks and falls back to the normal page when it no longer applies.
import { platformDb } from '@spa/db'
import { sql } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'

/** Request header the proxy sets with a per-process key: app/site-html answers only rewrites from the proxy. */
export const HTML_ROUTE_HEADER = 'x-spa-html-route'
/** Query flag of the fallback: serve the normal page (no direct design lookup), so a stale answer can't loop. */
export const HTML_ROUTE_FALLBACK = '__page'

// Same as @spa/services PAGE_SLUG / RESERVED_SLUGS (not imported: the services index is heavy for the proxy).
const PAGE_SLUG = /^$|^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RESERVED = new Set(['book', 'api', 's'])

// globalThis: the proxy and the route handlers / server actions are separate bundles in one process.
const g = globalThis as unknown as {
  __spaHtmlRoutes?: LRUCache<string, { exact: boolean }>
  __spaHtmlRouteKey?: string
}
g.__spaHtmlRoutes ??= new LRUCache<string, { exact: boolean }>({ max: 5000, ttl: 30_000 })
g.__spaHtmlRouteKey ??= crypto.randomUUID()
const cache = g.__spaHtmlRoutes

export const htmlRouteKey = () => g.__spaHtmlRouteKey!

/** After a publish / unpublish / restore / rename / delete, a domain or slug change, a tenant status change. */
export function forgetHtmlDesignRoutes() {
  cache.clear()
}

export type SitePage = { kind: 'slug' | 'host'; key: string; page: string }

/** `/site/{slug}[/{page}]` or `/domain/{host}[/{page}]` (one page segment, not a reserved route); else null. */
export function sitePageOf(internalPath: string): SitePage | null {
  const m = /^\/(site|domain)\/([^/]+)(?:\/([^/]+))?\/?$/.exec(internalPath)
  if (!m) return null
  try {
    const key = decodeURIComponent(m[2]!).toLowerCase()
    const page = m[3] ? decodeURIComponent(m[3]).toLowerCase() : ''
    if (!PAGE_SLUG.test(page) || RESERVED.has(page) || !key) return null
    return { kind: m[1] === 'site' ? 'slug' : 'host', key, page }
  } catch {
    return null
  }
}

/** Published version of a visible page is an HTML design whose block has `phoneFixes: false`. */
async function lookup(p: SitePage): Promise<boolean> {
  const tenant =
    p.kind === 'slug'
      ? sql`t.slug = ${p.key}`
      : sql`exists (select 1 from domains d where d.tenant_id = t.id and d.hostname = ${p.key} and d.kind = 'custom' and d.status = 'active')`
  const { rows } = await platformDb().execute<{ exact: boolean }>(sql`
    select (v.data #>> '{root,props,htmlDesign}') = 'true'
      and jsonb_path_exists(v.data, '$.content[*] ? (@.type == "HtmlDesign" && @.props.phoneFixes == false)') as exact
    from tenants t
    join sites s on s.tenant_id = t.id
    join site_pages sp on sp.site_id = s.id and sp.slug = ${p.page} and sp.visible
    join lateral (
      select pv.data from page_versions pv
      where pv.page_id = sp.id and pv.status = 'published'
      order by pv.created_at desc limit 1
    ) v on true
    where t.status <> 'cancelled' and ${tenant}
    limit 1`)
  return rows[0]?.exact === true
}

/** Whether the proxy serves this internal path as the design document itself. Never throws (false on errors). */
export async function exactHtmlDesignAt(internalPath: string): Promise<boolean> {
  const p = sitePageOf(internalPath)
  if (!p) return false
  const key = `${p.kind}:${p.key}/${p.page}`
  const hit = cache.get(key)
  if (hit) return hit.exact
  try {
    const exact = await lookup(p)
    cache.set(key, { exact })
    return exact
  } catch {
    return false
  }
}
