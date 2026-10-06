// Tenant website: site settings, pages and Puck page versions (docs/PLAN.md §11).
import { pageVersions, sitePages, sites, type TemplateUndo, type ThemeTokens, type Tx } from '@spa/db'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { DomainError } from './errors'

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
  if (latest?.status === 'draft') {
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
  if (latest?.status === 'draft') {
    const [promoted] = await tx
      .update(pageVersions)
      .set({
        data,
        status: 'published',
        label: input.label ?? null,
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
    .set({ templateKey: template.key, theme, ...(undo ? { templateUndo: undo } : {}) })
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
    .set({ templateKey: undo.templateKey, theme: undo.theme, templateUndo: null })
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
