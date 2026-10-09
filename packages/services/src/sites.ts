// Tenant website: site settings, pages and Puck page versions (docs/PLAN.md §11).
import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  pageVersions,
  savedSections,
  sitePages,
  sites,
  type TemplateUndo,
  type ThemeTokens,
  type Tx,
  tenants,
} from '@spa/db'
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
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
  await publishPendingChanges(tx, input.tenantId, page)
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

/**
 * Unpublished site settings go live with a publish: the draft theme (AI edits, site-wide) and this page's pending
 * rename. Drafts never reach visitors before that.
 */
async function publishPendingChanges(tx: Tx, tenantId: string, page: SitePageRow) {
  await tx
    .update(sites)
    .set({ theme: sql`${sites.themeDraft}`, themeDraft: null })
    .where(and(eq(sites.tenantId, tenantId), isNotNull(sites.themeDraft)))
  if (page.pending)
    await tx
      .update(sitePages)
      .set({
        ...(page.pending.title ? { title: page.pending.title } : {}),
        ...(page.pending.slug !== undefined ? { slug: page.pending.slug } : {}),
        pending: null,
      })
      .where(and(eq(sitePages.tenantId, tenantId), eq(sitePages.id, page.id)))
}

/** The theme the editor and previews show: the unpublished draft theme when there is one, else the live theme. */
export const editingTheme = (site: Pick<SiteRow, 'theme' | 'themeDraft'>): ThemeTokens =>
  site.themeDraft ?? site.theme

/** Saves theme tokens as the site's DRAFT theme (validated by the caller); live on the next publish. */
export async function updateDraftTheme(tx: Tx, tenantId: string, theme: ThemeTokens): Promise<SiteRow> {
  const [site] = await tx
    .update(sites)
    .set({ themeDraft: theme })
    .where(eq(sites.tenantId, tenantId))
    .returning()
  if (!site) throw new DomainError('Choose a template first', 'not_found')
  return site
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
 * Applies another template. Theme tokens are swapped (kept with `keepTheme`) and page content kept; with
 * `replaceContent` the template's starter pages are saved as new drafts (missing pages are created), nothing
 * goes live until it is published. The previous template, theme and drafts are kept on the site for undo.
 */
export async function switchTemplate(
  tx: Tx,
  tenantId: string,
  template: SiteTemplate,
  opts: { replaceContent?: boolean; keepTheme?: boolean; userId?: string } = {},
): Promise<SiteRow> {
  const { site, created } = await ensureSite(tx, tenantId, template)
  const theme = opts.keepTheme ? site.theme : template.theme
  const undo: TemplateUndo | null = created
    ? null
    : {
        templateKey: site.templateKey,
        theme: site.theme,
        appliedTheme: theme,
        at: new Date().toISOString(),
        pages: [],
      }
  if (opts.replaceContent && undo) {
    const pages = await listPages(tx, tenantId)
    let sort = pages.reduce((max, p) => Math.max(max, p.sort), -1)
    for (const p of template.pages) {
      const existing = pages.find((x) => x.slug === p.slug)
      let page: SitePageRow | undefined = existing
      let draft: PageData | null = null
      if (page) {
        const latest = await latestVersion(tx, tenantId, page.id)
        if (latest?.status === 'draft') draft = latest.data
      } else {
        ;[page] = await tx
          .insert(sitePages)
          .values({ tenantId, siteId: site.id, slug: p.slug, title: p.title, sort: ++sort })
          .returning()
      }
      const written = await saveDraft(tx, { tenantId, pageId: page!.id, data: p.data, userId: opts.userId })
      undo.pages.push({
        pageId: page!.id,
        created: !existing,
        draft,
        versionId: written.id,
        savedAt: written.createdAt.toISOString(),
      })
    }
  }
  const [updated] = await tx
    .update(sites)
    .set({ templateKey: template.key, theme, themeDraft: null, ...(undo ? { templateUndo: undo } : {}) })
    .where(eq(sites.id, site.id))
    .returning()
  return updated!
}

const sameTokens = (a: ThemeTokens, b: ThemeTokens | undefined) =>
  !!b && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v)

/**
 * What has changed since the last template switch wrote it: 'Theme' and/or the titles of pages saved or
 * published since. Undo is only offered (and only allowed) while this is empty, so it never discards later work.
 */
export async function templateUndoChanges(
  tx: Tx,
  tenantId: string,
  site?: SiteRow | null,
): Promise<string[]> {
  const current = site === undefined ? await getSite(tx, tenantId) : site
  const undo = current?.templateUndo
  if (!current || !undo) return []
  const changed = sameTokens(current.theme, undo.appliedTheme) ? [] : ['Theme']
  for (const p of undo.pages) {
    const page = await getPage(tx, tenantId, p.pageId)
    if (!page) continue
    const latest = await latestVersion(tx, tenantId, page.id)
    const untouched =
      latest?.id === p.versionId &&
      latest.status === 'draft' &&
      latest.createdAt.getTime() === Date.parse(p.savedAt)
    if (!untouched) changed.push(page.title.en)
  }
  return changed
}

/**
 * Reverts the last template switch: previous template key and theme, each replaced page's previous draft
 * (or no draft), and pages the switch added. Refused once anything the switch wrote has been edited since.
 */
export async function undoTemplateSwitch(tx: Tx, tenantId: string, userId?: string): Promise<SiteRow> {
  const site = await getSite(tx, tenantId)
  const undo = site?.templateUndo
  if (!site || !undo) throw new DomainError('There is no template change to undo')
  const changed = await templateUndoChanges(tx, tenantId, site)
  if (changed.length)
    throw new DomainError(
      `Undo is no longer available: ${changed.join(', ')} changed since the switch. Your edits are kept.`,
    )
  for (const p of undo.pages) {
    const page = await getPage(tx, tenantId, p.pageId)
    if (!page) continue
    if (p.created) {
      // Untouched since the switch, so never published: the page and its draft go.
      await tx.delete(sitePages).where(and(eq(sitePages.tenantId, tenantId), eq(sitePages.id, page.id)))
      continue
    }
    if (p.draft) {
      await saveDraft(tx, { tenantId, pageId: page.id, data: p.draft, userId })
      continue
    }
    // The page had no draft: drop the switch's draft when an older version remains (a page keeps one version).
    const [older] = await tx
      .select({ id: pageVersions.id })
      .from(pageVersions)
      .where(and(eq(pageVersions.tenantId, tenantId), eq(pageVersions.pageId, page.id)))
      .orderBy(desc(pageVersions.createdAt))
      .offset(1)
      .limit(1)
    if (older) await tx.delete(pageVersions).where(eq(pageVersions.id, p.versionId))
  }
  const [updated] = await tx
    .update(sites)
    .set({ templateKey: undo.templateKey, theme: undo.theme, themeDraft: null, templateUndo: null })
    .where(eq(sites.id, site.id))
    .returning()
  return updated!
}

/** Slugs the public site uses for its own routes. */
const RESERVED_SLUGS = new Set(['book', 'api', 's'])

/** Adds a page (e.g. from a page template) with `data` as its first draft; the slug gets a suffix when taken. */
export async function addPage(
  tx: Tx,
  input: { tenantId: string; slug: string; title: SiteText; data: PageData; userId?: string },
): Promise<SitePageRow> {
  const site = await getSite(tx, input.tenantId)
  if (!site) throw new DomainError('Choose a template first', 'not_found')
  if (!input.slug || !PAGE_SLUG.test(input.slug))
    throw new DomainError('Use lowercase letters, numbers and dashes')
  const pages = await listPages(tx, input.tenantId)
  const taken = new Set([...pages.map((p) => p.slug), ...RESERVED_SLUGS])
  let slug = input.slug
  for (let i = 2; taken.has(slug); i++) slug = `${input.slug}-${i}`
  const [page] = await tx
    .insert(sitePages)
    .values({
      tenantId: input.tenantId,
      siteId: site.id,
      slug,
      title: input.title,
      sort: pages.reduce((max, p) => Math.max(max, p.sort), -1) + 1,
    })
    .returning()
  await tx.insert(pageVersions).values({
    tenantId: input.tenantId,
    pageId: page!.id,
    data: input.data,
    status: 'draft',
    createdBy: input.userId ?? null,
  })
  return page!
}

/**
 * Renames a page (menu title and/or address; the home page keeps slug ''). A page that is live gets the rename as
 * `pending`, applied by its next publish, so visitors never see an unpublished change; a never-published page is
 * renamed directly. Returns the page row and whether the rename waits for a publish.
 */
export async function renamePage(
  tx: Tx,
  input: { tenantId: string; pageId: string; title?: SiteText; slug?: string },
): Promise<{ page: SitePageRow; pending: boolean }> {
  const page = await getPage(tx, input.tenantId, input.pageId)
  if (!page) throw new DomainError('Page not found', 'not_found')
  const next: { title?: SiteText; slug?: string } = {}
  if (input.title) {
    const en = input.title.en.trim()
    if (!en || en.length > 80) throw new DomainError('Page titles need 1–80 characters')
    const ar = input.title.ar?.trim().slice(0, 80)
    next.title = { en, ...(ar ? { ar } : {}) }
  }
  const currentSlug = page.pending?.slug ?? page.slug
  if (input.slug !== undefined && input.slug !== currentSlug) {
    if (page.slug === '') throw new DomainError('The home page address can’t change')
    if (!input.slug || !PAGE_SLUG.test(input.slug) || input.slug.length > 60)
      throw new DomainError('Use lowercase letters, numbers and dashes')
    const others = (await listPages(tx, input.tenantId)).filter((p) => p.id !== page.id)
    const taken = new Set([
      ...others.flatMap((p) => [p.slug, ...(p.pending?.slug !== undefined ? [p.pending.slug] : [])]),
      ...RESERVED_SLUGS,
    ])
    if (taken.has(input.slug)) throw new DomainError('Another page already uses that address')
    next.slug = input.slug
  }
  if (!Object.keys(next).length) return { page, pending: Boolean(page.pending) }
  const live = Boolean(await latestVersion(tx, input.tenantId, page.id, 'published'))
  const [updated] = await tx
    .update(sitePages)
    .set(live ? { pending: { ...(page.pending ?? {}), ...next } } : next)
    .where(and(eq(sitePages.tenantId, input.tenantId), eq(sitePages.id, input.pageId)))
    .returning()
  return { page: updated!, pending: live }
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

/** Spa-wide default for public prices (`tenants.settings.hidePrices`, R4). */
export async function spaHidesPrices(tx: Tx, tenantId: string) {
  const [row] = await tx.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId))
  return !!row?.s.hidePrices
}

/**
 * The price a public page (website, online booking) may show: null = "price on request", either because the
 * variant has no price or because the service (else the spa default) hides prices.
 */
export function publicPrice(
  priceAed: string | null,
  serviceShowPrice: boolean | null,
  spaHides: boolean,
): string | null {
  return (serviceShowPrice ?? !spaHides) ? priceAed : null
}
