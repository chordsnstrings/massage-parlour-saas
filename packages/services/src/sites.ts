// Tenant website: site settings, pages and Puck page versions (docs/PLAN.md §11).
import { createHmac, timingSafeEqual } from 'node:crypto'
import { pageVersions, savedSections, sitePages, sites, type ThemeTokens, type Tx } from '@spa/db'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { DomainError } from './errors'
import { collectGlobalIds } from './site-kit/tree'

export type SiteText = { en: string; ar?: string }
/** Puck page data: `{ root: { props }, content: [...] }`. */
export type PageData = Record<string, unknown>

/** A full-site template: theme tokens + starter pages. Templates are data, so new ones ship without migrations. */
export type SiteTemplate = {
  key: string
  name: string
  theme: ThemeTokens
  pages: { slug: string; title: SiteText; data: PageData }[]
}

export type SiteRow = typeof sites.$inferSelect
export type SitePageRow = typeof sitePages.$inferSelect
export type PageVersionRow = typeof pageVersions.$inferSelect

export const PAGE_SLUG = /^$|^[a-z0-9]+(?:-[a-z0-9]+)*$/

export async function getSite(tx: Tx, tenantId: string): Promise<SiteRow | null> {
  const [site] = await tx.select().from(sites).where(eq(sites.tenantId, tenantId)).limit(1)
  return site ?? null
}

/**
 * Returns the tenant's site, creating it on first use from `template` (site row, its pages and one draft
 * version per page). Idempotent: an existing site is returned unchanged.
 */
export async function ensureSite(
  tx: Tx,
  tenantId: string,
  template: SiteTemplate,
): Promise<{ site: SiteRow; created: boolean }> {
  const existing = await getSite(tx, tenantId)
  if (existing) return { site: existing, created: false }
  const [site] = await tx
    .insert(sites)
    .values({
      tenantId,
      templateKey: template.key,
      theme: template.theme,
      locales: ['en', 'ar'],
      defaultLocale: 'en',
    })
    .onConflictDoNothing()
    .returning()
  // Lost a race with a concurrent first visit: use the winner's site.
  if (!site) return { site: (await getSite(tx, tenantId))!, created: false }
  for (const [i, p] of template.pages.entries()) {
    const [page] = await tx
      .insert(sitePages)
      .values({ tenantId, siteId: site.id, slug: p.slug, title: p.title, sort: i })
      .returning()
    await tx.insert(pageVersions).values({ tenantId, pageId: page!.id, data: p.data, status: 'draft' })
  }
  return { site, created: true }
}

export type PageSummary = SitePageRow & {
  /** When the newest version (draft or published) was saved. */
  editedAt: Date | null
  publishedAt: Date | null
  /** The newest version is a draft that differs from what's live. */
  hasDraft: boolean
}

/** Pages in menu order with their latest draft / published timestamps. */
export async function listPages(tx: Tx, tenantId: string): Promise<PageSummary[]> {
  const pages = await tx
    .select()
    .from(sitePages)
    .where(eq(sitePages.tenantId, tenantId))
    .orderBy(asc(sitePages.sort), asc(sitePages.createdAt))
  if (!pages.length) return []
  const versions = await tx
    .select({
      pageId: pageVersions.pageId,
      status: pageVersions.status,
      createdAt: pageVersions.createdAt,
    })
    .from(pageVersions)
    .where(
      inArray(
        pageVersions.pageId,
        pages.map((p) => p.id),
      ),
    )
    .orderBy(desc(pageVersions.createdAt))
  return pages.map((p) => {
    const mine = versions.filter((v) => v.pageId === p.id)
    const latest = mine[0]
    const published = mine.find((v) => v.status === 'published')
    return {
      ...p,
      editedAt: latest?.createdAt ?? null,
      publishedAt: published?.createdAt ?? null,
      hasDraft: latest?.status === 'draft',
    }
  })
}

export async function getPage(tx: Tx, tenantId: string, pageId: string): Promise<SitePageRow | null> {
  const [page] = await tx
    .select()
    .from(sitePages)
    .where(and(eq(sitePages.tenantId, tenantId), eq(sitePages.id, pageId)))
    .limit(1)
  return page ?? null
}

/** Strictly increasing version timestamps, so "newest" is unambiguous even within one transaction. */
const stamp = (after?: { createdAt: Date } | null) =>
  new Date(Math.max(Date.now(), (after?.createdAt.getTime() ?? 0) + 1))

async function latestVersion(tx: Tx, tenantId: string, pageId: string, status?: 'draft' | 'published') {
  const [v] = await tx
    .select()
    .from(pageVersions)
    .where(
      and(
        eq(pageVersions.tenantId, tenantId),
        eq(pageVersions.pageId, pageId),
        status ? eq(pageVersions.status, status) : undefined,
      ),
    )
    .orderBy(desc(pageVersions.createdAt))
    .limit(1)
  return v ?? null
}

/** What the editor opens: the newest version of a page, draft or published. */
export async function getEditablePage(tx: Tx, tenantId: string, pageId: string) {
  const page = await getPage(tx, tenantId, pageId)
  if (!page) return null
  const version = await latestVersion(tx, tenantId, pageId)
  return { page, version, data: (version?.data ?? { root: { props: {} }, content: [] }) as PageData }
}

/** The editable version of a page by slug (used for previews). */
export async function getDraftBySlug(tx: Tx, tenantId: string, slug: string) {
  const [page] = await tx
    .select()
    .from(sitePages)
    .where(and(eq(sitePages.tenantId, tenantId), eq(sitePages.slug, slug)))
    .limit(1)
  return page ? getEditablePage(tx, tenantId, page.id) : null
}

/** The live version of a visible page (slug '' = home), or null when it was never published. */
export async function getPublishedPage(tx: Tx, tenantId: string, slug: string) {
  const site = await getSite(tx, tenantId)
  if (!site) return null
  const [page] = await tx
    .select()
    .from(sitePages)
    .where(and(eq(sitePages.siteId, site.id), eq(sitePages.slug, slug), eq(sitePages.visible, true)))
    .limit(1)
  if (!page) return null
  const version = await latestVersion(tx, tenantId, page.id, 'published')
  if (!version) return null
  return { site, page, version, data: version.data as PageData }
}

/** Visible pages that have a published version, for the public navigation. */
export async function listPublishedPages(tx: Tx, tenantId: string) {
  return (await listPages(tx, tenantId)).filter((p) => p.visible && p.publishedAt)
}

/**
 * Saves the editor state as the page's draft. The newest draft is updated in place (autosave-friendly);
 * once a version is published, the next save starts a new draft so published history is never rewritten.
 */
export async function saveDraft(
  tx: Tx,
  input: { tenantId: string; pageId: string; data: PageData; userId?: string },
): Promise<PageVersionRow> {
  const page = await getPage(tx, input.tenantId, input.pageId)
  if (!page) throw new DomainError('Page not found', 'not_found')
  const latest = await latestVersion(tx, input.tenantId, input.pageId)
  // The working draft is updated in place; a named draft is kept as it is and a new draft starts after it.
  if (latest?.status === 'draft' && !latest.label) {
    const [updated] = await tx
      .update(pageVersions)
      .set({ data: input.data, createdBy: input.userId ?? latest.createdBy, createdAt: stamp(latest) })
      .where(eq(pageVersions.id, latest.id))
      .returning()
    return updated!
  }
  const [created] = await tx
    .insert(pageVersions)
    .values({
      tenantId: input.tenantId,
      pageId: input.pageId,
      data: input.data,
      status: 'draft',
      createdBy: input.userId ?? null,
      createdAt: stamp(latest),
    })
    .returning()
  return created!
}

/** Publishes `data` (or the current draft) as the live version of the page. */
export async function publishPage(
  tx: Tx,
  input: { tenantId: string; pageId: string; data?: PageData; userId?: string; label?: string },
): Promise<PageVersionRow> {
  const page = await getPage(tx, input.tenantId, input.pageId)
  if (!page) throw new DomainError('Page not found', 'not_found')
  const latest = await latestVersion(tx, input.tenantId, input.pageId)
  const data = input.data ?? latest?.data
  if (!data) throw new DomainError('Nothing to publish yet')
  // Promote the draft in place, unless it is a named draft that new content would overwrite.
  if (latest?.status === 'draft' && (!latest.label || !input.data)) {
    const [promoted] = await tx
      .update(pageVersions)
      .set({
        data,
        status: 'published',
        label: input.label ?? latest.label,
        createdBy: input.userId ?? latest.createdBy,
        createdAt: stamp(latest),
      })
      .where(eq(pageVersions.id, latest.id))
      .returning()
    return promoted!
  }
  const [created] = await tx
    .insert(pageVersions)
    .values({
      tenantId: input.tenantId,
      pageId: input.pageId,
      data,
      status: 'published',
      label: input.label ?? null,
      createdBy: input.userId ?? null,
      createdAt: stamp(latest),
    })
    .returning()
  return created!
}

/** Version history for a page, newest first (data omitted). */
export async function listVersions(tx: Tx, tenantId: string, pageId: string, limit = 20) {
  return tx
    .select({
      id: pageVersions.id,
      status: pageVersions.status,
      label: pageVersions.label,
      createdBy: pageVersions.createdBy,
      createdAt: pageVersions.createdAt,
    })
    .from(pageVersions)
    .where(and(eq(pageVersions.tenantId, tenantId), eq(pageVersions.pageId, pageId)))
    .orderBy(desc(pageVersions.createdAt))
    .limit(limit)
}

/**
 * Applies another template. Theme tokens are always swapped and page content kept; with `replaceContent`
 * the template's starter pages are saved as new drafts (missing pages are created), nothing goes live until
 * it is published.
 */
export async function switchTemplate(
  tx: Tx,
  tenantId: string,
  template: SiteTemplate,
  opts: { replaceContent?: boolean; userId?: string } = {},
): Promise<SiteRow> {
  const { site, created } = await ensureSite(tx, tenantId, template)
  const [updated] = await tx
    .update(sites)
    .set({ templateKey: template.key, theme: template.theme })
    .where(eq(sites.id, site.id))
    .returning()
  if (opts.replaceContent && !created) {
    const pages = await listPages(tx, tenantId)
    for (const [i, p] of template.pages.entries()) {
      let page = pages.find((x) => x.slug === p.slug)
      if (!page) {
        const [row] = await tx
          .insert(sitePages)
          .values({ tenantId, siteId: site.id, slug: p.slug, title: p.title, sort: pages.length + i })
          .returning()
        page = { ...row!, editedAt: null, publishedAt: null, hasDraft: false }
      }
      await saveDraft(tx, { tenantId, pageId: page!.id, data: p.data, userId: opts.userId })
    }
  }
  return updated!
}

/** Replaces the site's theme tokens (validated by the caller). Live immediately: tokens apply to published pages. */
export async function updateTheme(tx: Tx, tenantId: string, theme: ThemeTokens): Promise<SiteRow> {
  const [site] = await tx.update(sites).set({ theme }).where(eq(sites.tenantId, tenantId)).returning()
  if (!site) throw new DomainError('Choose a template first', 'not_found')
  return site
}

/** Publishes every page's current draft (the "Publish site" button). Returns how many pages changed. */
export async function publishAll(tx: Tx, tenantId: string, userId?: string): Promise<number> {
  const pages = await listPages(tx, tenantId)
  let changed = 0
  for (const p of pages) {
    if (!p.hasDraft) continue
    await publishPage(tx, { tenantId, pageId: p.id, userId })
    changed++
  }
  return changed
}

/** Shows or hides a page from the public site and its navigation. */
export async function setPageVisible(tx: Tx, tenantId: string, pageId: string, visible: boolean) {
  const page = await getPage(tx, tenantId, pageId)
  if (!page) throw new DomainError('Page not found', 'not_found')
  if (!visible && page.slug === '') throw new DomainError('The home page is always visible')
  const [updated] = await tx
    .update(sitePages)
    .set({ visible })
    .where(and(eq(sitePages.tenantId, tenantId), eq(sitePages.id, pageId)))
    .returning()
  return updated!
}

/* ------------------------------------------------------------------ Versions (editor history drawer) */

/** Names a version ("Before Ramadan"); an empty label clears it. */
export async function labelVersion(tx: Tx, tenantId: string, versionId: string, label: string | null) {
  const [row] = await tx
    .update(pageVersions)
    .set({ label: label?.trim() || null })
    .where(and(eq(pageVersions.tenantId, tenantId), eq(pageVersions.id, versionId)))
    .returning({ id: pageVersions.id, pageId: pageVersions.pageId, label: pageVersions.label })
  if (!row) throw new DomainError('Version not found', 'not_found')
  return row
}

export async function getVersion(tx: Tx, tenantId: string, versionId: string) {
  const [row] = await tx
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.tenantId, tenantId), eq(pageVersions.id, versionId)))
    .limit(1)
  return row ?? null
}

/**
 * Restores an earlier version as a new draft. History is never rewritten: a saved draft stays in the list
 * behind it, and the published version stays live until the restored draft is published.
 */
export async function restoreVersion(
  tx: Tx,
  input: { tenantId: string; pageId: string; versionId: string; userId?: string },
) {
  const version = await getVersion(tx, input.tenantId, input.versionId)
  if (!version || version.pageId !== input.pageId) throw new DomainError('Version not found', 'not_found')
  const latest = await latestVersion(tx, input.tenantId, input.pageId)
  const [draft] = await tx
    .insert(pageVersions)
    .values({
      tenantId: input.tenantId,
      pageId: input.pageId,
      data: version.data,
      status: 'draft',
      createdBy: input.userId ?? null,
      createdAt: stamp(latest),
    })
    .returning()
  return { draft: draft!, data: version.data as PageData }
}

/* ------------------------------------------------------------------ Saved & global sections */

export type SavedSectionRow = typeof savedSections.$inferSelect

/** The section library: global sections first, then by name. */
export async function listSavedSections(tx: Tx, tenantId: string): Promise<SavedSectionRow[]> {
  return tx
    .select()
    .from(savedSections)
    .where(eq(savedSections.tenantId, tenantId))
    .orderBy(desc(savedSections.isGlobal), asc(savedSections.name))
}

export async function createSavedSection(
  tx: Tx,
  input: { tenantId: string; name: string; data: Record<string, unknown>; isGlobal: boolean },
): Promise<SavedSectionRow> {
  const [row] = await tx
    .insert(savedSections)
    .values({ tenantId: input.tenantId, name: input.name.trim(), data: input.data, isGlobal: input.isGlobal })
    .returning()
  return row!
}

/** Renames a saved section and/or replaces its block (a global section's edit shows on every page at once). */
export async function updateSavedSection(
  tx: Tx,
  tenantId: string,
  id: string,
  patch: { name?: string; data?: Record<string, unknown> },
): Promise<SavedSectionRow> {
  const [row] = await tx
    .update(savedSections)
    .set({
      ...(patch.name ? { name: patch.name.trim() } : {}),
      ...(patch.data ? { data: patch.data } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(savedSections.tenantId, tenantId), eq(savedSections.id, id)))
    .returning()
  if (!row) throw new DomainError('Saved section not found', 'not_found')
  return row
}

/** Global sections referenced by GlobalSection blocks in `data`, keyed by id (deleted ones are absent). */
export async function globalSectionsFor(
  tx: Tx,
  tenantId: string,
  data: unknown,
): Promise<Record<string, Record<string, unknown>>> {
  const ids = collectGlobalIds(data).filter((id) => UUID.test(id))
  if (!ids.length) return {}
  const rows = await tx
    .select({ id: savedSections.id, data: savedSections.data })
    .from(savedSections)
    .where(
      and(
        eq(savedSections.tenantId, tenantId),
        eq(savedSections.isGlobal, true),
        inArray(savedSections.id, ids),
      ),
    )
  return Object.fromEntries(rows.map((r) => [r.id, r.data]))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Pages whose newest version or live version shows global section `id` (`live` only: pages where visitors
 * see it now). Reads at most two versions per page, however long the history.
 */
export async function globalSectionUsage(
  tx: Tx,
  tenantId: string,
  id: string,
  opts: { live?: boolean } = {},
): Promise<string[]> {
  const newest = (status?: 'published') =>
    tx
      .selectDistinctOn([pageVersions.pageId], { pageId: pageVersions.pageId, data: pageVersions.data })
      .from(pageVersions)
      .where(and(eq(pageVersions.tenantId, tenantId), status ? eq(pageVersions.status, status) : undefined))
      .orderBy(pageVersions.pageId, desc(pageVersions.createdAt))
  const rows = [...(opts.live ? [] : await newest()), ...(await newest('published'))]
  return [...new Set(rows.filter((r) => collectGlobalIds(r.data).includes(id)).map((r) => r.pageId))]
}

/** Deletes a saved section; a global one still placed on a page must be removed from those pages first. */
export async function deleteSavedSection(tx: Tx, tenantId: string, id: string): Promise<SavedSectionRow> {
  const [row] = await tx
    .select()
    .from(savedSections)
    .where(and(eq(savedSections.tenantId, tenantId), eq(savedSections.id, id)))
    .limit(1)
  if (!row) throw new DomainError('Saved section not found', 'not_found')
  if (row.isGlobal) {
    const pages = await globalSectionUsage(tx, tenantId, id)
    if (pages.length)
      throw new DomainError(
        `This global section is on ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} — remove it there first.`,
      )
  }
  await tx.delete(savedSections).where(and(eq(savedSections.tenantId, tenantId), eq(savedSections.id, id)))
  return row
}

/* ------------------------------------------------------------------ Shareable draft preview links */

export type PreviewClaims = { tenantId: string; pageId: string; exp: number }

const mac = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(`page-preview.${payload}`).digest('base64url')

/** Signed, expiring token for viewing a page's draft without signing in (HMAC-SHA256). */
export function signPreviewToken(
  claims: { tenantId: string; pageId: string; expiresAt: Date },
  secret: string,
): string {
  if (!secret) throw new Error('A signing secret is required')
  const payload = Buffer.from(
    JSON.stringify({
      t: claims.tenantId,
      p: claims.pageId,
      e: Math.floor(claims.expiresAt.getTime() / 1000),
    }),
  ).toString('base64url')
  return `${payload}.${mac(payload, secret)}`
}

/** The token's claims, or null when it is malformed, tampered with or expired. */
export function verifyPreviewToken(token: unknown, secret: string, now = new Date()): PreviewClaims | null {
  if (!secret || typeof token !== 'string' || token.length > 600) return null
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return null
  const expected = Buffer.from(mac(payload, secret))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      t?: unknown
      p?: unknown
      e?: unknown
    }
    if (typeof raw.t !== 'string' || typeof raw.p !== 'string' || typeof raw.e !== 'number') return null
    if (raw.e * 1000 <= now.getTime()) return null
    return { tenantId: raw.t, pageId: raw.p, exp: raw.e }
  } catch {
    return null
  }
}
