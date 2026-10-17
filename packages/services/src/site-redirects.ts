// R33 (owner 2026-10-17): a spa's own redirects — old website addresses → pages of its site (console Websites → spa →
// Redirects; the proxy answers 301, web server/site-redirect.ts). Callers run the writes inside withTenant();
// permission (studioGuard 'site.publish') + audit stay in the caller. Kept light (core, db, drizzle only): the proxy
// imports `siteRedirectRules` through the `@spa/services/site-redirects` subpath, never the services barrel.
import {
  matchRedirect,
  normalizeRedirectSource,
  normalizeRedirectTarget,
  type RedirectRule,
  redirectLoops,
  redirectTargetKey,
} from '@spa/core'
import { type DbOrTx, pageVersions, sitePages, sitePosts, siteRedirects, sites, type Tx } from '@spa/db'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

/** Redirects one spa may have (owner 2026-10-17). */
export const MAX_SITE_REDIRECTS = 1000

export type SiteRedirectRow = typeof siteRedirects.$inferSelect
/** `from` (+ optional `query`) and `to` as core normalizes them (re-checked here); `line` = the import line, echoed back. */
export type SiteRedirectInput = { from: string; query?: string; to: string; line?: number }
export type SiteRedirectSkip = { line?: number; from: string; reason: string }
export type SiteRedirectSave = {
  added: number
  updated: number
  /** Rows whose target was moved to the end of a chain (A → B → C stored as A → C), new or existing. */
  flattened: number
  unchanged: number
  skipped: SiteRedirectSkip[]
  /** The rows of this save (a new row's id only once written, not on a dry run). */
  saved: {
    id?: string
    line?: number
    from: string
    query: string
    to: string
    status: 'new' | 'updated' | 'unchanged'
  }[]
}

const keyOf = (from: string, query: string) => `${from}?${query}`
const label = (from: string, query: string) => (query ? `${from}?${query}` : from)

/** Live addresses of the site: visible pages with a published version ('/' + slug) and published posts. */
async function livePaths(tx: Tx, tenantId: string): Promise<Set<string>> {
  const pages = await tx
    .select({ slug: sitePages.slug })
    .from(sitePages)
    .where(
      and(
        eq(sitePages.tenantId, tenantId),
        eq(sitePages.visible, true),
        sql`exists (select 1 from ${pageVersions} pv where pv.page_id = ${sitePages.id} and pv.status = 'published')`,
      ),
    )
  const posts = await tx
    .select({ slug: sitePosts.slug })
    .from(sitePosts)
    .where(and(eq(sitePosts.tenantId, tenantId), eq(sitePosts.status, 'published')))
  return new Set([
    ...pages.map((p) => `/${p.slug.toLowerCase()}`),
    ...posts.map((p) => `/blog/${p.slug.toLowerCase()}`),
  ])
}

/** Targets that always answer: online booking and vouchers (pages and posts: `live`). */
const targetLive = (to: string, live: Set<string>) => {
  const key = redirectTargetKey(to)
  return live.has(key) || /^\/book(?:\/|$)/.test(key) || /^\/voucher\/./.test(key)
}

export type SiteRedirectView = SiteRedirectRow & {
  /** A live page or published post uses the old address: the page wins, the redirect doesn't apply. */
  inactive: boolean
  /** The new address is no live page (yet): visitors would land on the site's 404. */
  targetMissing: boolean
}

/** The spa's redirects, newest first, with whether each applies now (console). */
export async function listSiteRedirects(tx: Tx, tenantId: string): Promise<SiteRedirectView[]> {
  const rows = await tx
    .select()
    .from(siteRedirects)
    .where(eq(siteRedirects.tenantId, tenantId))
    .orderBy(desc(siteRedirects.createdAt), asc(siteRedirects.fromPath), asc(siteRedirects.fromQuery))
  if (!rows.length) return []
  const live = await livePaths(tx, tenantId)
  return rows.map((r) => ({
    ...r,
    inactive: !r.fromQuery && live.has(r.fromPath),
    targetMissing: !targetLive(r.toPath, live),
  }))
}

type Entry = RedirectRule & { id?: string; stored?: string; line?: number }

/**
 * Adds or updates redirects (upsert on the old address; a new target replaces the old one), under the site lock so
 * concurrent saves can't build a loop. Refuses an old address a live page or published post uses (the page wins), a
 * redirect to itself, one that would close a loop, and new rows past MAX_SITE_REDIRECTS. Chains are flattened both ways:
 * a new A → B where B → C exists is stored as A → C, and a new B → C moves existing X → B rows to X → C. `dryRun` (the
 * import Preview) reports the same outcome without writing.
 */
export async function saveSiteRedirects(
  tx: Tx,
  tenantId: string,
  inputs: SiteRedirectInput[],
  opts: { userId?: string | null; source?: 'manual' | 'import'; dryRun?: boolean } = {},
): Promise<SiteRedirectSave> {
  // = sites.ts lockSite (not imported: keeps this module light for the proxy).
  await tx.select({ id: sites.id }).from(sites).where(eq(sites.tenantId, tenantId)).for('update')
  const existing = await tx.select().from(siteRedirects).where(eq(siteRedirects.tenantId, tenantId))
  const live = await livePaths(tx, tenantId)
  const all = new Map<string, Entry>()
  const byPath = new Map<string, Map<string, Entry>>()
  const put = (e: Entry) => {
    const k = keyOf(e.from, e.query)
    all.set(k, e)
    if (!byPath.has(e.from)) byPath.set(e.from, new Map())
    byPath.get(e.from)!.set(k, e)
  }
  const drop = (e: Entry) => {
    const k = keyOf(e.from, e.query)
    all.delete(k)
    byPath.get(e.from)?.delete(k)
  }
  for (const r of existing)
    put({ id: r.id, from: r.fromPath, query: r.fromQuery, to: r.toPath, stored: r.toPath })
  // A path-only rule at a live page's address doesn't apply: chains never pass through it.
  const active = (e: Entry) => Boolean(e.query) || !live.has(e.from)
  /** Where `e` finally lands through the other redirects; null = back to an address of the chain (a loop). */
  const resolve = (e: Entry): string | null => {
    let to = e.to
    const seen = new Set([keyOf(e.from, e.query)])
    for (let hop = 0; hop < 100; hop++) {
      const at = redirectTargetKey(to)
      const hit = matchRedirect(
        [...(byPath.get(at)?.values() ?? [])].filter(active),
        at,
        new URL(to, 'http://site.invalid').search,
      )
      if (!hit) return to
      const k = keyOf(hit.rule.from, hit.rule.query)
      if (seen.has(k)) return null
      seen.add(k)
      to = hit.to
    }
    return null
  }

  const skipped: SiteRedirectSkip[] = []
  const touched = new Map<string, Entry>()
  for (const input of inputs) {
    const shown = label(input.from, input.query ?? '')
    const skip = (reason: string) => skipped.push({ line: input.line, from: shown, reason })
    const source = normalizeRedirectSource(input.query ? `${input.from}?${input.query}` : input.from, {
      addresses: [],
    })
    if ('error' in source) {
      skip(source.error)
      continue
    }
    const target = normalizeRedirectTarget(input.to, { addresses: [] })
    if ('error' in target) {
      skip(target.error)
      continue
    }
    const rule = { from: source.path, query: source.query, to: target.to }
    if (!rule.query && live.has(rule.from)) {
      skip('A live page uses this address — the page wins. Unpublish or rename the page first.')
      continue
    }
    if (redirectLoops(rule)) {
      skip('The old and new address are the same.')
      continue
    }
    const k = keyOf(rule.from, rule.query)
    const prev = all.get(k)
    if (!prev && all.size >= MAX_SITE_REDIRECTS) {
      skip(`This spa has the most redirects allowed (${MAX_SITE_REDIRECTS}). Delete some first.`)
      continue
    }
    const entry: Entry = { ...prev, ...rule, line: input.line }
    put(entry)
    if (resolve(entry) === null) {
      if (prev) put(prev)
      else drop(entry)
      skip('That would make a redirect loop.')
      continue
    }
    touched.set(k, entry)
  }

  // Flatten: every row (new or existing) points at the end of its chain.
  let flattened = 0
  for (const e of all.values()) {
    if (!active(e)) continue
    const end = resolve(e)
    if (end !== null && end !== e.to) {
      e.to = end
      flattened++
    }
  }

  const saved = [...touched.values()].map((e) => ({
    id: e.id,
    line: e.line,
    from: e.from,
    query: e.query,
    to: e.to,
    status: !e.id ? ('new' as const) : e.to !== e.stored ? ('updated' as const) : ('unchanged' as const),
  }))
  const count = (status: string) => saved.filter((s) => s.status === status).length
  const result: SiteRedirectSave = {
    added: count('new'),
    updated: count('updated'),
    flattened,
    unchanged: count('unchanged'),
    skipped,
    saved,
  }
  if (opts.dryRun) return result

  const by = opts.userId ?? null
  const fresh = [...all.values()].filter((e) => !e.id)
  if (fresh.length) {
    const rows = await tx
      .insert(siteRedirects)
      .values(
        fresh.map((e) => ({
          tenantId,
          fromPath: e.from,
          fromQuery: e.query,
          toPath: e.to,
          source: opts.source ?? 'manual',
          createdBy: by,
          updatedBy: by,
        })),
      )
      .onConflictDoUpdate({
        target: [siteRedirects.tenantId, siteRedirects.fromPath, siteRedirects.fromQuery],
        set: { toPath: sql`excluded.to_path`, updatedBy: by, updatedAt: new Date() },
      })
      .returning({ id: siteRedirects.id, from: siteRedirects.fromPath, query: siteRedirects.fromQuery })
    const ids = new Map(rows.map((r) => [keyOf(r.from, r.query), r.id]))
    for (const s of result.saved) s.id ??= ids.get(keyOf(s.from, s.query))
  }
  for (const e of all.values())
    if (e.id && e.to !== e.stored)
      await tx
        .update(siteRedirects)
        .set({ toPath: e.to, updatedBy: by })
        .where(and(eq(siteRedirects.id, e.id), eq(siteRedirects.tenantId, tenantId)))
  return result
}

/** Deletes the given redirects of the spa (RLS keeps it to the spa); the deleted rows. */
export async function deleteSiteRedirects(tx: Tx, ids: string[]): Promise<SiteRedirectRow[]> {
  if (!ids.length) return []
  return tx.delete(siteRedirects).where(inArray(siteRedirects.id, ids)).returning()
}

/** "Clear all": every redirect of the spa; how many there were. */
export async function deleteAllSiteRedirects(tx: Tx, tenantId: string): Promise<number> {
  const rows = await tx
    .delete(siteRedirects)
    .where(eq(siteRedirects.tenantId, tenantId))
    .returning({ id: siteRedirects.id })
  return rows.length
}

/**
 * The proxy's lookup (platform role, one query): the redirects that apply on a spa's site, found by its slug or an
 * active custom domain (a cancelled spa: none). A path-only redirect at the address of a visible page with a published
 * version, or of a published post, is left out — the page always wins, also when it is published later.
 */
export async function siteRedirectRules(
  db: DbOrTx,
  key: { slug: string } | { hostname: string },
): Promise<RedirectRule[]> {
  const tenant =
    'slug' in key
      ? sql`t.slug = ${key.slug.toLowerCase()}`
      : sql`exists (select 1 from domains d where d.tenant_id = t.id and d.hostname = ${key.hostname.toLowerCase()} and d.kind = 'custom' and d.status = 'active')`
  const { rows } = await db.execute<RedirectRule>(sql`
    select r.from_path as "from", r.from_query as "query", r.to_path as "to"
    from tenants t
    join site_redirects r on r.tenant_id = t.id
    where t.status <> 'cancelled' and ${tenant}
      and (r.from_query <> '' or (
        not exists (
          select 1 from site_pages sp
          where sp.tenant_id = t.id and sp.visible and ('/' || sp.slug) = r.from_path
            and exists (select 1 from page_versions pv where pv.page_id = sp.id and pv.status = 'published'))
        and not exists (
          select 1 from site_posts p
          where p.tenant_id = t.id and p.status = 'published' and ('/blog/' || p.slug) = r.from_path)))`)
  return rows
}
