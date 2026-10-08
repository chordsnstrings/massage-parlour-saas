// Website Studio (PLAN §14.4): the platform builds each spa's site as a bespoke service. The spa reviews it,
// approves it and sends change requests; only a super-admin acting on the tenant edits the site itself.
import {
  type DbOrTx,
  pageVersions,
  platformDb,
  siteChangeRequests,
  sitePages,
  sites,
  type Tx,
  tenants,
} from '@spa/db'
import { and, asc, count, countDistinct, desc, eq } from 'drizzle-orm'
import { DomainError } from './errors'

export type StudioStatus = (typeof sites.$inferSelect)['studioStatus']
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

/** Spa asks the studio for a change. Asking while a review is pending sends the site back to the studio. */
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
  await tx
    .update(sites)
    .set({ studioStatus: 'building', updatedAt: new Date() })
    .where(and(eq(sites.tenantId, tenantId), eq(sites.studioStatus, 'review')))
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

/**
 * Moves the site through building → review → approved. Only the studio (super-admin) changes the status —
 * it sends for review, pulls it back, approves or reopens; the spa only reviews and requests changes (R1).
 */
export async function setStudioStatus(tx: Tx, tenantId: string, to: StudioStatus) {
  const [site] = await tx
    .select({ status: sites.studioStatus })
    .from(sites)
    .where(eq(sites.tenantId, tenantId))
  if (!site) throw new DomainError('There is no website yet.', 'not_found')
  if (site.status === to) throw new DomainError('That step is not available right now.')
  await tx.update(sites).set({ studioStatus: to, updatedAt: new Date() }).where(eq(sites.tenantId, tenantId))
}

/** Super-admin Websites list: every spa with its studio status, live pages and open requests. */
export async function studioOverview(db: DbOrTx = platformDb()) {
  const [rows, open, live] = await Promise.all([
    db
      .select({
        tenantId: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        tenantStatus: tenants.status,
        hasSite: sites.id,
        studioStatus: sites.studioStatus,
        updatedAt: sites.updatedAt,
      })
      .from(tenants)
      .leftJoin(sites, eq(sites.tenantId, tenants.id))
      .orderBy(asc(tenants.name)),
    db
      .select({ tenantId: siteChangeRequests.tenantId, n: count() })
      .from(siteChangeRequests)
      .where(eq(siteChangeRequests.status, 'open'))
      .groupBy(siteChangeRequests.tenantId),
    db
      .select({ tenantId: sitePages.tenantId, n: countDistinct(sitePages.id) })
      .from(pageVersions)
      .innerJoin(sitePages, eq(sitePages.id, pageVersions.pageId))
      .where(eq(pageVersions.status, 'published'))
      .groupBy(sitePages.tenantId),
  ])
  const openBy = new Map(open.map((r) => [r.tenantId, r.n]))
  const liveBy = new Map(live.map((r) => [r.tenantId, r.n]))
  return rows.map((r) => ({
    ...r,
    hasSite: !!r.hasSite,
    openRequests: openBy.get(r.tenantId) ?? 0,
    livePages: liveBy.get(r.tenantId) ?? 0,
  }))
}
