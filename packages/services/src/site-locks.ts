// Studio editor soft lock (F29, PLAN §11.6 "one editor per page at a time"). The editor takes the lock when it opens a
// page and renews it with a heartbeat; it frees itself `PAGE_LOCK_TTL_MS` after the last beat (tab closed, network
// gone). Other editors see who holds it and may take over (callers audit that). Draft writers — editor saves and
// publishes, Ask AI, the Claude MCP connector (site-edit.ts) — refuse a page locked by someone else. Like every
// service: takes the caller's tx (withTenant), no permission checks or audit rows inside.
import { sitePageLocks, type Tx } from '@spa/db'
import { and, eq, gt, inArray, ne, or, sql } from 'drizzle-orm'
import { DomainError } from './errors'
import { getPage } from './sites'

/** A lock frees itself this long after its last heartbeat. */
export const PAGE_LOCK_TTL_MS = 2 * 60_000
/** How often an open editor renews its lock. */
export const PAGE_LOCK_HEARTBEAT_MS = 30_000

export type PageLock = {
  pageId: string
  userId: string
  holderName: string
  acquiredAt: Date
  heartbeatAt: Date
  expiresAt: Date
}

/** Refusal text for a page someone else is editing (EN catalogue `errors.domain.pageLocked`). */
export const pageLockedMessage = (name: string) =>
  `${name} is editing this page in the Studio editor — changes are refused until they close it (the lock frees itself 2 minutes after they leave) or someone takes over in the editor`

export class PageLockedError extends DomainError {
  constructor(readonly lock: PageLock) {
    super(pageLockedMessage(lock.holderName))
  }
}

const view = (r: typeof sitePageLocks.$inferSelect): PageLock => ({
  pageId: r.pageId,
  userId: r.userId,
  holderName: r.holderName,
  acquiredAt: r.acquiredAt,
  heartbeatAt: r.heartbeatAt,
  expiresAt: r.expiresAt,
})

/** The live (unexpired) lock on a page, or null. */
export async function getPageLock(
  tx: Tx,
  tenantId: string,
  pageId: string,
  now = new Date(),
): Promise<PageLock | null> {
  const [row] = await tx
    .select()
    .from(sitePageLocks)
    .where(
      and(
        eq(sitePageLocks.tenantId, tenantId),
        eq(sitePageLocks.pageId, pageId),
        gt(sitePageLocks.expiresAt, now),
      ),
    )
    .limit(1)
  return row ? view(row) : null
}

/** Live locks on a spa's pages held by anyone but `exceptUserId`, keyed by page id. */
export async function pageLocksHeldByOthers(
  tx: Tx,
  tenantId: string,
  exceptUserId: string | undefined,
  pageIds?: string[],
  now = new Date(),
): Promise<Map<string, PageLock>> {
  if (pageIds && !pageIds.length) return new Map()
  const rows = await tx
    .select()
    .from(sitePageLocks)
    .where(
      and(
        eq(sitePageLocks.tenantId, tenantId),
        gt(sitePageLocks.expiresAt, now),
        exceptUserId ? ne(sitePageLocks.userId, exceptUserId) : undefined,
        pageIds ? inArray(sitePageLocks.pageId, pageIds) : undefined,
      ),
    )
  return new Map(rows.map((r) => [r.pageId, view(r)]))
}

export type AcquireResult =
  | {
      ok: true
      lock: PageLock
      /** The other editor whose live lock this call replaced (take over) — callers audit it. */
      tookOverFrom: { userId: string; holderName: string } | null
    }
  | { ok: false; lock: PageLock }

/**
 * Takes or renews the lock on a page for `userId` (also the heartbeat). Free, expired or already ours → ours with a
 * fresh expiry. Held by someone else → `{ ok: false, lock }` unless `takeOver`, which replaces it. Atomic: the upsert
 * only overwrites a row that is ours, expired, or being taken over, so two editors racing for a free page can't both
 * win.
 */
export async function acquirePageLock(
  tx: Tx,
  input: {
    tenantId: string
    pageId: string
    userId: string
    holderName: string
    takeOver?: boolean
    now?: Date
    ttlMs?: number
  },
): Promise<AcquireResult> {
  const now = input.now ?? new Date()
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? PAGE_LOCK_TTL_MS))
  if (!(await getPage(tx, input.tenantId, input.pageId))) throw new DomainError('Page not found', 'not_found')
  const [before] = await tx
    .select()
    .from(sitePageLocks)
    .where(and(eq(sitePageLocks.tenantId, input.tenantId), eq(sitePageLocks.pageId, input.pageId)))
    .for('update')
  const heldByOther = before && before.userId !== input.userId && before.expiresAt > now
  if (heldByOther && !input.takeOver) return { ok: false, lock: view(before) }
  const sameHolder = before?.userId === input.userId && before.expiresAt > now
  const name = input.holderName.trim().slice(0, 120) || 'Another editor'
  const [row] = await tx
    .insert(sitePageLocks)
    .values({
      tenantId: input.tenantId,
      pageId: input.pageId,
      userId: input.userId,
      holderName: name,
      acquiredAt: now,
      heartbeatAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: sitePageLocks.pageId,
      set: {
        userId: input.userId,
        holderName: name,
        // A renewal keeps when the editor first took the page.
        acquiredAt: sameHolder ? sql`${sitePageLocks.acquiredAt}` : now,
        heartbeatAt: now,
        expiresAt,
      },
      // Only ours, expired, or an explicit take-over (a concurrent first-taker made the row in between → refused).
      setWhere: input.takeOver
        ? sql`true`
        : or(
            eq(sitePageLocks.userId, input.userId),
            sql`${sitePageLocks.expiresAt} <= ${now.toISOString()}::timestamptz`,
          ),
    })
    .returning()
  if (!row) {
    const holder = await getPageLock(tx, input.tenantId, input.pageId, now)
    if (holder) return { ok: false, lock: holder }
    throw new DomainError('Please try again')
  }
  return {
    ok: true,
    lock: view(row),
    tookOverFrom: heldByOther ? { userId: before.userId, holderName: before.holderName } : null,
  }
}

/** Drops the user's lock on a page (editor closed). No-op when someone else holds it now. */
export async function releasePageLock(
  tx: Tx,
  input: { tenantId: string; pageId: string; userId: string },
): Promise<boolean> {
  const rows = await tx
    .delete(sitePageLocks)
    .where(
      and(
        eq(sitePageLocks.tenantId, input.tenantId),
        eq(sitePageLocks.pageId, input.pageId),
        eq(sitePageLocks.userId, input.userId),
      ),
    )
    .returning({ id: sitePageLocks.id })
  return rows.length > 0
}

/**
 * Throws `PageLockedError` when any of `pageIds` is locked by someone other than `userId` (no user = any live lock
 * refuses). Draft writers call it inside their transaction, after `lockSite`.
 */
export async function assertPagesUnlocked(
  tx: Tx,
  input: { tenantId: string; pageIds: string[]; userId?: string; now?: Date },
): Promise<void> {
  const held = await pageLocksHeldByOthers(tx, input.tenantId, input.userId, input.pageIds, input.now)
  const first = held.values().next().value
  if (first) throw new PageLockedError(first)
}
