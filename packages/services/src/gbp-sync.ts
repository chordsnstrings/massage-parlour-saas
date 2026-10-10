// F17: what the spa's Google connection does for its website — the Business Profile "Book" button (Place Actions
// APPOINTMENT link → online booking page, `?src=google`) and Search Console sitemap submission. State lives in the
// `gbp` social_accounts row's meta (merged with jsonb `||`, so concurrent review syncs never lose it). Google calls run
// outside tenant transactions; failures are stored as a GoogleErrorCode the dashboard translates (EN/TH).
import { type Db, platformDb, socialAccounts, type Tx, tenants, withTenant } from '@spa/db'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { entitledSql } from './entitlements'
import { DomainError } from './errors'
import { GBP_PENDING_ID, GbpAuthError, type GbpOpts, getGbpAccount, withGbpToken } from './gbp'
import {
  addScSite,
  createBookLink,
  deleteBookLink,
  findOurBookLink,
  GoogleApiError,
  type GoogleErrorCode,
  getScSitemap,
  googleConfig,
  googleErrorCode,
  listBookLinks,
  listScSites,
  pickScProperty,
  SEARCH_CONSOLE_SCOPE,
  scPropertyCandidates,
  submitScSitemap,
  updateBookLink,
} from './integrations/google'
import { bookingLink, publicSiteBase, sitemapUrlOf } from './site-url'

type Row = typeof socialAccounts.$inferSelect
const LIVE = ['trial', 'active', 'past_due'] as const
/** A failed Book-button sync is retried by the worker at most this often. */
const BOOK_RETRY_MS = 6 * 3600_000
/** Publishing several pages in a row submits the sitemap once (the worker waits this long after the last publish). */
const SITEMAP_DEBOUNCE_MS = 2 * 60_000

/** The F13 entry tag the Book button carries (owner spec: Google attribution, `?src=google`). */
export const GOOGLE_BOOK_SRC = 'google'
export const googleBookingUrl = (siteBase: string) => bookingLink(siteBase, GOOGLE_BOOK_SRC)

const iso = (s: string | undefined) => {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}
const codeOf = (s: string | undefined): GoogleErrorCode | null => (s ? (s as GoogleErrorCode) : null)

/** Merges keys into the row's meta (null = remove) in one statement. */
async function mergeMeta(tx: Tx, rowId: string, patch: Record<string, string | null>) {
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null)) as Record<
    string,
    string
  >
  const drop = Object.keys(patch).filter((k) => patch[k] === null)
  const merged = sql`(${socialAccounts.meta} || ${JSON.stringify(set)}::jsonb)`
  await tx
    .update(socialAccounts)
    .set({
      meta: drop.length
        ? sql`${merged} - array[${sql.join(
            drop.map((k) => sql`${k}`),
            sql`, `,
          )}]::text[]`
        : merged,
    })
    .where(eq(socialAccounts.id, rowId))
}

const errorPatch = (prefix: 'book' | 'sc', e: unknown) => {
  const code: GoogleErrorCode = e instanceof GbpAuthError ? 'auth' : googleErrorCode(e)
  const detail =
    e instanceof GoogleApiError
      ? `${e.status}${e.detail ? ` ${e.detail}` : ''}: ${e.message}`
      : e instanceof Error
        ? e.message
        : ''
  return { code, patch: { [`${prefix}Error`]: code, [`${prefix}ErrorDetail`]: detail.slice(0, 240) } }
}

// ── Views ───────────────────────────────────────────────────────────────────

export type GbpBookView = {
  enabled: boolean
  uri: string | null
  syncedAt: Date | null
  error: GoogleErrorCode | null
  detail: string | null
}

/** The Book-button state for the card (null = no location chosen yet). */
export function gbpBookView(row: Row | null): GbpBookView | null {
  if (!row || row.externalId === GBP_PENDING_ID) return null
  const m = row.meta ?? {}
  return {
    enabled: m.bookAction === 'on',
    uri: m.bookUri || null,
    syncedAt: iso(m.bookSyncedAt),
    error: codeOf(m.bookError),
    detail: m.bookErrorDetail || null,
  }
}

export type SearchConsoleState = 'submitted' | 'needs_verification' | 'no_access' | 'error'
export type GbpSearchConsoleView = {
  hasScope: boolean
  state: SearchConsoleState | null
  siteUrl: string | null
  sitemapUrl: string | null
  submittedAt: Date | null
  pending: boolean
  due: boolean
  error: GoogleErrorCode | null
  detail: string | null
}

export const hasSearchConsoleScope = (row: Pick<Row, 'scopes'> | null) =>
  Boolean(row?.scopes?.includes(SEARCH_CONSOLE_SCOPE))

export function gbpSearchConsoleView(row: Row | null): GbpSearchConsoleView | null {
  if (!row) return null
  const m = row.meta ?? {}
  return {
    hasScope: hasSearchConsoleScope(row),
    state: (m.scState as SearchConsoleState) || null,
    siteUrl: m.scSiteUrl || null,
    sitemapUrl: m.scSitemapUrl || null,
    submittedAt: iso(m.scSubmittedAt),
    pending: m.scPending === '1',
    due: Boolean(m.scDueAt),
    error: codeOf(m.scError),
    detail: m.scErrorDetail || null,
  }
}

// ── Book button (Place Actions) ─────────────────────────────────────────────

export type BookSyncResult =
  | { ok: true; uri: string; name: string; changed: boolean }
  | { ok: false; code: GoogleErrorCode }

async function loadRow(opts: GbpOpts) {
  const row = await withTenant(opts.tenantId, (tx) => getGbpAccount(tx, opts.tenantId), opts.db)
  if (!row) throw new DomainError('Connect Google Business Profile first.', 'not_found')
  const location = row.meta?.locationName
  if (row.externalId === GBP_PENDING_ID || !location)
    throw new DomainError('Choose your Google Business Profile location first.')
  return { row, location }
}

/**
 * Turns the Book button on (or re-points it): finds our APPOINTMENT link on the location (stored name, else one with
 * our address), patches it to `bookingUrl` as the preferred link, or creates it. Stores the outcome either way.
 */
export async function setGbpBookAction(
  opts: GbpOpts & { bookingUrl: string; knownUris?: string[] },
): Promise<BookSyncResult> {
  const now = opts.now ?? new Date()
  const { row, location } = await loadRow(opts)
  const m = row.meta ?? {}
  const uris = [opts.bookingUrl, m.bookUri, ...(opts.knownUris ?? [])].filter((u): u is string => Boolean(u))
  try {
    const res = await withGbpToken(opts, async (token) => {
      const links = await listBookLinks(token, location, opts.fetch)
      const ours = findOurBookLink(links, { name: m.bookLinkName, uris })
      if (ours) {
        if (ours.uri === opts.bookingUrl && ours.isPreferred) return { link: ours, changed: false }
        return { link: await updateBookLink(token, ours.name, opts.bookingUrl, opts.fetch), changed: true }
      }
      try {
        return { link: await createBookLink(token, location, opts.bookingUrl, opts.fetch), changed: true }
      } catch (e) {
        // Same (uri, type) already on the location but not editable by us or created elsewhere: adopt it if we can.
        if (!(e instanceof GoogleApiError && e.status === 409)) throw e
        const again = findOurBookLink(await listBookLinks(token, location, opts.fetch), { uris })
        if (!again) throw e
        return { link: again, changed: false }
      }
    })
    await withTenant(
      opts.tenantId,
      (tx) =>
        mergeMeta(tx, row.id, {
          bookAction: 'on',
          bookUri: res.link.uri || opts.bookingUrl,
          bookLinkName: res.link.name,
          bookSyncedAt: now.toISOString(),
          bookTriedAt: now.toISOString(),
          bookTriedUri: opts.bookingUrl,
          bookError: null,
          bookErrorDetail: null,
        }),
      opts.db,
    )
    return { ok: true, uri: res.link.uri || opts.bookingUrl, name: res.link.name, changed: res.changed }
  } catch (e) {
    if (e instanceof DomainError) throw e
    const { code, patch } = errorPatch('book', e)
    await withTenant(
      opts.tenantId,
      (tx) =>
        mergeMeta(tx, row.id, {
          bookAction: 'on',
          bookTriedAt: now.toISOString(),
          bookTriedUri: opts.bookingUrl,
          ...patch,
        }),
      opts.db,
    )
    return { ok: false, code }
  }
}

/** Turns the Book button off: deletes our link at Google (other providers' links stay) and forgets it here. */
export async function removeGbpBookAction(
  opts: GbpOpts & { bookingUrl?: string },
): Promise<{ ok: true; removed: boolean } | { ok: false; code: GoogleErrorCode }> {
  const { row, location } = await loadRow(opts)
  const m = row.meta ?? {}
  const uris = [m.bookUri, opts.bookingUrl].filter((u): u is string => Boolean(u))
  try {
    const removed = await withGbpToken(opts, async (token) => {
      const ours = findOurBookLink(await listBookLinks(token, location, opts.fetch), {
        name: m.bookLinkName,
        uris,
      })
      if (!ours) return false
      await deleteBookLink(token, ours.name, opts.fetch)
      return true
    })
    await withTenant(
      opts.tenantId,
      (tx) =>
        mergeMeta(tx, row.id, {
          bookAction: null,
          bookUri: null,
          bookLinkName: null,
          bookSyncedAt: null,
          bookTriedAt: null,
          bookTriedUri: null,
          bookError: null,
          bookErrorDetail: null,
        }),
      opts.db,
    )
    return { ok: true, removed }
  } catch (e) {
    const { code, patch } = errorPatch('book', e)
    await withTenant(opts.tenantId, (tx) => mergeMeta(tx, row.id, patch), opts.db)
    return { ok: false, code }
  }
}

export type GbpJobOpts = {
  platform?: Db
  app?: Db
  fetch?: typeof fetch
  now?: Date
  env?: Record<string, string | undefined>
}

/** Connected locations of live Premium spas (platform role) — the worker's F17 work list. */
async function connectedLocations(o: GbpJobOpts, extra: SQL) {
  return (o.platform ?? platformDb())
    .select({ tenantId: socialAccounts.tenantId, slug: tenants.slug, meta: socialAccounts.meta })
    .from(socialAccounts)
    .innerJoin(tenants, eq(tenants.id, socialAccounts.tenantId))
    .where(
      and(
        eq(socialAccounts.platform, 'gbp'),
        inArray(socialAccounts.status, ['connected', 'pending_location']),
        inArray(tenants.status, [...LIVE]),
        entitledSql('marketing'),
        extra,
      ),
    )
}

/**
 * Worker (every 10 min): re-points Book buttons whose booking address changed (custom domain added, made primary or
 * removed; platform domain move) and retries failed ones every 6 hours. Only DB reads unless something changed.
 */
export async function syncGbpBookActions(o: GbpJobOpts = {}) {
  const result = { checked: 0, updated: 0, failed: 0 }
  if (!googleConfig(o.env)) return result
  const now = o.now ?? new Date()
  const rows = await connectedLocations(
    o,
    sql`${socialAccounts.meta} ->> 'bookAction' = 'on' and ${socialAccounts.externalId} <> ${GBP_PENDING_ID}`,
  )
  for (const r of rows) {
    result.checked++
    const base = await withTenant(r.tenantId, (tx) => publicSiteBase(tx, r.slug, o.env), o.app)
    const desired = googleBookingUrl(base.url)
    const tried = iso(r.meta.bookTriedAt)
    if (!r.meta.bookError && desired === r.meta.bookUri) continue
    // A new address is pushed at once; the same address that failed waits for the 6-hour retry.
    const retryDue = !tried || now.getTime() - tried.getTime() >= BOOK_RETRY_MS
    if (r.meta.bookError && desired === r.meta.bookTriedUri && !retryDue) continue
    try {
      const res = await setGbpBookAction({
        tenantId: r.tenantId,
        db: o.app,
        fetch: o.fetch,
        now,
        env: o.env,
        bookingUrl: desired,
      })
      if (res.ok) result.updated++
      else result.failed++
    } catch {
      result.failed++
    }
  }
  return result
}

// ── Search Console ──────────────────────────────────────────────────────────

export type SitemapSubmitResult =
  | { ok: true; state: 'submitted'; siteUrl: string; sitemapUrl: string }
  | { ok: false; state: Exclude<SearchConsoleState, 'submitted'>; code?: GoogleErrorCode }

/**
 * Submits the site's sitemap with the connected Google account: picks a Search Console property this account owns or
 * fully manages that covers the address (URL prefix or Domain property) and calls sitemaps.submit. Without one, a
 * custom domain is added as a URL-prefix property (sites.add — the spa then verifies it in Search Console) and the
 * free platform address reports `no_access` (the platform's own property covers it; owner step).
 */
export async function submitGbpSitemap(
  opts: GbpOpts & { siteBase: string; custom: boolean },
): Promise<SitemapSubmitResult> {
  const now = opts.now ?? new Date()
  const row = await withTenant(opts.tenantId, (tx) => getGbpAccount(tx, opts.tenantId), opts.db)
  if (!row) throw new DomainError('Connect Google Business Profile first.', 'not_found')
  const sitemapUrl = sitemapUrlOf(opts.siteBase)
  const save = (patch: Record<string, string | null>) =>
    withTenant(
      opts.tenantId,
      (tx) => mergeMeta(tx, row.id, { scSitemapUrl: sitemapUrl, scDueAt: null, ...patch }),
      opts.db,
    )
  if (!hasSearchConsoleScope(row)) {
    await save({ scState: 'error', scError: 'scope', scErrorDetail: null })
    return { ok: false, state: 'error', code: 'scope' }
  }
  try {
    const outcome = await withGbpToken(opts, async (token) => {
      const sites = await listScSites(token, opts.fetch)
      const property = pickScProperty(sites, scPropertyCandidates(opts.siteBase))
      if (property) {
        await submitScSitemap(token, property.siteUrl, sitemapUrl, opts.fetch)
        const info = await getScSitemap(token, property.siteUrl, sitemapUrl, opts.fetch).catch(() => ({}))
        return { kind: 'submitted' as const, siteUrl: property.siteUrl, info }
      }
      const prefix = `${new URL(opts.siteBase).origin}/`
      if (!opts.custom) return { kind: 'no_access' as const, siteUrl: prefix }
      if (!sites.some((s) => s.siteUrl === prefix)) await addScSite(token, prefix, opts.fetch)
      return { kind: 'needs_verification' as const, siteUrl: prefix }
    })
    if (outcome.kind === 'submitted') {
      const info = outcome.info as { lastSubmitted?: string; isPending?: boolean }
      await save({
        scState: 'submitted',
        scSiteUrl: outcome.siteUrl,
        scSubmittedAt: (iso(info.lastSubmitted) ?? now).toISOString(),
        scPending: info.isPending ? '1' : null,
        scError: null,
        scErrorDetail: null,
      })
      return { ok: true, state: 'submitted', siteUrl: outcome.siteUrl, sitemapUrl }
    }
    await save({ scState: outcome.kind, scSiteUrl: outcome.siteUrl, scError: null, scErrorDetail: null })
    return { ok: false, state: outcome.kind }
  } catch (e) {
    if (e instanceof DomainError) throw e
    const { code, patch } = errorPatch('sc', e)
    await save({ scState: 'error', ...patch })
    return { ok: false, state: 'error', code }
  }
}

/**
 * Publishing the site queues a sitemap submission (the worker sends it a couple of minutes after the last publish).
 * No-op without a Google connection.
 */
export async function markSitemapDue(tx: Tx, tenantId: string, now = new Date()) {
  const row = await getGbpAccount(tx, tenantId)
  if (!row || !hasSearchConsoleScope(row)) return false
  await mergeMeta(tx, row.id, { scDueAt: now.toISOString() })
  return true
}

/** Worker (every 10 min): submits queued sitemaps of live Premium spas (debounced after the last publish). */
export async function submitDueSitemaps(o: GbpJobOpts = {}) {
  const result = { submitted: 0, notSubmitted: 0 }
  if (!googleConfig(o.env)) return result
  const now = o.now ?? new Date()
  const cutoff = new Date(now.getTime() - SITEMAP_DEBOUNCE_MS).toISOString()
  const rows = await connectedLocations(
    o,
    sql`${socialAccounts.meta} ? 'scDueAt' and ${socialAccounts.meta} ->> 'scDueAt' <= ${cutoff}`,
  )
  for (const r of rows) {
    try {
      const base = await withTenant(r.tenantId, (tx) => publicSiteBase(tx, r.slug, o.env), o.app)
      const res = await submitGbpSitemap({
        tenantId: r.tenantId,
        db: o.app,
        fetch: o.fetch,
        now,
        env: o.env,
        siteBase: base.url,
        custom: base.custom,
      })
      if (res.ok) result.submitted++
      else result.notSubmitted++
    } catch {
      result.notSubmitted++
    }
  }
  return result
}
