// Website Studio (PLAN §14.4, R23): the platform builds each spa's site as a bespoke service in the console and
// publishes it directly (no spa review step). The spa sends change requests; only a super-admin edits the site.
import {
  type DbOrTx,
  domains,
  pageVersions,
  platformDb,
  siteChangeRequests,
  sitePages,
  sites,
  type Tx,
  tenants,
} from '@spa/db'
import { and, asc, type Column, count, countDistinct, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { DomainError } from './errors'

export type ChangeRequestRow = Awaited<ReturnType<typeof listChangeRequests>>[number]

/** Open requests a spa may have at once — enough for real feedback, not a flood. */
export const MAX_OPEN_REQUESTS = 20

export async function listChangeRequests(tx: Tx, tenantId: string, limit = 50) {
  return tx
    .select({
      id: siteChangeRequests.id,
      body: siteChangeRequests.body,
      status: siteChangeRequests.status,
      response: siteChangeRequests.response,
      pageId: siteChangeRequests.pageId,
      pageTitle: sitePages.title,
      createdAt: siteChangeRequests.createdAt,
      resolvedAt: siteChangeRequests.resolvedAt,
    })
    .from(siteChangeRequests)
    .leftJoin(sitePages, eq(sitePages.id, siteChangeRequests.pageId))
    .where(eq(siteChangeRequests.tenantId, tenantId))
    .orderBy(desc(siteChangeRequests.createdAt))
    .limit(limit)
}

/** Spa asks the studio for a change (open → done | declined by the studio; no effect on publishing). */
export async function createChangeRequest(
  tx: Tx,
  tenantId: string,
  input: { body: string; pageId?: string | null; userId: string },
) {
  const body = input.body.trim()
  if (body.length < 3) throw new DomainError('Tell us what you would like changed.')
  if (body.length > 2000) throw new DomainError('Keep each request under 2,000 characters.')
  if (input.pageId) {
    const [page] = await tx
      .select({ id: sitePages.id })
      .from(sitePages)
      .where(and(eq(sitePages.tenantId, tenantId), eq(sitePages.id, input.pageId)))
    if (!page) throw new DomainError('That page no longer exists.', 'not_found')
  }
  const [open] = await tx
    .select({ n: count() })
    .from(siteChangeRequests)
    .where(and(eq(siteChangeRequests.tenantId, tenantId), eq(siteChangeRequests.status, 'open')))
  if ((open?.n ?? 0) >= MAX_OPEN_REQUESTS)
    throw new DomainError('You have many open requests — the studio will work through those first.')
  const [row] = await tx
    .insert(siteChangeRequests)
    .values({ tenantId, body, pageId: input.pageId ?? null, createdBy: input.userId })
    .returning({ id: siteChangeRequests.id })
  return row!.id
}

/** Studio closes a request as done or declined, with an optional note back to the spa. */
export async function resolveChangeRequest(
  tx: Tx,
  tenantId: string,
  id: string,
  input: { status: 'done' | 'declined'; response?: string | null; userId: string },
) {
  const response = input.response?.trim().slice(0, 2000) || null
  const [row] = await tx
    .update(siteChangeRequests)
    .set({ status: input.status, response, resolvedBy: input.userId, resolvedAt: new Date() })
    .where(
      and(
        eq(siteChangeRequests.tenantId, tenantId),
        eq(siteChangeRequests.id, id),
        eq(siteChangeRequests.status, 'open'),
      ),
    )
    .returning({ id: siteChangeRequests.id })
  if (!row) throw new DomainError('That request is already closed.', 'not_found')
}

export type WebsiteStatus = 'none' | 'template' | 'draft' | 'live'
export type WebsiteNextStep = 'choose_template' | 'continue_editing' | 'publish' | 'open_site'
export type WebsiteFacts = {
  hasSite: boolean
  /** Pages with a published version. */
  livePages: number
  /** Pages with a version a person or AI wrote (`created_by` set) — template starter pages have none. */
  editedPages: number
  /** Pages whose newest version is a draft, or with a rename waiting for the next publish. */
  changedPages: number
  themeDraft: boolean
}

/**
 * R23: where a spa's website stands, computed from its data (no stored status). Not started → Template chosen (only
 * the starter pages of the first pick) → Draft (someone wrote a page) → Live (a page is published), plus
 * "unpublished changes" while live. `next` is the one step the console offers.
 */
export function websiteProgress(f: WebsiteFacts): {
  status: WebsiteStatus
  unpublished: boolean
  next: WebsiteNextStep
} {
  if (!f.hasSite) return { status: 'none', unpublished: false, next: 'choose_template' }
  if (f.livePages > 0) {
    const unpublished = f.changedPages > 0 || f.themeDraft
    return { status: 'live', unpublished, next: unpublished ? 'publish' : 'open_site' }
  }
  if (f.editedPages > 0) return { status: 'draft', unpublished: false, next: 'publish' }
  return { status: 'template', unpublished: false, next: 'continue_editing' }
}

export type WebsiteOverviewRow = Awaited<ReturnType<typeof websiteOverview>>[number]

/**
 * Console → Websites (R23; platform code path — super-admin console and the Claude connector, never tenant code):
 * every spa that isn't deleted with its website status, next step, open change requests, home page and primary custom
 * domain. `tenantId` narrows it to one spa.
 */
export async function websiteOverview(db: DbOrTx = platformDb(), opts: { tenantId?: string } = {}) {
  const only = (col: Column) => (opts.tenantId ? eq(col, opts.tenantId) : undefined)
  const [rows, open, live, edited, newest, renames, homes, hosts] = await Promise.all([
    db
      .select({
        tenantId: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        tenantStatus: tenants.status,
        siteId: sites.id,
        updatedAt: sites.updatedAt,
        themeDraft: sql<boolean>`${sites.themeDraft} is not null`,
      })
      .from(tenants)
      .leftJoin(sites, eq(sites.tenantId, tenants.id))
      .where(and(isNull(tenants.deletedAt), only(tenants.id)))
      .orderBy(asc(tenants.name)),
    db
      .select({ tenantId: siteChangeRequests.tenantId, n: count() })
      .from(siteChangeRequests)
      .where(and(eq(siteChangeRequests.status, 'open'), only(siteChangeRequests.tenantId)))
      .groupBy(siteChangeRequests.tenantId),
    db
      .select({ tenantId: pageVersions.tenantId, n: countDistinct(pageVersions.pageId) })
      .from(pageVersions)
      .where(and(eq(pageVersions.status, 'published'), only(pageVersions.tenantId)))
      .groupBy(pageVersions.tenantId),
    db
      .select({ tenantId: pageVersions.tenantId, n: countDistinct(pageVersions.pageId) })
      .from(pageVersions)
      .where(and(isNotNull(pageVersions.createdBy), only(pageVersions.tenantId)))
      .groupBy(pageVersions.tenantId),
    // Each page's newest version (same rule as the page list's "unpublished" pill).
    db
      .selectDistinctOn([pageVersions.pageId], {
        tenantId: pageVersions.tenantId,
        pageId: pageVersions.pageId,
        status: pageVersions.status,
      })
      .from(pageVersions)
      .where(only(pageVersions.tenantId))
      .orderBy(pageVersions.pageId, desc(pageVersions.createdAt)),
    db
      .select({ tenantId: sitePages.tenantId, pageId: sitePages.id })
      .from(sitePages)
      .where(and(isNotNull(sitePages.pending), only(sitePages.tenantId))),
    // Home page ('' slug), else the first page.
    db
      .selectDistinctOn([sitePages.tenantId], { tenantId: sitePages.tenantId, id: sitePages.id })
      .from(sitePages)
      .where(only(sitePages.tenantId))
      .orderBy(
        sitePages.tenantId,
        sql`(${sitePages.slug} = '') desc`,
        asc(sitePages.sort),
        asc(sitePages.createdAt),
      ),
    db
      .select({ tenantId: domains.tenantId, hostname: domains.hostname })
      .from(domains)
      .where(
        and(
          eq(domains.kind, 'custom'),
          eq(domains.status, 'active'),
          eq(domains.isPrimary, true),
          only(domains.tenantId),
        ),
      ),
  ])
  const by = (list: { tenantId: string; n: number }[]) => new Map(list.map((r) => [r.tenantId, r.n]))
  const openBy = by(open)
  const liveBy = by(live)
  const editedBy = by(edited)
  const changed = new Map<string, Set<string>>()
  const mark = (tenantId: string, pageId: string) => {
    const set = changed.get(tenantId) ?? new Set<string>()
    changed.set(tenantId, set.add(pageId))
  }
  for (const v of newest) if (v.status === 'draft') mark(v.tenantId, v.pageId)
  for (const p of renames) mark(p.tenantId, p.pageId)
  const homeBy = new Map(homes.map((h) => [h.tenantId, h.id]))
  const hostBy = new Map(hosts.map((h) => [h.tenantId, h.hostname]))
  return rows.map((r) => {
    const facts: WebsiteFacts = {
      hasSite: r.siteId !== null,
      livePages: liveBy.get(r.tenantId) ?? 0,
      editedPages: editedBy.get(r.tenantId) ?? 0,
      changedPages: changed.get(r.tenantId)?.size ?? 0,
      themeDraft: r.siteId !== null && Boolean(r.themeDraft),
    }
    return {
      tenantId: r.tenantId,
      name: r.name,
      slug: r.slug,
      tenantStatus: r.tenantStatus,
      updatedAt: r.updatedAt,
      openRequests: openBy.get(r.tenantId) ?? 0,
      homePageId: homeBy.get(r.tenantId) ?? null,
      primaryHost: hostBy.get(r.tenantId) ?? null,
      ...facts,
      ...websiteProgress(facts),
    }
  })
}

/** Open change requests of every spa that isn't deleted (console nav badge). */
export async function openChangeRequestCount(db: DbOrTx = platformDb()) {
  const [row] = await db
    .select({ n: count() })
    .from(siteChangeRequests)
    .innerJoin(tenants, eq(tenants.id, siteChangeRequests.tenantId))
    .where(and(eq(siteChangeRequests.status, 'open'), isNull(tenants.deletedAt)))
  return row?.n ?? 0
}
